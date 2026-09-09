<?php

return [
    'invalid_transition' => 'لا يمكن نقل المشروع من حالة «:from» إلى «:to».',
    'note_required' => 'يجب ذكر السبب لهذا الإجراء.',
    'transition_forbidden' => 'لا تملك صلاحية تنفيذ هذا الإجراء.',
    'system_transition_only' => 'هذا الإجراء يتم تلقائياً بواسطة النظام.',
    'actor_required' => 'هذا الإجراء يتطلب مستخدماً مسجلاً.',
    'publish_requires_source' => 'لا يمكن نشر المشروع بدون ملف عمل واحد على الأقل.',
    'edit_draft_only' => 'يمكن تعديل بيانات المشروع الأساسية في حالة المسودة فقط.',
    'source_upload_draft_only' => 'يمكن إضافة ملفات العمل في حالة المسودة فقط.',
    'file_delete_draft_only' => 'يمكن حذف الملفات في حالة المسودة فقط.',
    'manual_count_not_applicable' => 'العد اليدوي متاح فقط للملفات التي تعذر عدّها تلقائياً.',
    'merge_retry_not_applicable' => 'إعادة الدمج متاحة فقط للمشاريع المعتمدة التي لم يكتمل إصدار ملفها النهائي.',
    'final_file_missing' => 'لم يصدر الملف النهائي لهذا المشروع بعد.',

    // طلب مستند من العميل (هوية أو مستند داعم)
    'document_request_settled' => 'لا يمكن طلب مستندات من العميل بعد إغلاق المشروع.',
    'document_request_duplicate' => 'يوجد طلب مفتوح بالفعل لهذا المستند على نفس الملف.',
    'document_request_closed' => 'هذا الطلب لم يعد مفتوحاً.',
    'document_request_cancelled' => 'تم إلغاء طلب المستند.',
    'document_supplied' => 'تم رفع المستند وإرساله إلى المكتب.',
    'document_request_not_fulfilled' => 'لا يمكن طلب نسخة جديدة إلا بعد وصول المستند.',
    'document_delete_settled' => 'لا يمكن حذف المستندات بعد إغلاق المشروع.',
    'document_deleted' => 'تم حذف المستند، ويمكنك رفع نسخة أخرى.',
    'document_kind' => [
        'identity' => 'إثبات هوية',
        'supporting' => 'مستند داعم',
    ],
    'status' => [
        'draft' => 'مسودة',
        'available' => 'متاح',
        'claimed' => 'قيد التنفيذ',
        'delivered' => 'تم التسليم',
        'in_review' => 'قيد المراجعة',
        'revision_requested' => 'مطلوب تعديل',
        'approved' => 'معتمد',
        'completed' => 'مكتمل',
        'archived' => 'مؤرشف',
        'cancelled' => 'ملغي',
    ],

    'revision_attachment' => 'المرفق',
];
