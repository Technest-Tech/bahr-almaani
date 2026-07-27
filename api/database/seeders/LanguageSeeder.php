<?php

namespace Database\Seeders;

use App\Models\Language;
use Illuminate\Database\Seeder;

class LanguageSeeder extends Seeder
{
    private const LANGUAGES = [
        // code, name_ar, name_en, rtl
        ['ar', 'العربية', 'Arabic', true],
        ['en', 'الإنجليزية', 'English', false],
        ['fr', 'الفرنسية', 'French', false],
        ['de', 'الألمانية', 'German', false],
        ['es', 'الإسبانية', 'Spanish', false],
        ['it', 'الإيطالية', 'Italian', false],
        ['ru', 'الروسية', 'Russian', false],
        ['tr', 'التركية', 'Turkish', false],
        ['zh', 'الصينية', 'Chinese', false],
        ['ja', 'اليابانية', 'Japanese', false],
        ['ko', 'الكورية', 'Korean', false],
        ['pt', 'البرتغالية', 'Portuguese', false],
        ['nl', 'الهولندية', 'Dutch', false],
        ['el', 'اليونانية', 'Greek', false],
        ['he', 'العبرية', 'Hebrew', true],
        ['fa', 'الفارسية', 'Persian', true],
        ['ur', 'الأردية', 'Urdu', true],
        ['hi', 'الهندية', 'Hindi', false],
        ['id', 'الإندونيسية', 'Indonesian', false],
        ['sv', 'السويدية', 'Swedish', false],
        ['pl', 'البولندية', 'Polish', false],
        ['uk', 'الأوكرانية', 'Ukrainian', false],
        ['ro', 'الرومانية', 'Romanian', false],
        ['cs', 'التشيكية', 'Czech', false],
        ['th', 'التايلاندية', 'Thai', false],
    ];

    public function run(): void
    {
        foreach (self::LANGUAGES as [$code, $nameAr, $nameEn, $rtl]) {
            Language::updateOrCreate(
                ['code' => $code],
                ['name_ar' => $nameAr, 'name_en' => $nameEn, 'is_rtl' => $rtl, 'is_active' => true],
            );
        }
    }
}
