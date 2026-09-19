<?php

use Illuminate\Database\Migrations\Migration;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

/**
 * Each PM sees their own projects; the admin still sees everyone's (2026-09-19).
 *
 * `projects.view-all` lifts the per-PM scope. It is granted here as well as in
 * RolesAndPermissionsSeeder because deploy.sh migrates but never seeds: without
 * this, the admin would be narrowed to the projects they created personally
 * until someone remembered to re-run the seeder.
 *
 * The accountant holds it too — they bill every PM's finished work.
 */
return new class extends Migration
{
    public function up(): void
    {
        app(PermissionRegistrar::class)->forgetCachedPermissions();

        $permission = Permission::findOrCreate('projects.view-all', 'web');

        // A fresh database has no roles yet; the seeder grants it there.
        Role::query()
            ->whereIn('name', ['admin', 'accountant'])
            ->where('guard_name', 'web')
            ->get()
            ->each(fn (Role $role) => $role->givePermissionTo($permission));

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }

    public function down(): void
    {
        Permission::query()->where('name', 'projects.view-all')->where('guard_name', 'web')->delete();

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }
};
