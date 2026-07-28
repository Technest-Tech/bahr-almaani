<?php

namespace Tests\Feature;

use App\Http\Requests\StoreLetterheadTemplateRequest;
use App\Models\Language;
use App\Models\LetterheadTemplate;
use App\Models\Project;
use App\Models\User;
use Database\Seeders\LanguageSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class LetterheadTemplateTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $pm;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        Storage::fake('local');

        $this->admin = User::factory()->create();
        $this->admin->syncRoles(['admin']);

        $this->pm = User::factory()->create();
        $this->pm->syncRoles(['project_manager']);
    }

    /** Multipart uploads must still ask for JSON, or failures redirect instead of 422. */
    private function asJson(User $user): static
    {
        return $this->actingAs($user, 'sanctum')->withHeader('Accept', 'application/json');
    }

    public function test_admin_can_upload_a_letterhead_with_default_placement(): void
    {
        $response = $this->asJson($this->admin)->post('/api/v1/letterheads', [
            'name' => 'ترويسة بحر المعاني الرسمية',
            'kind' => 'letterhead',
            'asset' => UploadedFile::fake()->image('letterhead.png', 1240, 1754),
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.name', 'ترويسة بحر المعاني الرسمية')
            ->assertJsonPath('data.kind', 'letterhead')
            ->assertJsonPath('data.is_active', true)
            // Normalized on write so MergeFinalFileJob never reads a missing key.
            ->assertJsonPath('data.placement.pages', 'all')
            ->assertJsonPath('data.placement.anchor', 'top-center')
            ->assertJsonPath('data.placement.layer', 'background')
            ->assertJsonPath('data.placement.width_mm', null);

        $template = LetterheadTemplate::firstOrFail();
        Storage::disk('local')->assertExists($template->disk_path);
    }

    public function test_stamp_gets_stamp_defaults_and_accepts_a_custom_placement(): void
    {
        $this->asJson($this->admin)->post('/api/v1/letterheads', [
            'name' => 'ختم الاعتماد',
            'kind' => 'stamp',
            'asset' => UploadedFile::fake()->image('stamp.png', 400, 400),
        ])->assertCreated()
            ->assertJsonPath('data.placement.pages', 'last')
            ->assertJsonPath('data.placement.anchor', 'bottom-right')
            ->assertJsonPath('data.placement.width_mm', 45)
            ->assertJsonPath('data.placement.layer', 'foreground');

        $this->asJson($this->admin)->post('/api/v1/letterheads', [
            'name' => 'ختم جانبي',
            'kind' => 'stamp',
            'asset' => UploadedFile::fake()->image('stamp2.png', 400, 400),
            'placement' => json_encode([
                'pages' => 'all',
                'anchor' => 'bottom-left',
                'offset_x_mm' => 12.5,
                'offset_y_mm' => 8,
                'width_mm' => 30,
                'opacity' => 0.6,
                'layer' => 'foreground',
            ]),
        ])->assertCreated()
            ->assertJsonPath('data.placement.pages', 'all')
            ->assertJsonPath('data.placement.anchor', 'bottom-left')
            ->assertJsonPath('data.placement.offset_x_mm', 12.5)
            ->assertJsonPath('data.placement.opacity', 0.6);
    }

    public function test_asset_must_be_an_image_or_pdf_within_the_size_limit(): void
    {
        $this->asJson($this->admin)->post('/api/v1/letterheads', [
            'name' => 'ملف غير مدعوم',
            'kind' => 'letterhead',
            'asset' => UploadedFile::fake()->create('template.docx', 12, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
        ])->assertUnprocessable()->assertJsonValidationErrors('asset');

        // Track the constant, not a literal — the cap moved to 25 MB once the
        // client's own 17 MB letterhead scan turned up (M9b).
        $this->asJson($this->admin)->post('/api/v1/letterheads', [
            'name' => 'ملف ضخم',
            'kind' => 'letterhead',
            'asset' => UploadedFile::fake()->create(
                'huge.pdf',
                StoreLetterheadTemplateRequest::MAX_ASSET_KB + 1,
                'application/pdf',
            ),
        ])->assertUnprocessable()->assertJsonValidationErrors('asset');

        $this->asJson($this->admin)->post('/api/v1/letterheads', [
            'name' => 'بدون نوع',
            'asset' => UploadedFile::fake()->image('x.png'),
        ])->assertUnprocessable()->assertJsonValidationErrors('kind');

        $this->assertSame(0, LetterheadTemplate::count());
    }

    public function test_a_pdf_asset_is_accepted(): void
    {
        $this->asJson($this->admin)->post('/api/v1/letterheads', [
            'name' => 'ترويسة PDF',
            'kind' => 'letterhead',
            'asset' => UploadedFile::fake()->create('letterhead.pdf', 120, 'application/pdf'),
        ])->assertCreated()->assertJsonPath('data.mime_type', 'pdf');
    }

    public function test_update_changes_metadata_and_replaces_the_asset(): void
    {
        $created = $this->asJson($this->admin)->post('/api/v1/letterheads', [
            'name' => 'ترويسة قديمة',
            'kind' => 'letterhead',
            'asset' => UploadedFile::fake()->image('old.png'),
        ])->json('data');

        $oldPath = LetterheadTemplate::findOrFail($created['id'])->disk_path;

        // Multipart cannot send PUT — the UI spoofs the method, as Laravel expects.
        $this->asJson($this->admin)->post("/api/v1/letterheads/{$created['id']}", [
            '_method' => 'PUT',
            'name' => 'ترويسة محدثة',
            'is_active' => '0',
            'asset' => UploadedFile::fake()->image('new.png'),
            'placement' => json_encode(['anchor' => 'middle-center', 'opacity' => 0.35]),
        ])->assertOk()
            ->assertJsonPath('data.name', 'ترويسة محدثة')
            ->assertJsonPath('data.is_active', false)
            ->assertJsonPath('data.placement.anchor', 'middle-center')
            ->assertJsonPath('data.placement.opacity', 0.35)
            // Unset keys fall back to the kind defaults, never to null.
            ->assertJsonPath('data.placement.pages', 'all');

        $template = LetterheadTemplate::findOrFail($created['id']);
        $this->assertNotSame($oldPath, $template->disk_path);
        Storage::disk('local')->assertMissing($oldPath);
        Storage::disk('local')->assertExists($template->disk_path);
    }

    public function test_kind_cannot_be_changed_after_creation(): void
    {
        $template = LetterheadTemplate::factory()->create(['created_by' => $this->admin->id]);

        $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/v1/letterheads/{$template->id}", ['kind' => 'stamp'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('kind');
    }

    public function test_index_filters_by_kind_and_active_flag(): void
    {
        LetterheadTemplate::factory()->create(['created_by' => $this->admin->id]);
        LetterheadTemplate::factory()->inactive()->create(['created_by' => $this->admin->id]);
        LetterheadTemplate::factory()->stamp()->create(['created_by' => $this->admin->id]);

        $this->actingAs($this->admin, 'sanctum')->getJson('/api/v1/letterheads')
            ->assertOk()->assertJsonCount(3, 'data');

        $this->actingAs($this->admin, 'sanctum')->getJson('/api/v1/letterheads?kind=stamp')
            ->assertOk()->assertJsonCount(1, 'data');

        $this->actingAs($this->admin, 'sanctum')->getJson('/api/v1/letterheads?kind=letterhead&active=1')
            ->assertOk()->assertJsonCount(1, 'data');
    }

    public function test_asset_streams_to_authorised_users_only(): void
    {
        $this->asJson($this->admin)->post('/api/v1/letterheads', [
            'name' => 'ترويسة',
            'kind' => 'letterhead',
            'asset' => UploadedFile::fake()->image('letterhead.png'),
        ])->assertCreated();

        $template = LetterheadTemplate::firstOrFail();

        $this->actingAs($this->admin, 'sanctum')
            ->get("/api/v1/letterheads/{$template->id}/asset")
            ->assertOk();

        // PMs need previews for the approval dialog (letterheads.view).
        $this->actingAs($this->pm, 'sanctum')
            ->get("/api/v1/letterheads/{$template->id}/asset")
            ->assertOk();

        $translator = User::factory()->create();
        $translator->syncRoles(['translator']);

        $this->actingAs($translator, 'sanctum')
            ->getJson("/api/v1/letterheads/{$template->id}/asset")
            ->assertForbidden();
    }

    public function test_view_permission_does_not_grant_management(): void
    {
        $template = LetterheadTemplate::factory()->create(['created_by' => $this->admin->id]);

        // The PM role carries letterheads.view but not letterheads.manage.
        $this->actingAs($this->pm, 'sanctum')->getJson('/api/v1/letterheads')->assertOk();

        $this->asJson($this->pm)->post('/api/v1/letterheads', [
            'name' => 'محاولة',
            'kind' => 'letterhead',
            'asset' => UploadedFile::fake()->image('x.png'),
        ])->assertForbidden();

        $this->actingAs($this->pm, 'sanctum')
            ->putJson("/api/v1/letterheads/{$template->id}", ['name' => 'محاولة'])
            ->assertForbidden();

        $this->actingAs($this->pm, 'sanctum')
            ->deleteJson("/api/v1/letterheads/{$template->id}")
            ->assertForbidden();
    }

    public function test_translator_cannot_see_letterheads_at_all(): void
    {
        $translator = User::factory()->create();
        $translator->syncRoles(['translator']);

        $this->actingAs($translator, 'sanctum')->getJson('/api/v1/letterheads')->assertForbidden();
    }

    public function test_delete_removes_the_asset_but_is_blocked_while_in_use(): void
    {
        $this->seed(LanguageSeeder::class);

        $letterhead = LetterheadTemplate::factory()->create(['created_by' => $this->admin->id]);
        $stamp = LetterheadTemplate::factory()->stamp()->create(['created_by' => $this->admin->id]);
        $unused = LetterheadTemplate::factory()->create(['created_by' => $this->admin->id]);

        Storage::disk('local')->put($unused->disk_path, 'binary');

        Project::create([
            'code' => 'BM-2026-70001',
            'title' => 'مشروع معتمد',
            'source_language_id' => Language::where('code', 'en')->firstOrFail()->id,
            'target_language_id' => Language::where('code', 'ar')->firstOrFail()->id,
            'service_type' => 'certified',
            'priority' => 'normal',
            'status' => Project::STATUS_COMPLETED,
            'deadline_at' => now()->addDay(),
            'created_by' => $this->admin->id,
            'letterhead_id' => $letterhead->id,
            'stamp_id' => $stamp->id,
        ]);

        $this->actingAs($this->admin, 'sanctum')
            ->deleteJson("/api/v1/letterheads/{$letterhead->id}")
            ->assertStatus(422);

        $this->actingAs($this->admin, 'sanctum')
            ->deleteJson("/api/v1/letterheads/{$stamp->id}")
            ->assertStatus(422);

        $this->actingAs($this->admin, 'sanctum')
            ->deleteJson("/api/v1/letterheads/{$unused->id}")
            ->assertOk();

        $this->assertDatabaseMissing('letterhead_templates', ['id' => $unused->id]);
        Storage::disk('local')->assertMissing($unused->disk_path);
    }

    public function test_in_use_flag_is_reported_to_the_gallery(): void
    {
        $this->seed(LanguageSeeder::class);

        $letterhead = LetterheadTemplate::factory()->create(['created_by' => $this->admin->id]);
        $unused = LetterheadTemplate::factory()->create(['created_by' => $this->admin->id]);

        Project::create([
            'code' => 'BM-2026-70002',
            'title' => 'مشروع',
            'source_language_id' => Language::where('code', 'en')->firstOrFail()->id,
            'target_language_id' => Language::where('code', 'ar')->firstOrFail()->id,
            'service_type' => 'certified',
            'priority' => 'normal',
            'status' => Project::STATUS_COMPLETED,
            'deadline_at' => now()->addDay(),
            'created_by' => $this->admin->id,
            'letterhead_id' => $letterhead->id,
        ]);

        $data = collect($this->actingAs($this->admin, 'sanctum')->getJson('/api/v1/letterheads')->json('data'))
            ->keyBy('id');

        $this->assertTrue($data[$letterhead->id]['in_use']);
        $this->assertFalse($data[$unused->id]['in_use']);
    }
}
