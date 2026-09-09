<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\DocumentRequest;
use App\Models\Language;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Models\User;
use App\Notifications\DocumentReplacementRequestedNotification;
use App\Notifications\DocumentRequestedNotification;
use App\Notifications\DocumentSuppliedNotification;
use App\Notifications\DocumentWithdrawnNotification;
use Database\Seeders\LanguageSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * "This certificate needs an ID attached" — the office asks, the client answers.
 *
 * Two properties carry the feature. First, an ID belongs to a FILE, not to a
 * project: a visa batch holds four certificates and the answer to "whose ID?" has
 * to survive. Second, the client's upload is the first write the client area has
 * ever had, so its edges are the interesting part — it may only ever answer an
 * open request on the client's own project, and it may never produce a source file.
 */
class DocumentRequestTest extends TestCase
{
    use RefreshDatabase;

    private User $pm;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->seed(LanguageSeeder::class);
        Storage::fake('local');

        $this->pm = User::factory()->create();
        $this->pm->syncRoles(['project_manager']);
    }

    private function client(array $attributes = []): Client
    {
        return Client::create([
            'name' => 'شركة النور',
            'type' => 'company',
            'email' => 'noor@example.com',
            'password' => 'secret-passphrase',
            'created_by' => $this->pm->id,
            ...$attributes,
        ]);
    }

    private function project(?Client $client = null, array $attributes = []): Project
    {
        return Project::create([
            'code' => 'BM-2026-'.str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT),
            'client_id' => $client?->id,
            'title' => 'شهادة ميلاد',
            'source_language_id' => Language::where('code', 'ar')->first()->id,
            'target_language_id' => Language::where('code', 'en')->first()->id,
            'service_type' => 'certified',
            'priority' => 'normal',
            'status' => Project::STATUS_CLAIMED,
            'deadline_at' => now()->addDay(),
            'created_by' => $this->pm->id,
            ...$attributes,
        ]);
    }

    private function sourceFile(Project $project, string $name = 'شهادة-ميلاد.pdf'): ProjectFile
    {
        return $project->files()->create([
            'category' => ProjectFile::CATEGORY_SOURCE,
            'uploaded_by' => $this->pm->id,
            'original_name' => $name,
            'disk_path' => "projects/{$project->id}/source/".uniqid().'.pdf',
            'mime_type' => 'application/pdf',
            'size_bytes' => 1024,
            'count_status' => ProjectFile::COUNT_DONE,
        ]);
    }

    private function request(Project $project, ProjectFile $file, array $attributes = []): DocumentRequest
    {
        return $project->documentRequests()->create([
            'project_file_id' => $file->id,
            'kind' => DocumentRequest::KIND_IDENTITY,
            'requested_by' => $this->pm->id,
            ...$attributes,
        ]);
    }

    public function test_pm_asks_the_client_for_an_identity_document(): void
    {
        Notification::fake();

        $client = $this->client();
        $project = $this->project($client);
        $file = $this->sourceFile($project);

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/document-requests", [
                'project_file_id' => $file->id,
                'kind' => 'identity',
                'note' => 'نحتاج بطاقة صاحب الشهادة لضبط تهجئة الاسم.',
            ])
            ->assertCreated()
            ->assertJsonPath('data.kind', 'identity')
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.project_file_id', $file->id)
            ->assertJsonPath('data.file_name', 'شهادة-ميلاد.pdf');

        $this->assertDatabaseHas('document_requests', [
            'project_id' => $project->id,
            'project_file_id' => $file->id,
            'status' => DocumentRequest::STATUS_PENDING,
            'requested_by' => $this->pm->id,
        ]);

        Notification::assertSentTo($client, DocumentRequestedNotification::class);
    }

    /** Two identical open asks would give the client two boxes for one document. */
    public function test_the_same_ask_cannot_be_made_twice_while_it_is_open(): void
    {
        $project = $this->project($this->client());
        $file = $this->sourceFile($project);
        $this->request($project, $file);

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/document-requests", [
                'project_file_id' => $file->id,
                'kind' => 'identity',
            ])
            ->assertUnprocessable();

        $this->assertSame(1, $project->documentRequests()->count());
    }

    /** A request must not be able to name a file belonging to somebody else's job. */
    public function test_the_named_file_must_belong_to_the_project(): void
    {
        $project = $this->project($this->client());
        $other = $this->project($this->client(['email' => 'other@example.com']));
        $foreignFile = $this->sourceFile($other);

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/document-requests", [
                'project_file_id' => $foreignFile->id,
                'kind' => 'identity',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('project_file_id');
    }

    public function test_a_closed_project_takes_no_new_requests(): void
    {
        $project = $this->project($this->client(), ['status' => Project::STATUS_COMPLETED]);
        $file = $this->sourceFile($project);

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/document-requests", [
                'project_file_id' => $file->id,
                'kind' => 'identity',
            ])
            ->assertUnprocessable();
    }

    public function test_the_pm_can_withdraw_an_ask(): void
    {
        $project = $this->project($this->client());
        $documentRequest = $this->request($project, $this->sourceFile($project));

        $this->actingAs($this->pm, 'sanctum')
            ->deleteJson("/api/v1/projects/{$project->id}/document-requests/{$documentRequest->id}")
            ->assertOk();

        $this->assertSame(DocumentRequest::STATUS_CANCELLED, $documentRequest->fresh()->status);
        $this->assertNotNull($documentRequest->fresh()->cancelled_at);
    }

    /* ---------------------------------------------------------------- client */

    public function test_the_client_sees_the_open_ask_on_their_project(): void
    {
        $client = $this->client();
        $project = $this->project($client);
        $file = $this->sourceFile($project);
        $this->request($project, $file, ['note' => 'صورة البطاقة من الوجهين.']);

        $this->actingAs($client, 'client')
            ->getJson("/api/v1/client/projects/{$project->id}")
            ->assertOk()
            ->assertJsonPath('data.document_requests.0.kind', 'identity')
            ->assertJsonPath('data.document_requests.0.status', 'pending')
            ->assertJsonPath('data.document_requests.0.note', 'صورة البطاقة من الوجهين.')
            ->assertJsonPath('data.document_requests.0.file_name', 'شهادة-ميلاد.pdf');
    }

    /** Their list has to say which project is waiting on them, not just ours. */
    public function test_the_clients_own_list_flags_the_project_waiting_on_them(): void
    {
        $client = $this->client();
        $project = $this->project($client);
        $documentRequest = $this->request($project, $this->sourceFile($project));

        $listed = collect(
            $this->actingAs($client, 'client')->getJson('/api/v1/client/projects')->json('data'),
        )->firstWhere('id', $project->id);

        $this->assertTrue($listed['awaiting_documents']);

        $documentRequest->markFulfilled();

        $listed = collect(
            $this->actingAs($client, 'client')->getJson('/api/v1/client/projects')->json('data'),
        )->firstWhere('id', $project->id);

        $this->assertFalse($listed['awaiting_documents']);
    }

    public function test_the_client_uploads_the_document_and_it_lands_on_the_right_file(): void
    {
        Notification::fake();

        $client = $this->client();
        $project = $this->project($client);
        $file = $this->sourceFile($project);
        $documentRequest = $this->request($project, $file);

        $this->actingAs($client, 'client')
            ->post("/api/v1/client/projects/{$project->id}/files", [
                'document_request_id' => $documentRequest->id,
                // A national ID is two sides — one request, several files.
                'files' => [
                    UploadedFile::fake()->image('id-front.jpg'),
                    UploadedFile::fake()->image('id-back.jpg'),
                ],
            ])
            ->assertCreated()
            ->assertJsonPath('data.status', 'fulfilled')
            ->assertJsonCount(2, 'data.attachments');

        $attachments = $project->files()->where('category', ProjectFile::CATEGORY_REFERENCE)->get();

        $this->assertCount(2, $attachments);

        foreach ($attachments as $attachment) {
            // The whole point: the ID hangs off the certificate, not off the project.
            $this->assertSame($file->id, $attachment->parent_file_id);
            $this->assertSame($documentRequest->id, $attachment->document_request_id);
            // A client is not staff and has no `users` row to point at.
            $this->assertNull($attachment->uploaded_by);
            $this->assertSame($client->id, $attachment->uploaded_by_client_id);
            // Never counted: a supporting document is not part of the quote basis.
            $this->assertSame(ProjectFile::COUNT_NOT_APPLICABLE, $attachment->count_status);
            Storage::disk('local')->assertExists($attachment->disk_path);
        }

        $this->assertSame(DocumentRequest::STATUS_FULFILLED, $documentRequest->fresh()->status);
        $this->assertNotNull($documentRequest->fresh()->fulfilled_at);

        Notification::assertSentTo($this->pm, DocumentSuppliedNotification::class);
    }

    /** No open request, no upload — the portal is not a general inbox. */
    public function test_the_client_cannot_upload_without_an_open_request(): void
    {
        $client = $this->client();
        $project = $this->project($client);
        $documentRequest = $this->request($project, $this->sourceFile($project));
        $documentRequest->markFulfilled();

        $this->actingAs($client, 'client')
            ->post("/api/v1/client/projects/{$project->id}/files", [
                'document_request_id' => $documentRequest->id,
                'files' => [UploadedFile::fake()->image('again.jpg')],
            ])
            ->assertNotFound();

        $this->assertSame(0, $project->files()->where('category', ProjectFile::CATEGORY_REFERENCE)->count());
    }

    public function test_a_client_cannot_answer_another_clients_request(): void
    {
        $mine = $this->client();
        $theirs = $this->client(['email' => 'other@example.com']);
        $project = $this->project($theirs);
        $documentRequest = $this->request($project, $this->sourceFile($project));

        $this->actingAs($mine, 'client')
            ->post("/api/v1/client/projects/{$project->id}/files", [
                'document_request_id' => $documentRequest->id,
                'files' => [UploadedFile::fake()->image('id.jpg')],
            ])
            ->assertNotFound();
    }

    /** Identity papers off the open internet: photos and PDFs, nothing executable. */
    public function test_the_client_upload_refuses_a_file_type_it_does_not_take(): void
    {
        $client = $this->client();
        $project = $this->project($client);
        $documentRequest = $this->request($project, $this->sourceFile($project));

        $this->actingAs($client, 'client')
            ->postJson("/api/v1/client/projects/{$project->id}/files", [
                'document_request_id' => $documentRequest->id,
                'files' => [UploadedFile::fake()->create('macro.docm', 20, 'application/vnd.ms-word.document.macroEnabled.12')],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('files.0');

        $this->assertSame(DocumentRequest::STATUS_PENDING, $documentRequest->fresh()->status);
    }

    /* ------------------------------------------------------------ visibility */

    public function test_the_client_sees_and_downloads_what_they_supplied_but_not_the_offices_own_notes(): void
    {
        $client = $this->client();
        $project = $this->project($client);
        $file = $this->sourceFile($project);
        $documentRequest = $this->request($project, $file);

        $this->actingAs($client, 'client')->post("/api/v1/client/projects/{$project->id}/files", [
            'document_request_id' => $documentRequest->id,
            'files' => [UploadedFile::fake()->image('id.jpg')],
        ])->assertCreated();

        // An internal supporting document: a glossary the office attached itself.
        $internal = $project->files()->create([
            'category' => ProjectFile::CATEGORY_REFERENCE,
            'uploaded_by' => $this->pm->id,
            'original_name' => 'مسرد-داخلي.txt',
            'disk_path' => "projects/{$project->id}/reference/internal.txt",
            'size_bytes' => 10,
            'count_status' => ProjectFile::COUNT_NOT_APPLICABLE,
        ]);
        Storage::disk('local')->put($internal->disk_path, 'internal');

        $supplied = $project->files()->whereNotNull('document_request_id')->firstOrFail();

        $names = collect(
            $this->actingAs($client, 'client')
                ->getJson("/api/v1/client/projects/{$project->id}")
                ->assertOk()
                ->json('data.files'),
        )->pluck('original_name');

        $this->assertTrue($names->contains('id.jpg'));
        $this->assertFalse($names->contains('مسرد-داخلي.txt'));

        $this->actingAs($client, 'client')
            ->get("/api/v1/client/projects/{$project->id}/files/{$supplied->id}/download")
            ->assertOk();

        $this->actingAs($client, 'client')
            ->get("/api/v1/client/projects/{$project->id}/files/{$internal->id}/download")
            ->assertNotFound();
    }

    /* --------------------------------------------------- the wrong document */

    /**
     * The office rejects what arrived and asks again.
     *
     * The load-bearing part is what happens to the wrong file: it is superseded,
     * not deleted — the record of what the client handed in survives — but it stops
     * answering the request and, above all, leaves the translator's file list.
     */
    public function test_the_office_can_ask_again_when_the_wrong_document_arrives(): void
    {
        Notification::fake();

        $client = $this->client();
        $project = $this->project($client);
        $file = $this->sourceFile($project);
        $documentRequest = $this->request($project, $file);

        $this->actingAs($client, 'client')->post("/api/v1/client/projects/{$project->id}/files", [
            'document_request_id' => $documentRequest->id,
            'files' => [UploadedFile::fake()->image('blurry.jpg')],
        ])->assertCreated();

        $wrong = $project->files()->where('original_name', 'blurry.jpg')->firstOrFail();

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/document-requests/{$documentRequest->id}/reopen", [
                'note' => 'الصورة غير واضحة، من فضلك أعد التصوير في إضاءة أفضل.',
            ])
            ->assertOk()
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.note', 'الصورة غير واضحة، من فضلك أعد التصوير في إضاءة أفضل.');

        $this->assertNotNull($wrong->fresh()->superseded_at);
        $this->assertNull($documentRequest->fresh()->fulfilled_at);
        $this->assertSame(0, $documentRequest->currentAttachments()->count());
        // Superseded, not gone: the office can still see what the client sent.
        $this->assertSame(1, $documentRequest->attachments()->count());

        Notification::assertSentTo($client, DocumentReplacementRequestedNotification::class);

        // And the box is back, so the client can answer it properly.
        $this->actingAs($client, 'client')
            ->post("/api/v1/client/projects/{$project->id}/files", [
                'document_request_id' => $documentRequest->id,
                'files' => [UploadedFile::fake()->image('sharp.jpg')],
            ])
            ->assertCreated();

        $this->assertSame(DocumentRequest::STATUS_FULFILLED, $documentRequest->fresh()->status);
        $this->assertSame(
            ['sharp.jpg'],
            $documentRequest->currentAttachments()->pluck('original_name')->all(),
        );
    }

    /**
     * The client's payload has to carry `superseded_at`, not just the file name.
     *
     * Pinned because it is served through a partial column select, and dropping the
     * field there does not fail loudly — the rejected file simply reads as current,
     * the client is offered a delete button for it, and the delete 404s.
     */
    public function test_the_client_is_told_which_of_their_files_was_rejected(): void
    {
        $client = $this->client();
        $project = $this->project($client);
        $documentRequest = $this->request($project, $this->sourceFile($project));

        $this->actingAs($client, 'client')->post("/api/v1/client/projects/{$project->id}/files", [
            'document_request_id' => $documentRequest->id,
            'files' => [UploadedFile::fake()->image('rejected.jpg')],
        ])->assertCreated();

        $documentRequest->reopen('الصورة غير واضحة.');

        $attachment = collect(
            $this->actingAs($client, 'client')
                ->getJson("/api/v1/client/projects/{$project->id}")
                ->assertOk()
                ->assertJsonPath('data.document_requests.0.status', 'pending')
                ->json('data.document_requests.0.attachments'),
        )->firstWhere('original_name', 'rejected.jpg');

        $this->assertNotNull($attachment['superseded_at'] ?? null);
    }

    /** The whole point of superseding: the translator must not see both ID cards. */
    public function test_a_superseded_document_leaves_the_translators_file_list(): void
    {
        $client = $this->client();
        $project = $this->project($client, ['status' => Project::STATUS_AVAILABLE]);
        $file = $this->sourceFile($project);
        $documentRequest = $this->request($project, $file);

        $this->actingAs($client, 'client')->post("/api/v1/client/projects/{$project->id}/files", [
            'document_request_id' => $documentRequest->id,
            'files' => [UploadedFile::fake()->image('wrong-person.jpg')],
        ])->assertCreated();

        $translator = User::factory()->create();
        $translator->syncRoles(['translator']);

        $this->actingAs($translator, 'sanctum')
            ->postJson("/api/v1/portal/claim/{$project->id}")
            ->assertCreated();

        $names = fn (): array => collect(
            $this->actingAs($translator, 'sanctum')->getJson('/api/v1/portal/current')->json('data.project.files'),
        )->pluck('original_name')->all();

        $this->assertContains('wrong-person.jpg', $names());

        $documentRequest->reopen('هذه بطاقة شخص آخر.');

        $this->assertNotContains('wrong-person.jpg', $names());

        // Not even by id: a stale tab still holds it.
        $superseded = $project->files()->whereNotNull('superseded_at')->firstOrFail();

        $this->actingAs($translator, 'sanctum')
            ->get("/api/v1/portal/files/{$superseded->id}/download")
            ->assertNotFound();
    }

    /**
     * "I uploaded the wrong photo" — the client fixes it themselves.
     *
     * Deleting the last file answering a request reopens it, which is what puts the
     * upload box back. Without that the client is stuck: the upload closed the
     * request, so the only way to correct it was to ask the office to ask again.
     */
    public function test_the_client_can_delete_their_own_upload_and_the_request_reopens(): void
    {
        Notification::fake();

        $client = $this->client();
        $project = $this->project($client);
        $documentRequest = $this->request($project, $this->sourceFile($project));

        $this->actingAs($client, 'client')->post("/api/v1/client/projects/{$project->id}/files", [
            'document_request_id' => $documentRequest->id,
            'files' => [UploadedFile::fake()->image('oops.jpg')],
        ])->assertCreated();

        $wrong = $project->files()->where('original_name', 'oops.jpg')->firstOrFail();
        $path = $wrong->disk_path;

        $this->actingAs($client, 'client')
            ->deleteJson("/api/v1/client/projects/{$project->id}/files/{$wrong->id}")
            ->assertOk()
            ->assertJsonPath('data.status', 'pending');

        $this->assertDatabaseMissing('project_files', ['id' => $wrong->id]);
        Storage::disk('local')->assertMissing($path);
        $this->assertSame(DocumentRequest::STATUS_PENDING, $documentRequest->fresh()->status);
        $this->assertNull($documentRequest->fresh()->fulfilled_at);

        // The office is told, because a PM may already be working from that scan.
        Notification::assertSentTo($this->pm, DocumentWithdrawnNotification::class);

        $this->actingAs($client, 'client')
            ->post("/api/v1/client/projects/{$project->id}/files", [
                'document_request_id' => $documentRequest->id,
                'files' => [UploadedFile::fake()->image('correct.jpg')],
            ])
            ->assertCreated();
    }

    /** Two files, one deleted: the request is still answered by the other. */
    public function test_deleting_one_of_two_files_leaves_the_request_answered(): void
    {
        $client = $this->client();
        $project = $this->project($client);
        $documentRequest = $this->request($project, $this->sourceFile($project));

        $this->actingAs($client, 'client')->post("/api/v1/client/projects/{$project->id}/files", [
            'document_request_id' => $documentRequest->id,
            'files' => [UploadedFile::fake()->image('front.jpg'), UploadedFile::fake()->image('back.jpg')],
        ])->assertCreated();

        $front = $project->files()->where('original_name', 'front.jpg')->firstOrFail();

        $this->actingAs($client, 'client')
            ->deleteJson("/api/v1/client/projects/{$project->id}/files/{$front->id}")
            ->assertOk();

        $this->assertSame(DocumentRequest::STATUS_FULFILLED, $documentRequest->fresh()->status);
        $this->assertSame(1, $documentRequest->currentAttachments()->count());
    }

    public function test_a_client_cannot_delete_a_file_that_is_not_theirs_to_delete(): void
    {
        $client = $this->client();
        $project = $this->project($client);
        $source = $this->sourceFile($project);
        $documentRequest = $this->request($project, $source);

        // The office's own supporting document, uploaded on the client's behalf.
        $this->actingAs($this->pm, 'sanctum')->post("/api/v1/projects/{$project->id}/files", [
            'category' => 'reference',
            'document_request_id' => $documentRequest->id,
            'files' => [UploadedFile::fake()->image('from-whatsapp.jpg')],
        ])->assertCreated();

        $officeUpload = $project->files()->where('original_name', 'from-whatsapp.jpg')->firstOrFail();

        // Not theirs — they did not upload it.
        $this->actingAs($client, 'client')
            ->deleteJson("/api/v1/client/projects/{$project->id}/files/{$officeUpload->id}")
            ->assertNotFound();

        // Nor the work file, which is the job itself.
        $this->actingAs($client, 'client')
            ->deleteJson("/api/v1/client/projects/{$project->id}/files/{$source->id}")
            ->assertNotFound();

        $this->assertDatabaseHas('project_files', ['id' => $officeUpload->id]);
        $this->assertDatabaseHas('project_files', ['id' => $source->id]);
    }

    /** What the office has already rejected is the record of the job, not theirs. */
    public function test_a_client_cannot_delete_a_superseded_document(): void
    {
        $client = $this->client();
        $project = $this->project($client);
        $documentRequest = $this->request($project, $this->sourceFile($project));

        $this->actingAs($client, 'client')->post("/api/v1/client/projects/{$project->id}/files", [
            'document_request_id' => $documentRequest->id,
            'files' => [UploadedFile::fake()->image('wrong.jpg')],
        ])->assertCreated();

        $documentRequest->reopen('بطاقة شخص آخر.');

        $superseded = $project->files()->whereNotNull('superseded_at')->firstOrFail();

        $this->actingAs($client, 'client')
            ->deleteJson("/api/v1/client/projects/{$project->id}/files/{$superseded->id}")
            ->assertNotFound();

        $this->assertDatabaseHas('project_files', ['id' => $superseded->id]);
    }

    public function test_a_settled_project_takes_no_replacement_and_no_deletion(): void
    {
        $client = $this->client();
        $project = $this->project($client);
        $documentRequest = $this->request($project, $this->sourceFile($project));

        $this->actingAs($client, 'client')->post("/api/v1/client/projects/{$project->id}/files", [
            'document_request_id' => $documentRequest->id,
            'files' => [UploadedFile::fake()->image('id.jpg')],
        ])->assertCreated();

        $supplied = $project->files()->whereNotNull('document_request_id')->firstOrFail();
        $project->forceFill(['status' => Project::STATUS_COMPLETED])->save();

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/document-requests/{$documentRequest->id}/reopen", [
                'note' => 'متأخر جداً.',
            ])
            ->assertUnprocessable();

        $this->actingAs($client, 'client')
            ->deleteJson("/api/v1/client/projects/{$project->id}/files/{$supplied->id}")
            ->assertUnprocessable();
    }

    /** A pending request has nothing to replace, so re-asking makes no sense. */
    public function test_a_request_that_was_never_answered_cannot_be_re_asked(): void
    {
        $project = $this->project($this->client());
        $documentRequest = $this->request($project, $this->sourceFile($project));

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/document-requests/{$documentRequest->id}/reopen", [
                'note' => 'من فضلك أعد الرفع.',
            ])
            ->assertUnprocessable();
    }

    /** The client must be told WHY, or they send the same photo back. */
    public function test_asking_again_requires_a_reason(): void
    {
        $client = $this->client();
        $project = $this->project($client);
        $documentRequest = $this->request($project, $this->sourceFile($project));

        $this->actingAs($client, 'client')->post("/api/v1/client/projects/{$project->id}/files", [
            'document_request_id' => $documentRequest->id,
            'files' => [UploadedFile::fake()->image('id.jpg')],
        ])->assertCreated();

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/document-requests/{$documentRequest->id}/reopen", [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('note');
    }

    /**
     * The office can remove a supporting document from a LIVE project.
     *
     * Everything else on a project is draft-only for good reason, but a document
     * request is answered after publication by definition — so without this a
     * stranger's passport scan would sit on the job with nobody able to remove it.
     */
    public function test_the_office_can_delete_a_request_attachment_after_the_draft(): void
    {
        $client = $this->client();
        $project = $this->project($client);
        $source = $this->sourceFile($project);
        $documentRequest = $this->request($project, $source);

        $this->actingAs($client, 'client')->post("/api/v1/client/projects/{$project->id}/files", [
            'document_request_id' => $documentRequest->id,
            'files' => [UploadedFile::fake()->image('someone-elses-id.jpg')],
        ])->assertCreated();

        $attachment = $project->files()->whereNotNull('document_request_id')->firstOrFail();

        $this->actingAs($this->pm, 'sanctum')
            ->deleteJson("/api/v1/projects/{$project->id}/files/{$attachment->id}")
            ->assertOk();

        $this->assertDatabaseMissing('project_files', ['id' => $attachment->id]);
        $this->assertSame(DocumentRequest::STATUS_PENDING, $documentRequest->fresh()->status);

        // The work file keeps the old rule — the translator is holding it.
        $this->actingAs($this->pm, 'sanctum')
            ->deleteJson("/api/v1/projects/{$project->id}/files/{$source->id}")
            ->assertUnprocessable();
    }

    /* ---------------------------------------------------------------- office */

    /** The scan arrived on WhatsApp — the PM closes the request themselves. */
    public function test_the_pm_can_answer_a_request_on_the_clients_behalf(): void
    {
        $project = $this->project($this->client());
        $file = $this->sourceFile($project);
        $documentRequest = $this->request($project, $file);

        $this->actingAs($this->pm, 'sanctum')
            ->post("/api/v1/projects/{$project->id}/files", [
                'category' => 'reference',
                'document_request_id' => $documentRequest->id,
                'files' => [UploadedFile::fake()->image('whatsapp-id.jpg')],
            ])
            ->assertCreated();

        $attachment = $project->files()->where('category', ProjectFile::CATEGORY_REFERENCE)->firstOrFail();

        $this->assertSame($file->id, $attachment->parent_file_id);
        $this->assertSame($documentRequest->id, $attachment->document_request_id);
        $this->assertSame($this->pm->id, $attachment->uploaded_by);
        $this->assertSame(DocumentRequest::STATUS_FULFILLED, $documentRequest->fresh()->status);
    }

    /** A supporting document may hang off a file; the job itself may not. */
    public function test_a_source_upload_cannot_carry_an_attachment_link(): void
    {
        $project = $this->project($this->client(), ['status' => Project::STATUS_DRAFT]);
        $file = $this->sourceFile($project);

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/files", [
                'category' => 'source',
                'parent_file_id' => $file->id,
                'files' => [UploadedFile::fake()->create('page-2.pdf', 10, 'application/pdf')],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('parent_file_id');
    }

    public function test_the_board_flags_a_project_waiting_on_its_client(): void
    {
        $project = $this->project($this->client());
        $documentRequest = $this->request($project, $this->sourceFile($project));

        $this->actingAs($this->pm, 'sanctum')
            ->getJson("/api/v1/projects/{$project->id}")
            ->assertOk()
            ->assertJsonPath('data.awaiting_documents', true);

        $listed = collect(
            $this->actingAs($this->pm, 'sanctum')->getJson('/api/v1/projects')->json('data'),
        )->firstWhere('id', $project->id);

        $this->assertTrue($listed['awaiting_documents']);

        $documentRequest->markFulfilled();

        $this->actingAs($this->pm, 'sanctum')
            ->getJson("/api/v1/projects/{$project->id}")
            ->assertJsonPath('data.awaiting_documents', false);
    }

    /** The guard split holds: a staff token cannot post to the client area. */
    public function test_staff_cannot_reach_the_client_upload_route(): void
    {
        $project = $this->project($this->client());
        $documentRequest = $this->request($project, $this->sourceFile($project));

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/client/projects/{$project->id}/files", [
                'document_request_id' => $documentRequest->id,
                'files' => [UploadedFile::fake()->image('id.jpg')],
            ])
            ->assertUnauthorized();
    }
}
