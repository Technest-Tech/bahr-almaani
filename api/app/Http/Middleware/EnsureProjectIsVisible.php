<?php

namespace App\Http\Middleware;

use App\Models\Project;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * A PM works on their own projects only (2026-09-19) — see Project::visibleTo().
 *
 * Guards every staff route that names a {project}; a route without one (the list,
 * creating a project) passes straight through and is scoped in its controller.
 * Route-model binding has already run, so the parameter is the model.
 */
class EnsureProjectIsVisible
{
    public function handle(Request $request, Closure $next): Response
    {
        $project = $request->route('project');

        if ($project instanceof Project) {
            abort_unless($project->isVisibleTo($request->user()), 403, __('projects.not_yours'));
        }

        return $next($request);
    }
}
