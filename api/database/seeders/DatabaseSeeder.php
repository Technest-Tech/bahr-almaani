<?php

namespace Database\Seeders;

use App\Models\Language;
use App\Models\Setting;
use App\Models\User;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $this->call([
            RolesAndPermissionsSeeder::class,
            LanguageSeeder::class,
        ]);

        Setting::set('due_soon_threshold_hours', 24);
        Setting::set('auto_archive_after_days', 30);

        // Production seeds the first administrator from the environment so the
        // droplet never ships with the well-known dev credentials. Seeders only
        // ever run from the CLI, where real env vars are readable even with a
        // cached config.
        $admin = User::firstOrCreate(
            ['email' => env('ADMIN_EMAIL', 'admin@bahr.local')],
            [
                'name' => env('ADMIN_NAME', 'مدير النظام'),
                'password' => env('ADMIN_PASSWORD', 'password'),
                'locale' => 'ar',
            ],
        );
        $admin->syncRoles(['admin']);

        if (app()->isLocal()) {
            $this->seedDemoUsers();
        }
    }

    /** Local-only demo accounts for development (password: "password"). */
    private function seedDemoUsers(): void
    {
        $pm = User::firstOrCreate(
            ['email' => 'pm@bahr.local'],
            ['name' => 'منى مدير المشاريع', 'password' => 'password'],
        );
        $pm->syncRoles(['project_manager']);

        $accountant = User::firstOrCreate(
            ['email' => 'accountant@bahr.local'],
            ['name' => 'أحمد المحاسب', 'password' => 'password'],
        );
        $accountant->syncRoles(['accountant']);

        $ar = Language::where('code', 'ar')->first();
        $en = Language::where('code', 'en')->first();
        $fr = Language::where('code', 'fr')->first();

        foreach ([
            ['email' => 'translator1@bahr.local', 'name' => 'سارة المترجمة', 'pairs' => [[$en, $ar], [$ar, $en]]],
            // translator2 shares en→ar with translator1: two translators on one pair
            // is the realistic (and demo-able) claim-race scenario.
            ['email' => 'translator2@bahr.local', 'name' => 'خالد المترجم', 'pairs' => [[$fr, $ar], [$en, $ar]]],
        ] as $data) {
            $translator = User::firstOrCreate(
                ['email' => $data['email']],
                ['name' => $data['name'], 'password' => 'password'],
            );
            $translator->syncRoles(['translator']);

            foreach ($data['pairs'] as [$source, $target]) {
                $translator->languagePairs()->firstOrCreate([
                    'source_language_id' => $source->id,
                    'target_language_id' => $target->id,
                ]);
            }
        }
    }
}
