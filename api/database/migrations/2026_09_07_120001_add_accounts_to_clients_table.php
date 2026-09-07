<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('clients', function (Blueprint $table): void {
            $table->string('password')->nullable()->after('email');
            $table->string('status', 20)->default('active')->after('password'); // active | suspended
            $table->timestampTz('last_login_at')->nullable()->after('status');
            $table->boolean('self_registered')->default(false)->after('last_login_at');
        });

        // `created_by` is the staff member who added the row. A client who signs up
        // on the website has none, so the column stops being required.
        DB::statement('ALTER TABLE clients ALTER COLUMN created_by DROP NOT NULL');

        // Only accounts need a unique address: the office keeps walk-in rows that
        // share (or omit) an email, and a partial index leaves those alone while
        // still making the login lookup unambiguous. It also cannot fail on the
        // existing table — no row has a password yet.
        DB::statement(
            'CREATE UNIQUE INDEX clients_account_email_unique ON clients (lower(email)) '.
            'WHERE password IS NOT NULL AND deleted_at IS NULL'
        );
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS clients_account_email_unique');

        Schema::table('clients', function (Blueprint $table): void {
            $table->dropColumn(['password', 'status', 'last_login_at', 'self_registered']);
        });

        // created_by stays nullable deliberately: self-registered rows have no
        // staff creator, so restoring NOT NULL would fail on real data.
    }
};
