<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

class RolesAndPermissionsSeeder extends Seeder
{
    /**
     * Permission catalog. Grouped by module (see docs/03-modules-and-api.md).
     */
    private const PERMISSIONS = [
        // M2 — users & roles
        'users.view',
        'users.manage',
        'roles.manage',
        // M3 — clients & projects
        'clients.view',
        'clients.manage',
        'projects.view',
        'projects.manage',   // create / edit / publish / cancel / withdraw
        'projects.review',   // open review / request revision / approve
        // M4 — translator portal
        'portal.access',
        // M6/M7 — dashboard & reports
        'dashboard.view',
        'reports.view',
        'reports.export',
        // M8 — audit
        'activity-log.view',
        // M9 — letterheads
        'letterheads.view',
        'letterheads.manage',
        // M10/M12 — settings
        'settings.manage',
    ];

    private const ROLES = [
        'admin' => '*',
        'project_manager' => [
            'clients.view', 'clients.manage',
            'projects.view', 'projects.manage', 'projects.review',
            'dashboard.view', 'reports.view', 'reports.export',
            'letterheads.view',
        ],
        'translator' => [
            'portal.access',
        ],
        'accountant' => [
            'dashboard.view', 'reports.view', 'reports.export',
        ],
    ];

    public function run(): void
    {
        app(PermissionRegistrar::class)->forgetCachedPermissions();

        foreach (self::PERMISSIONS as $permission) {
            Permission::findOrCreate($permission, 'web');
        }

        foreach (self::ROLES as $role => $permissions) {
            $role = Role::findOrCreate($role, 'web');
            $role->syncPermissions($permissions === '*' ? self::PERMISSIONS : $permissions);
        }
    }
}
