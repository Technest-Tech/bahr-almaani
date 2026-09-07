<?php

return [
    'has_projects' => 'A client with registered projects cannot be deleted.',

    // M15 — client website accounts
    'email_taken' => 'Another client account already uses this email address.',
    'email_registered' => 'We already have this email on file. Sign in if you have an account, otherwise contact the office to activate it.',
    'account_suspended' => 'This account has been suspended. Please contact the office.',

    /* Stages as the client sees them — never the internal production pipeline. */
    'stage' => [
        'in_progress' => 'In progress',
        'in_review' => 'Under review',
        'ready' => 'Ready to collect',
        'completed' => 'Completed',
        'cancelled' => 'Cancelled',
    ],

    'stage_hint' => [
        'in_progress' => 'Our translators are working on your documents.',
        'in_review' => 'Translation is done and under final review before certification.',
        'ready' => 'Your certified files are ready to download.',
        'completed' => 'This project has been delivered in full.',
        'cancelled' => 'This project was cancelled.',
    ],
];
