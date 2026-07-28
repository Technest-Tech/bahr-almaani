<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Client;
use App\Models\Project;
use App\Models\User;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;
use Spatie\Activitylog\Models\Activity;

class ActivityLogController extends Controller
{
    /** Read-only audit trail (admin). No mutations exist by design. */
    public function index(Request $request): AnonymousResourceCollection
    {
        $activities = Activity::query()
            ->with(['causer:id,name', 'subject' => function (MorphTo $morphTo): void {
                // Deleted subjects must still label their history rows.
                $morphTo->constrain([
                    Project::class => fn ($q) => $q->withTrashed(),
                    Client::class => fn ($q) => $q->withTrashed(),
                    User::class => fn ($q) => $q->withTrashed(),
                ]);
            }])
            ->when($request->filled('log'), fn ($q) => $q->where('log_name', $request->string('log')->toString()))
            ->when($request->filled('event'), fn ($q) => $q->where('event', $request->string('event')->toString()))
            ->when($request->filled('causer_id'), fn ($q) => $q->where('causer_id', $request->integer('causer_id')))
            ->when($request->filled('from'), fn ($q) => $q->where('created_at', '>=', $request->date('from')->startOfDay()))
            ->when($request->filled('to'), fn ($q) => $q->where('created_at', '<=', $request->date('to')->endOfDay()))
            ->latest()
            ->latest('id')
            ->paginate(min($request->integer('per_page', 25), 100));

        return JsonResource::collection(
            $activities->through(fn (Activity $activity) => $this->present($activity)),
        );
    }

    private function present(Activity $activity): array
    {
        $subject = $activity->subject;

        return [
            'id' => $activity->id,
            'log_name' => $activity->log_name,
            'event' => $activity->event,
            'causer' => $activity->causer?->only(['id', 'name']),
            'subject_type' => class_basename($activity->subject_type ?? ''),
            'subject_id' => $activity->subject_id,
            'subject_label' => match (true) {
                $subject instanceof Project => "{$subject->code} — {$subject->title}",
                $subject instanceof Client, $subject instanceof User => $subject->name,
                default => null,
            },
            'changes' => [
                'attributes' => $activity->properties['attributes'] ?? [],
                'old' => $activity->properties['old'] ?? [],
            ],
            'created_at' => $activity->created_at->toIso8601String(),
        ];
    }
}
