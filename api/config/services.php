<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'gotenberg' => [
        'url' => env('GOTENBERG_URL', 'http://127.0.0.1:3300'),
    ],

    /*
     * Resolution letterhead artwork is re-encoded at on upload (App\Support\
     * AssetOptimizer). 300 matches A4 at scanner resolution, so it keeps every
     * original pixel — the client's 17.6 MB letterhead still came out at 280 KB,
     * because the weight was bad encoding rather than detail. Lower it only if the
     * office wants smaller files and has approved how the result looks on paper.
     */
    'ghostscript' => [
        'dpi' => (int) env('LETTERHEAD_DPI', 300),
    ],

];
