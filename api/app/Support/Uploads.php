<?php

namespace App\Support;

/**
 * How large an uploaded file may be, in one place.
 *
 * Three gates sit in front of this rule and every one of them is lower-bound by
 * it: nginx's `client_max_body_size`, php.ini's `post_max_size` and
 * `upload_max_filesize`. The two body limits also have to carry a whole delivery
 * — the portal posts every file of one delivery in a single request — so they are
 * deliberately larger than one file. UploadLimitsTest keeps all of them in step,
 * because when nginx is the lowest the upload dies at the proxy: the browser has
 * already sent the whole file and gets back an HTML 413 the app never sees, which
 * is how an 82.5 MB delivery read as "rar files don't work" (2026-09-23).
 */
final class Uploads
{
    /** 200 MB — a scanned certified job, or an archive of one. */
    public const MAX_FILE_KB = 204800;

    /** Rules for one uploaded file, whatever the endpoint. */
    public static function rules(): array
    {
        return ['file', 'max:'.self::MAX_FILE_KB];
    }
}
