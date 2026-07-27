<?php

namespace App\Console\Commands;

use App\Models\Project;
use App\Models\Setting;
use App\Notifications\DeadlineAlertNotification;
use App\Models\User;
use Illuminate\Console\Command;

class ScanDeadlinesCommand extends Command
{
    protected $signature = 'projects:scan-deadlines';

    protected $description = 'Flag due-soon and late projects and fire one-time notifications per escalation level';

    public function handle(): int
    {
        $threshold = (int) Setting::get('due_soon_threshold_hours', 24);
        $activeStatuses = [
            Project::STATUS_AVAILABLE,
            Project::STATUS_CLAIMED,
            Project::STATUS_DELIVERED,
            Project::STATUS_IN_REVIEW,
            Project::STATUS_REVISION_REQUESTED,
        ];

        // Late — deadline passed, never flagged before.
        Project::query()
            ->whereIn('status', $activeStatuses)
            ->where('deadline_at', '<', now())
            ->whereNull('late_notified_at')
            ->with('creator')
            ->each(function (Project $project): void {
                foreach ($this->recipients($project, includeAdmins: true) as $user) {
                    $user->notify(new DeadlineAlertNotification($project, 'late'));
                }
                $project->forceFill(['late_notified_at' => now()])->saveQuietly();
                $this->info("late: {$project->code}");
            });

        // Due soon — inside the threshold window, not late yet, never flagged.
        Project::query()
            ->whereIn('status', $activeStatuses)
            ->whereBetween('deadline_at', [now(), now()->addHours($threshold)])
            ->whereNull('due_soon_notified_at')
            ->whereNull('late_notified_at')
            ->with('creator')
            ->each(function (Project $project): void {
                foreach ($this->recipients($project, includeAdmins: false) as $user) {
                    $user->notify(new DeadlineAlertNotification($project, 'due_soon'));
                }
                $project->forceFill(['due_soon_notified_at' => now()])->saveQuietly();
                $this->info("due soon: {$project->code}");
            });

        return self::SUCCESS;
    }

    /** @return \Illuminate\Support\Collection<int, User> */
    private function recipients(Project $project, bool $includeAdmins)
    {
        $users = collect([$project->creator]);

        if ($assignee = $project->activeAssignment()?->translator) {
            $users->push($assignee);
        }

        if ($includeAdmins) {
            $users = $users->merge(User::role('admin')->get());
        }

        return $users->unique('id')->filter();
    }
}
