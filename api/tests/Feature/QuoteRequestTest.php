<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Language;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Models\QuoteRequest;
use App\Models\User;
use App\Notifications\QuoteRequestReceivedNotification;
use App\Notifications\QuoteRespondedNotification;
use App\Services\QuoteReferenceGenerator;
use Database\Seeders\LanguageSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class QuoteRequestTest extends TestCase
{
    use RefreshDatabase;

    private User $pm;

    private Language $english;

    private Language $arabic;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->seed(LanguageSeeder::class);

        $this->pm = User::factory()->create();
        $this->pm->syncRoles(['project_manager']);

        $this->english = Language::where('code', 'en')->firstOrFail();
        $this->arabic = Language::where('code', 'ar')->firstOrFail();
    }

    /** @return array<string, mixed> */
    private function payload(array $overrides = []): array
    {
        return [
            'name' => 'سامي عبد الله',
            'email' => 'sami@example.com',
            'phone' => '01000000000',
            'organization' => 'شركة النور',
            'title' => 'ترجمة عقد تأسيس',
            'source_language_id' => $this->english->id,
            'target_language_id' => $this->arabic->id,
            'service_type' => 'certified',
            'priority' => 'urgent',
            'declared_pages' => 12,
            'details' => 'العقد مكوّن من ١٢ صفحة ونحتاجه مصدقاً.',
            ...$overrides,
        ];
    }

    public function test_visitor_can_submit_a_request_with_attachments_and_gets_a_reference(): void
    {
        Storage::fake('local');
        Notification::fake();

        $response = $this->postJson('/api/v1/public/quote-requests', $this->payload([
            'files' => [
                UploadedFile::fake()->create('contract.pdf', 120, 'application/pdf'),
                UploadedFile::fake()->create('annex.docx', 40),
            ],
        ]))->assertCreated();

        $reference = $response->json('data.reference');
        $this->assertMatchesRegularExpression('/^RQ-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/', $reference);

        $quote = QuoteRequest::where('reference', $reference)->firstOrFail();
        $this->assertSame(QuoteRequest::STATUS_NEW, $quote->status);
        $this->assertCount(2, $quote->files);

        foreach ($quote->files as $file) {
            Storage::disk('local')->assertExists($file->disk_path);
        }

        // The visitor's own view never carries a price before we set one.
        $response->assertJsonPath('data.answered', false)->assertJsonPath('data.quote', null);

        Notification::assertSentTo($this->pm, QuoteRequestReceivedNotification::class);
    }

    public function test_submission_rejects_oversized_and_unsupported_attachments(): void
    {
        Storage::fake('local');

        $this->postJson('/api/v1/public/quote-requests', $this->payload([
            'files' => [UploadedFile::fake()->create('payload.exe', 20)],
        ]))->assertStatus(422)->assertJsonValidationErrors('files.0');

        $this->postJson('/api/v1/public/quote-requests', $this->payload([
            'files' => [UploadedFile::fake()->create('huge.pdf', 30000, 'application/pdf')],
        ]))->assertStatus(422)->assertJsonValidationErrors('files.0');
    }

    public function test_tracking_lookup_is_forgiving_about_formatting_and_hides_unanswered_prices(): void
    {
        Storage::fake('local');
        Notification::fake();

        $reference = $this->postJson('/api/v1/public/quote-requests', $this->payload())
            ->json('data.reference');

        // A manager types a price but hasn't sent it yet — nothing leaks.
        QuoteRequest::where('reference', $reference)->update([
            'quoted_amount' => 2500,
            'status' => QuoteRequest::STATUS_REVIEWING,
        ]);

        // Lowercase, spaces, and no prefix all resolve to the same request.
        $messy = strtolower(str_replace('RQ-', '', $reference));
        $this->getJson('/api/v1/public/quote-requests/'.urlencode($messy))
            ->assertOk()
            ->assertJsonPath('data.reference', $reference)
            ->assertJsonPath('data.answered', false)
            ->assertJsonPath('data.quote', null);

        $this->getJson('/api/v1/public/quote-requests/RQ-0000-0000')->assertNotFound();
    }

    public function test_manager_response_publishes_the_quote_and_mails_the_requester(): void
    {
        Storage::fake('local');
        Notification::fake();

        $reference = $this->postJson('/api/v1/public/quote-requests', $this->payload())
            ->json('data.reference');
        $quote = QuoteRequest::where('reference', $reference)->firstOrFail();

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/quote-requests/{$quote->id}/respond", [
                'quoted_amount' => 3200.50,
                'currency' => 'egp',
                'turnaround_days' => 3,
                'response_note' => 'السعر يشمل التصديق والختم.',
            ])
            ->assertOk()
            ->assertJsonPath('data.status', QuoteRequest::STATUS_QUOTED)
            ->assertJsonPath('data.currency', 'EGP');

        Notification::assertSentOnDemand(QuoteRespondedNotification::class);

        $this->getJson("/api/v1/public/quote-requests/{$reference}")
            ->assertOk()
            ->assertJsonPath('data.answered', true)
            ->assertJsonPath('data.quote.amount', '3200.50')
            ->assertJsonPath('data.quote.turnaround_days', 3);
    }

    public function test_response_mail_can_be_suppressed_when_the_client_was_told_by_phone(): void
    {
        Notification::fake();

        $quote = $this->quote();

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/quote-requests/{$quote->id}/respond", [
                'quoted_amount' => 800,
                'currency' => 'EGP',
                'notify_client' => false,
            ])
            ->assertOk();

        Notification::assertNothingSentTo(Notification::route('mail', $quote->email));
    }

    public function test_a_request_cannot_be_accepted_before_it_is_priced(): void
    {
        $quote = $this->quote();

        $this->actingAs($this->pm, 'sanctum')
            ->putJson("/api/v1/quote-requests/{$quote->id}/status", ['status' => QuoteRequest::STATUS_ACCEPTED])
            ->assertStatus(422);

        $this->actingAs($this->pm, 'sanctum')
            ->putJson("/api/v1/quote-requests/{$quote->id}/status", ['status' => QuoteRequest::STATUS_REVIEWING])
            ->assertOk()
            ->assertJsonPath('data.status', QuoteRequest::STATUS_REVIEWING);
    }

    public function test_converting_creates_a_draft_project_a_client_and_copies_the_attachments(): void
    {
        Storage::fake('local');
        Notification::fake();

        $reference = $this->postJson('/api/v1/public/quote-requests', $this->payload([
            'files' => [UploadedFile::fake()->create('contract.pdf', 90, 'application/pdf')],
        ]))->json('data.reference');

        $quote = QuoteRequest::where('reference', $reference)->firstOrFail();

        $created = $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/quote-requests/{$quote->id}/convert", [
                'title' => 'ترجمة عقد تأسيس شركة النور',
                'source_language_id' => $this->english->id,
                'target_language_id' => $this->arabic->id,
                'deadline_at' => now()->addDays(4)->toIso8601String(),
                'priority' => Project::PRIORITY_URGENT,
                'service_type' => 'certified',
                'quoted_amount' => 3200,
            ])
            ->assertCreated()
            ->json('data');

        $project = Project::findOrFail($created['id']);
        $this->assertSame(Project::STATUS_DRAFT, $project->status);

        // The visitor's upload arrived as a source file the project can be published with.
        $source = $project->files()->where('category', ProjectFile::CATEGORY_SOURCE)->first();
        $this->assertNotNull($source);
        $this->assertSame('contract.pdf', $source->original_name);
        Storage::disk('local')->assertExists($source->disk_path);

        // ...and the original attachment is untouched, so the priced evidence survives.
        Storage::disk('local')->assertExists($quote->files()->first()->disk_path);

        $client = Client::findOrFail($project->client_id);
        $this->assertSame('شركة النور', $client->name);
        $this->assertSame('company', $client->type);

        $quote->refresh();
        $this->assertSame(QuoteRequest::STATUS_CONVERTED, $quote->status);
        $this->assertSame($project->id, $quote->project_id);

        // Converted is terminal: no second project from the same request.
        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/quote-requests/{$quote->id}/convert", [
                'title' => 'مرة أخرى',
                'source_language_id' => $this->english->id,
                'target_language_id' => $this->arabic->id,
                'deadline_at' => now()->addDays(4)->toIso8601String(),
                'priority' => Project::PRIORITY_NORMAL,
                'service_type' => 'certified',
            ])
            ->assertStatus(422);
    }

    public function test_translators_cannot_reach_the_quote_inbox(): void
    {
        $translator = User::factory()->create();
        $translator->syncRoles(['translator']);

        $this->actingAs($translator, 'sanctum')->getJson('/api/v1/quote-requests')->assertForbidden();
    }

    /**
     * The accountant owns the money side: they answer the client themselves. They do
     * not schedule translators, so converting into a project stays with the PM.
     */
    public function test_accountant_can_price_and_answer_a_request_but_not_convert_it(): void
    {
        Notification::fake();

        $accountant = User::factory()->create();
        $accountant->syncRoles(['accountant']);
        $quote = $this->quote();

        $this->actingAs($accountant, 'sanctum')->getJson('/api/v1/quote-requests')->assertOk();

        $this->actingAs($accountant, 'sanctum')
            ->postJson("/api/v1/quote-requests/{$quote->id}/respond", [
                'quoted_amount' => 1450,
                'currency' => 'EGP',
                'turnaround_days' => 2,
            ])
            ->assertOk()
            ->assertJsonPath('data.status', QuoteRequest::STATUS_QUOTED);

        // The client's answer is recorded by whoever took the call.
        $this->actingAs($accountant, 'sanctum')
            ->putJson("/api/v1/quote-requests/{$quote->id}/status", ['status' => QuoteRequest::STATUS_ACCEPTED])
            ->assertOk();

        // ...but opening the project is not theirs to do.
        $this->actingAs($accountant, 'sanctum')
            ->postJson("/api/v1/quote-requests/{$quote->id}/convert", [
                'title' => 'محاولة تحويل',
                'source_language_id' => $this->english->id,
                'target_language_id' => $this->arabic->id,
                'deadline_at' => now()->addDays(3)->toIso8601String(),
                'priority' => Project::PRIORITY_NORMAL,
                'service_type' => 'certified',
            ])
            ->assertForbidden();
    }

    /** The person who prices requests must be told one arrived. */
    public function test_everyone_who_can_answer_a_request_is_notified_when_one_arrives(): void
    {
        Storage::fake('local');
        Notification::fake();

        $accountant = User::factory()->create();
        $accountant->syncRoles(['accountant']);

        $translator = User::factory()->create();
        $translator->syncRoles(['translator']);

        $this->postJson('/api/v1/public/quote-requests', $this->payload())->assertCreated();

        Notification::assertSentTo($this->pm, QuoteRequestReceivedNotification::class);
        Notification::assertSentTo($accountant, QuoteRequestReceivedNotification::class);
        Notification::assertNotSentTo($translator, QuoteRequestReceivedNotification::class);
    }

    public function test_staff_search_matches_reference_name_and_organisation(): void
    {
        $this->quote(['name' => 'سامي عبد الله', 'organization' => 'شركة النور']);
        $this->quote(['name' => 'ليلى حسن', 'organization' => 'مؤسسة الفجر', 'email' => 'laila@example.com']);

        $this->actingAs($this->pm, 'sanctum')
            ->getJson('/api/v1/quote-requests?q='.rawurlencode('الفجر'))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'ليلى حسن');
    }

    /**
     * Regression: an inline `throttle:5,60` keys off domain+IP, not the path, so
     * exhausting the submission limit used to lock the same visitor out of the
     * login endpoint for a full hour. Named limiters keep the buckets apart.
     */
    public function test_exhausting_the_public_submission_limit_does_not_lock_the_login_endpoint(): void
    {
        Storage::fake('local');
        Notification::fake();

        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/v1/public/quote-requests', $this->payload())->assertCreated();
        }

        $this->postJson('/api/v1/public/quote-requests', $this->payload())->assertStatus(429);

        // ...but signing in still works.
        $this->postJson('/api/v1/auth/login', [
            'email' => $this->pm->email,
            'password' => 'password',
        ])->assertOk();

        // ...and so does looking a reference up.
        $reference = QuoteRequest::latest('id')->firstOrFail()->reference;
        $this->getJson("/api/v1/public/quote-requests/{$reference}")->assertOk();
    }

    public function test_reference_normalisation_accepts_what_people_actually_type(): void
    {
        $this->assertSame('RQ-4KX7-9M2D', QuoteReferenceGenerator::normalize('rq-4kx7-9m2d'));
        $this->assertSame('RQ-4KX7-9M2D', QuoteReferenceGenerator::normalize('4KX7 9M2D'));
        $this->assertSame('RQ-4KX7-9M2D', QuoteReferenceGenerator::normalize('  RQ4KX79M2D '));
    }

    private function quote(array $overrides = []): QuoteRequest
    {
        return QuoteRequest::create([
            'reference' => app(QuoteReferenceGenerator::class)->next(),
            'name' => 'سامي عبد الله',
            'email' => 'sami@example.com',
            'title' => 'ترجمة عقد',
            'service_type' => 'certified',
            'priority' => 'normal',
            'status' => QuoteRequest::STATUS_NEW,
            ...$overrides,
        ]);
    }
}
