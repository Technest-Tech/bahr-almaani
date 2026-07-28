<?php

namespace App\Support;

/**
 * Registry of notification families the user can opt out of.
 *
 * Only the MAIL channel is switchable: `database` + `broadcast` are always on because
 * the bell is the system of record for what happened — mail is the opt-out copy.
 */
final class NotificationPreferences
{
    public const PROJECT_AVAILABLE = 'project_available';

    public const PROJECT_DELIVERED = 'project_delivered';

    public const REVISION_REQUESTED = 'revision_requested';

    public const PROJECT_WITHDRAWN = 'project_withdrawn';

    public const DEADLINE_ALERTS = 'deadline_alerts';

    public const REPORT_READY = 'report_ready';

    /**
     * Family key => [label, description, mail default]. Labels are Arabic because the
     * settings screen renders this list verbatim.
     *
     * @var array<string, array{label: string, description: string, mail: bool}>
     */
    private const FAMILIES = [
        self::PROJECT_AVAILABLE => [
            'label' => 'ملف جديد متاح',
            'description' => 'عند نشر مشروع يطابق أزواجك اللغوية.',
            'mail' => true,
        ],
        self::PROJECT_DELIVERED => [
            'label' => 'تسليم ترجمة',
            'description' => 'عندما يسلّم المترجم عملاً بانتظار مراجعتك.',
            'mail' => true,
        ],
        self::REVISION_REQUESTED => [
            'label' => 'طلب تعديل',
            'description' => 'عندما يطلب مدير المشروع تعديلاً على ترجمتك.',
            'mail' => true,
        ],
        self::PROJECT_WITHDRAWN => [
            'label' => 'سحب ملف',
            'description' => 'عندما تسحب الإدارة مشروعاً من قائمتك.',
            'mail' => true,
        ],
        self::DEADLINE_ALERTS => [
            'label' => 'تنبيهات المواعيد',
            'description' => 'اقتراب موعد التسليم أو تجاوزه.',
            'mail' => true,
        ],
        self::REPORT_READY => [
            'label' => 'جاهزية التقارير',
            'description' => 'عند اكتمال تصدير Excel أو PDF طلبته.',
            'mail' => true,
        ],
    ];

    /** @return list<string> */
    public static function keys(): array
    {
        return array_keys(self::FAMILIES);
    }

    public static function has(string $family): bool
    {
        return isset(self::FAMILIES[$family]);
    }

    /**
     * Every family with its default mail flag — the baseline a user's stored rows override.
     *
     * @return array<string, bool>
     */
    public static function defaults(): array
    {
        return array_map(fn (array $family): bool => $family['mail'], self::FAMILIES);
    }

    public static function default(string $family): bool
    {
        return self::FAMILIES[$family]['mail'] ?? true;
    }

    /**
     * Presentation metadata for the settings screen, in declaration order.
     *
     * @return list<array{key: string, label: string, description: string}>
     */
    public static function catalog(): array
    {
        return array_map(fn (string $key): array => [
            'key' => $key,
            'label' => self::FAMILIES[$key]['label'],
            'description' => self::FAMILIES[$key]['description'],
        ], self::keys());
    }
}
