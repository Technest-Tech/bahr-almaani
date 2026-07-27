<?php

namespace App\Services;

use App\Exceptions\InvalidTransitionException;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * The ONLY code path allowed to change a project's status.
 * Full matrix: docs/02-state-machine.md — every change is row-locked,
 * validated against the matrix, and recorded in status_transitions.
 */
class ProjectTransitionService
{
    /**
     * "from->to" => rule.
     *  - permission: actor needs this permission
     *  - role:       actor needs this role (stricter than permission)
     *  - system:     only a null actor (queue jobs / scheduler) may run it
     *  - note_required: transition must carry a note (reason)
     */
    private const MATRIX = [
        'draft->available' => ['permission' => 'projects.manage'],
        'available->claimed' => ['permission' => 'portal.access'],
        'claimed->delivered' => ['permission' => 'portal.access'],
        'claimed->available' => ['permission' => 'projects.manage', 'note_required' => true],
        'delivered->in_review' => ['permission' => 'projects.review'],
        'in_review->revision_requested' => ['permission' => 'projects.review', 'note_required' => true],
        'revision_requested->delivered' => ['permission' => 'portal.access'],
        'in_review->approved' => ['permission' => 'projects.review'],
        'approved->completed' => ['system' => true],
        'completed->archived' => ['permission' => 'projects.manage'],
        'draft->cancelled' => ['permission' => 'projects.manage', 'note_required' => true],
        'available->cancelled' => ['permission' => 'projects.manage', 'note_required' => true],
        'claimed->cancelled' => ['role' => 'admin', 'note_required' => true],
        'delivered->cancelled' => ['role' => 'admin', 'note_required' => true],
    ];

    /**
     * @throws InvalidTransitionException
     */
    public function transition(
        Project $project,
        string $to,
        ?User $actor,
        ?string $note = null,
    ): Project {
        return DB::transaction(function () use ($project, $to, $actor, $note): Project {
            /** @var Project $fresh */
            $fresh = Project::whereKey($project->getKey())->lockForUpdate()->firstOrFail();

            $key = "{$fresh->status}->{$to}";
            $rule = self::MATRIX[$key] ?? null;

            if ($rule === null) {
                throw new InvalidTransitionException(
                    __('projects.invalid_transition', ['from' => __("projects.status.{$fresh->status}"), 'to' => __("projects.status.{$to}")]),
                );
            }

            $this->authorize($rule, $actor, $key);

            if (($rule['note_required'] ?? false) && blank($note)) {
                throw new InvalidTransitionException(__('projects.note_required'));
            }

            $this->applySideEffects($fresh, $to, $note);

            $fresh->status = $to;
            $fresh->save();

            $fresh->transitions()->create([
                'from_status' => explode('->', $key)[0],
                'to_status' => $to,
                'actor_id' => $actor?->getKey(),
                'note' => $note,
            ]);

            return $fresh;
        });
    }

    /** @throws InvalidTransitionException */
    private function authorize(array $rule, ?User $actor, string $key): void
    {
        if ($rule['system'] ?? false) {
            if ($actor !== null && ! $actor->hasRole('admin')) {
                throw new InvalidTransitionException(__('projects.system_transition_only'));
            }

            return;
        }

        if ($actor === null) {
            throw new InvalidTransitionException(__('projects.actor_required'));
        }

        if (isset($rule['role']) && ! $actor->hasRole($rule['role'])) {
            throw new InvalidTransitionException(__('projects.transition_forbidden'));
        }

        if (isset($rule['permission']) && ! $actor->can($rule['permission'])) {
            throw new InvalidTransitionException(__('projects.transition_forbidden'));
        }
    }

    private function applySideEffects(Project $project, string $to, ?string $note): void
    {
        match ($to) {
            Project::STATUS_AVAILABLE => $project->published_at ??= now(),
            Project::STATUS_COMPLETED => $project->completed_at = now(),
            Project::STATUS_CANCELLED => tap($project, function (Project $p) use ($note): void {
                $p->cancelled_at = now();
                $p->cancel_reason = $note;
            }),
            default => null,
        };
    }
}
