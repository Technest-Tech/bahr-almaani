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

    // Sequential, not random: 120 random codes in 99,999 collide ~7% of runs.
    private int $codes = 0;

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
            'code' => sprintf('BM-2026-%05d', ++$this->codes),
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

    public function test_the_client_picker_lists_every_client_with_work_to_bill_first(): void
    {
        // More than the 100 the paged /clients list used to stop at.
        foreach (range(1, 105) as $n) {
            Client::create(['name' => "عميل {$n}", 'type' => 'individual', 'created_by' => $this->accountant->id]);
        }

        $this->makeProject([], deliveredPages: 3);
        $this->makeProject([], deliveredPages: 5);
        $this->makeProject(['status' => Project::STATUS_CLAIMED]); // not finished
        $this->issueInvoiceFor([$this->makeProject([], deliveredPages: 2)->id]); // already billed

        // The accountant bills but holds no clients.view — this list is theirs anyway.
        $data = $this->actingAs($this->accountant, 'sanctum')
            ->getJson('/api/v1/invoices/clients')
            ->assertOk()
            ->json('data');

        $this->assertCount(106, $data);
        $this->assertSame($this->client->id, $data[0]['id']);
        $this->assertSame(2, $data[0]['billable_count']);
        $this->assertSame(0, $data[1]['billable_count']);
    }

    public function test_a_pm_counts_only_their_own_work_in_the_client_picker(): void
    {
        $mona = User::factory()->create();
        $mona->syncRoles(['project_manager']);
        $omar = User::factory()->create();
        $omar->syncRoles(['project_manager']);

        $this->makeProject(['created_by' => $mona->id], deliveredPages: 3);
        $this->makeProject(['created_by' => $omar->id], deliveredPages: 4);

        $row = collect($this->actingAs($mona, 'sanctum')->getJson('/api/v1/invoices/clients')->assertOk()->json('data'))
            ->firstWhere('id', $this->client->id);

        $this->assertSame(1, $row['billable_count']);
    }

    public function test_select_all_can_bill_more_than_a_hundred_projects(): void
    {
        $ids = collect(range(1, 120))->map(fn () => $this->makeProject([], deliveredPages: 1)->id)->all();

        $invoice = $this->issueInvoiceFor($ids);

        $this->assertSame(120, $invoice->total_pages);
        $this->assertSame(120, Project::where('invoice_id', $invoice->id)->count());
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

    public function test_an_issued_invoice_can_be_corrected_without_changing_its_number(): void
    {
        $first = $this->makeProject([], 10);
        $second = $this->makeProject([], 4);

        $invoice = $this->actingAs($this->accountant, 'sanctum')->postJson('/api/v1/invoices', [
            'client_id' => $this->client->id,
            'project_ids' => [$first->id],
            'unit_price' => 100,
        ])->assertCreated()->json('data');

        $this->assertSame(10, $invoice['total_pages']);
        $this->assertSame('1000.00', $invoice['amount']);

        // The rate was wrong and a second project belonged on the same invoice.
        $edited = $this->actingAs($this->accountant, 'sanctum')
            ->putJson("/api/v1/invoices/{$invoice['id']}", [
                'project_ids' => [$first->id, $second->id],
                'unit_price' => 150,
                'notes' => 'صُحّحت التعرفة',
            ])
            ->assertOk()
            ->json('data');

        $this->assertSame($invoice['number'], $edited['number'], 'the number must never move');
        $this->assertSame($invoice['issued_at'], $edited['issued_at']);
        $this->assertSame(14, $edited['total_pages']);
        $this->assertSame('2100.00', $edited['amount']);
        $this->assertCount(2, $edited['line_items']);

        $this->assertSame($invoice['id'], $second->fresh()->invoice_id);
    }

    public function test_a_project_dropped_from_an_invoice_becomes_billable_again(): void
    {
        $kept = $this->makeProject([], 6);
        $dropped = $this->makeProject([], 6);

        $invoice = $this->actingAs($this->accountant, 'sanctum')->postJson('/api/v1/invoices', [
            'client_id' => $this->client->id,
            'project_ids' => [$kept->id, $dropped->id],
            'unit_price' => 50,
        ])->assertCreated()->json('data');

        $this->actingAs($this->accountant, 'sanctum')
            ->putJson("/api/v1/invoices/{$invoice['id']}", [
                'project_ids' => [$kept->id],
                'unit_price' => 50,
            ])
            ->assertOk()
            ->assertJsonPath('data.total_pages', 6);

        $this->assertNull($dropped->fresh()->invoice_id);
        $this->assertSame($invoice['id'], $kept->fresh()->invoice_id);

        // Released means genuinely billable again, not merely detached.
        $this->actingAs($this->accountant, 'sanctum')
            ->getJson("/api/v1/invoices/billable?client_id={$this->client->id}")
            ->assertOk()
            ->assertJsonPath('data.0.id', $dropped->id);
    }

    public function test_editing_cannot_steal_a_project_billed_on_another_invoice(): void
    {
        $mine = $this->makeProject([], 5);
        $theirs = $this->makeProject([], 5);

        $first = $this->actingAs($this->accountant, 'sanctum')->postJson('/api/v1/invoices', [
            'client_id' => $this->client->id,
            'project_ids' => [$mine->id],
            'unit_price' => 10,
        ])->assertCreated()->json('data');

        $second = $this->actingAs($this->accountant, 'sanctum')->postJson('/api/v1/invoices', [
            'client_id' => $this->client->id,
            'project_ids' => [$theirs->id],
            'unit_price' => 10,
        ])->assertCreated()->json('data');

        $this->actingAs($this->accountant, 'sanctum')
            ->putJson("/api/v1/invoices/{$first['id']}", [
                'project_ids' => [$mine->id, $theirs->id],
                'unit_price' => 10,
            ])
            ->assertStatus(422);

        // The rejected edit changed nothing on either invoice.
        $this->assertSame($second['id'], $theirs->fresh()->invoice_id);
        $this->assertSame($first['id'], $mine->fresh()->invoice_id);
    }

    public function test_the_billable_list_includes_the_rows_of_the_invoice_being_edited(): void
    {
        $billed = $this->makeProject([], 3);
        $free = $this->makeProject([], 3);

        $invoice = $this->actingAs($this->accountant, 'sanctum')->postJson('/api/v1/invoices', [
            'client_id' => $this->client->id,
            'project_ids' => [$billed->id],
            'unit_price' => 10,
        ])->assertCreated()->json('data');

        $this->actingAs($this->accountant, 'sanctum')
            ->getJson("/api/v1/invoices/billable?client_id={$this->client->id}")
            ->assertOk()
            ->assertJsonCount(1, 'data');

        $ids = $this->actingAs($this->accountant, 'sanctum')
            ->getJson("/api/v1/invoices/billable?client_id={$this->client->id}&invoice_id={$invoice['id']}")
            ->assertOk()
            ->json('data.*.id');

        $this->assertEqualsCanonicalizing([$billed->id, $free->id], $ids);
    }

    public function test_a_translator_cannot_edit_an_invoice(): void
    {
        $project = $this->makeProject([], 5);

        $invoice = $this->actingAs($this->accountant, 'sanctum')->postJson('/api/v1/invoices', [
            'client_id' => $this->client->id,
            'project_ids' => [$project->id],
            'unit_price' => 10,
        ])->assertCreated()->json('data');

        $this->actingAs($this->translator, 'sanctum')
            ->putJson("/api/v1/invoices/{$invoice['id']}", [
                'project_ids' => [$project->id],
                'amount' => 1,
            ])
            ->assertForbidden();
    }
}
