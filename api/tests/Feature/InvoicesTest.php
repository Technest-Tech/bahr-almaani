<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Invoice;
use App\Models\Language;
use App\Models\Project;
use App\Models\User;
use Database\Seeders\LanguageSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Client invoicing (change request agreed 2026-09-05): choose the client, the
 * system brings the translated page counts, type the price, the invoice comes
 * out. The load-bearing rules are the delivered-pages basis and the guarantee
 * that a project can never be billed twice.
 */
class InvoicesTest extends TestCase
{
    use RefreshDatabase;

    private User $accountant;

    private User $translator;

    private Client $client;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->seed(LanguageSeeder::class);
        Storage::fake('local');
        Http::fake([
            '*/forms/chromium/convert/html' => Http::response('%PDF-1.7 fake-invoice', 200),
        ]);

        $this->accountant = User::factory()->create(['name' => 'محمود المحاسب']);
        $this->accountant->syncRoles(['accountant']);

        $this->translator = User::factory()->create();
        $this->translator->syncRoles(['translator']);

        $this->client = Client::create([
            'name' => 'سفارة دولة الإمارات',
            'type' => 'company',
            'created_by' => $this->accountant->id,
        ]);
    }

    private function makeProject(array $overrides = [], ?int $deliveredPages = null, ?int $deliveredWords = null): Project
    {
        $en = Language::where('code', 'en')->firstOrFail();
        $ar = Language::where('code', 'ar')->firstOrFail();

        $project = Project::create(array_merge([
            'code' => 'BM-2026-'.str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT),
            'title' => 'ترجمة عقد',
            'client_id' => $this->client->id,
            'source_language_id' => $en->id,
            'target_language_id' => $ar->id,
            'service_type' => 'certified',
            'priority' => 'normal',
            'status' => Project::STATUS_COMPLETED,
            'deadline_at' => now()->addDay(),
            'created_by' => $this->accountant->id,
        ], $overrides));

        if ($deliveredPages !== null || $deliveredWords !== null) {
            $project->forceFill([
                'delivered_pages' => $deliveredPages,
                'delivered_words' => $deliveredWords,
            ])->save();
        }

        return $project;
    }

    public function test_billable_lists_only_finished_uninvoiced_projects_of_that_client(): void
    {
        $billable = $this->makeProject([], deliveredPages: 4, deliveredWords: 900);
        $this->makeProject(['status' => Project::STATUS_CLAIMED]); // not finished
        $invoiced = $this->makeProject([], deliveredPages: 2);
        $this->issueInvoiceFor([$invoiced->id]); // already billed

        $otherClient = Client::create(['name' => 'عميل آخر', 'type' => 'individual', 'created_by' => $this->accountant->id]);
        $this->makeProject(['client_id' => $otherClient->id], deliveredPages: 9);

        $data = $this->actingAs($this->accountant, 'sanctum')
            ->getJson("/api/v1/invoices/billable?client_id={$this->client->id}")
            ->assertOk()
            ->json('data');

        $this->assertCount(1, $data);
        $this->assertSame($billable->code, $data[0]['code']);
        $this->assertSame(4, $data[0]['pages']);
        $this->assertSame(900, $data[0]['words']);
    }

    public function test_issuing_an_invoice_computes_from_delivered_pages_and_stores_the_pdf(): void
    {
        $first = $this->makeProject([], deliveredPages: 4, deliveredWords: 900);
        // No delivered totals yet: the source figures stand in, same as reports.
        $second = $this->makeProject(['total_pages' => 3, 'total_words' => 500]);

        $response = $this->actingAs($this->accountant, 'sanctum')
            ->postJson('/api/v1/invoices', [
                'client_id' => $this->client->id,
                'project_ids' => [$first->id, $second->id],
                'unit_price' => 150,
            ])
            ->assertCreated();

        $invoice = Invoice::findOrFail($response->json('data.id'));
        $this->assertSame('INV-'.now()->year.'-00001', $invoice->number);
        $this->assertSame(7, $invoice->total_pages);
        $this->assertSame(1400, $invoice->total_words);
        $this->assertSame(1050.0, (float) $invoice->amount); // 7 pages × 150
        $this->assertSame('EGP', $invoice->currency);
        $this->assertCount(2, $invoice->line_items);

        // Both projects are now billed and locked to this invoice.
        $this->assertSame($invoice->id, $first->fresh()->invoice_id);
        $this->assertSame($invoice->id, $second->fresh()->invoice_id);

        Storage::disk('local')->assertExists($invoice->disk_path);
        Http::assertSent(fn ($request) => str_contains($request->url(), '/forms/chromium/convert/html'));

        $this->actingAs($this->accountant, 'sanctum')
            ->get("/api/v1/invoices/{$invoice->id}/download")
            ->assertOk()
            ->assertDownload("{$invoice->number}.pdf");
    }

    public function test_a_typed_total_wins_over_computed_pricing(): void
    {
        $project = $this->makeProject([], deliveredPages: 5);

        $response = $this->actingAs($this->accountant, 'sanctum')
            ->postJson('/api/v1/invoices', [
                'client_id' => $this->client->id,
                'project_ids' => [$project->id],
                'amount' => 999.5,
                'currency' => 'usd',
            ])
            ->assertCreated();

        $invoice = Invoice::findOrFail($response->json('data.id'));
        $this->assertSame(999.5, (float) $invoice->amount);
        $this->assertNull($invoice->unit_price);
        $this->assertSame('USD', $invoice->currency);
    }

    public function test_a_project_can_never_be_billed_twice(): void
    {
        $project = $this->makeProject([], deliveredPages: 3);
        $this->issueInvoiceFor([$project->id]);

        $this->actingAs($this->accountant, 'sanctum')
            ->postJson('/api/v1/invoices', [
                'client_id' => $this->client->id,
                'project_ids' => [$project->id],
                'unit_price' => 100,
            ])
            ->assertStatus(422);

        $this->assertSame(1, Invoice::count());
    }

    public function test_an_invoice_needs_a_page_count_to_bill_on(): void
    {
        // Finished but nothing countable anywhere — refuse rather than bill zero.
        $project = $this->makeProject();

        $this->actingAs($this->accountant, 'sanctum')
            ->postJson('/api/v1/invoices', [
                'client_id' => $this->client->id,
                'project_ids' => [$project->id],
                'unit_price' => 100,
            ])
            ->assertStatus(422);
    }

    public function test_line_items_are_a_snapshot_that_survives_project_edits(): void
    {
        $project = $this->makeProject(['title' => 'العنوان الأصلي'], deliveredPages: 2);
        $invoice = $this->issueInvoiceFor([$project->id]);

        $project->update(['title' => 'عنوان معدّل لاحقاً']);

        $this->assertSame('العنوان الأصلي', $invoice->fresh()->line_items[0]['title']);
    }

    public function test_a_translator_cannot_reach_invoices(): void
    {
        $this->actingAs($this->translator, 'sanctum')
            ->getJson('/api/v1/invoices')
            ->assertForbidden();

        $this->actingAs($this->translator, 'sanctum')
            ->postJson('/api/v1/invoices', [
                'client_id' => $this->client->id,
                'project_ids' => [1],
                'unit_price' => 100,
            ])
            ->assertForbidden();
    }

    public function test_pricing_requires_either_a_rate_or_a_total(): void
    {
        $project = $this->makeProject([], deliveredPages: 2);

        $this->actingAs($this->accountant, 'sanctum')
            ->postJson('/api/v1/invoices', [
                'client_id' => $this->client->id,
                'project_ids' => [$project->id],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['unit_price', 'amount']);
    }

    private function issueInvoiceFor(array $projectIds): Invoice
    {
        $response = $this->actingAs($this->accountant, 'sanctum')
            ->postJson('/api/v1/invoices', [
                'client_id' => $this->client->id,
                'project_ids' => $projectIds,
                'unit_price' => 100,
            ])
            ->assertCreated();

        return Invoice::findOrFail($response->json('data.id'));
    }
}
