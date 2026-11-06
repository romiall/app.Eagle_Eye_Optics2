<?php

namespace Tests\Feature\Billing;

use App\Domain\Operations\RestoreVerifier;
use App\Domain\Shared\Ulid;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Reprise des créances papier (X01, AT26, AT39) sur MySQL réel : « 80 000 dont 30 000 déjà payés → reprise de
 * 50 000, sans chiffre d'affaires ni encaissement initial », « un paiement de 20 000 crée un reçu et laisse une dette
 * de 30 000 », aucun ancien acompte ni mouvement de stock ; justificatif obligatoire ; reprise rejouée (même clé =
 * même résultat) et référence papier en double ; tout ou rien ; droits, réauthentification et module. Disque privé
 * simulé. Données fictives.
 */
final class LegacyBalancesTest extends TestCase
{
    use BillingFixtures;
    use MigratedDatabase;

    private const JPEG = "\xFF\xD8\xFF\xE0fictif-justificatif";

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling();
        // bootBilling remplace la liste des préfixes : la série des reprises y est ajoutée ici.
        config(['eeo.numbering.prefixes.LEGACY_BALANCE' => 'TEST-REP']);
        Storage::fake('local');
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    private function evidence(string $bytes = self::JPEG, string $type = 'image/jpeg', bool $reauthenticated = true): TestResponse
    {
        $client = $reauthenticated ? $this->actingAsReauthenticated($this->manager) : $this->actingAsFresh($this->manager);
        $headers = ['Idempotency-Key' => Ulid::generate(), 'Content-Type' => $type, 'Accept' => 'application/json'];

        return $client->call('POST', '/api/v1/legacy-balances/evidence', [], [], [], $this->transformHeadersToServerVars($headers), $bytes);
    }

    private function evidenceId(): string
    {
        return (string) $this->evidence()->assertCreated()->json('data.file_id');
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function row(int $line, string $reference, array $overrides = []): array
    {
        return array_merge([
            'line' => $line, 'patient_id' => $this->patientId, 'patient_record_number' => null, 'paper_reference' => $reference,
            'original_total' => 80000, 'already_paid' => 30000, 'original_invoice_on' => '2025-11-04',
        ], $overrides);
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     */
    private function import(array $rows, bool $dryRun, ?string $evidenceId, ?string $key = null, bool $reauthenticated = true): TestResponse
    {
        $client = $reauthenticated ? $this->actingAsReauthenticated($this->manager) : $this->actingAsFresh($this->manager);

        return $client->withHeaders(['Idempotency-Key' => $key ?? Ulid::generate()])
            ->postJson('/api/v1/imports/legacy-balances', ['dry_run' => $dryRun, 'evidence_file_id' => $evidenceId, 'rows' => $rows]);
    }

    public function test_le_justificatif_est_conserve_en_prive_et_reconnu_a_ses_premiers_octets(): void
    {
        $response = $this->evidence()->assertCreated();
        $this->assertMatchesContract($response, 'schemas/resources/billing.json#/$defs/LegacyEvidenceResponse');
        $response->assertJsonPath('data.mime_type', 'image/jpeg')->assertJsonPath('data.sha256', hash('sha256', self::JPEG));

        $file = DB::table('stored_files')->where('id', $response->json('data.file_id'))->first();
        $this->assertNotNull($file);
        $this->assertSame('FINANCIAL', $file->classification);
        Storage::disk('local')->assertExists((string) $file->private_path);

        // Le même scan déposé deux fois : un seul fichier.
        $this->assertSame($response->json('data.file_id'), $this->evidence()->assertCreated()->json('data.file_id'));
        $this->assertSame(1, DB::table('stored_files')->where('clinic_id', $this->clinicId)->count());

        // Le type annoncé ne suffit pas : un GIF présenté comme JPEG est refusé.
        $this->evidence('GIF89a-fictif', 'image/jpeg')->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['content']]]);
    }

    public function test_80000_dont_30000_deja_payes_reprend_50000_sans_vente_ni_encaissement_ni_stock(): void
    {
        $evidence = $this->evidenceId();
        $movements = DB::table('stock_movements')->where('clinic_id', $this->clinicId)->count();

        $preview = $this->import([$this->row(2, 'CARNET-0142')], true, $evidence)->assertOk();
        $preview->assertJsonPath('data.dry_run', true)->assertJsonPath('data.accepted', 1)->assertJsonPath('data.rejected', []);
        $this->assertSame(0, DB::table('legacy_balance_imports')->where('clinic_id', $this->clinicId)->count(), 'l\'aperçu n\'écrit rien');

        $response = $this->import([$this->row(2, 'CARNET-0142')], false, $evidence)->assertCreated();
        $this->assertMatchesContract($response, 'schemas/resources/billing.json#/$defs/ImportReportResponse');
        $invoiceId = (string) $response->json('data.created_ids.0');

        $invoice = DB::table('invoices')->where('id', $invoiceId)->first();
        $this->assertNotNull($invoice);
        $this->assertSame('LEGACY_BALANCE', $invoice->origin);
        $this->assertSame('ISSUED', $invoice->status);
        $this->assertSame(50000, (int) $invoice->total_gross);
        $this->assertSame(50000, (int) $invoice->legacy_opening_balance);
        $this->assertSame('CARNET-0142', $invoice->legacy_reference);
        $this->assertStringStartsWith('TEST-REP-', (string) $invoice->number, 'série distincte des factures du jour');

        $import = DB::table('legacy_balance_imports')->where('invoice_id', $invoiceId)->first();
        $this->assertNotNull($import);
        $this->assertSame([80000, 30000, 50000], [(int) $import->original_total, (int) $import->previously_paid, (int) $import->opening_balance]);
        $this->assertSame($evidence, $import->evidence_file_id);
        $this->assertSame(hash('sha256', self::JPEG), $import->evidence_sha256);

        $this->assertSame(0, DB::table('invoice_lines')->where('invoice_id', $invoiceId)->count(), 'aucune ligne d\'article');
        $this->assertSame(0, DB::table('payments')->where('invoice_id', $invoiceId)->count(), 'l\'ancien acompte n\'est pas un encaissement');
        $this->assertSame(0, DB::table('receipts')->where('clinic_id', $this->clinicId)->count());
        $this->assertSame($movements, DB::table('stock_movements')->where('clinic_id', $this->clinicId)->count(), 'aucun mouvement de stock');
        $this->assertSame(0, DB::table('vw_revenue_events')->where('invoice_id', $invoiceId)->count(), 'aucun chiffre d\'affaires');
        $this->assertSame(50000, (int) DB::table('vw_invoice_balances')->where('invoice_id', $invoiceId)->value('amount_due'));
        $this->assertSame(1, DB::table('audit_events')->where('action', 'legacy_balance.imported')->where('target_id', $invoiceId)->count());
    }

    public function test_une_creance_reprise_n_est_pas_une_anomalie_des_diagnostics_d_integrite(): void
    {
        $evidence = $this->evidenceId();
        $response = $this->import([$this->row(2, 'CARNET-0143')], false, $evidence)->assertCreated();
        $invoiceId = (string) $response->json('data.created_ids.0');
        $this->assertSame(0, DB::table('invoice_lines')->where('invoice_id', $invoiceId)->count(), 'une reprise n\'a aucune ligne d\'article');

        // Trouvé par le gate G2 sur les données des parcours : une reprise de créance est une pièce ÉMISE sans ligne, que le
        // diagnostic I01 (total et lignes d'une facture émise) signalait à tort. Il ne vise que les factures NATIVE ; la reprise a
        // son diagnostic (I08). Tous les diagnostics versionnés rendent zéro ligne.
        $issues = [];
        foreach (RestoreVerifier::diagnostics() as $statement) {
            foreach (DB::select($statement) as $row) {
                $issues[] = (string) $row->issue;
            }
        }
        $this->assertSame([], $issues, 'diagnostics : '.implode(', ', $issues));

        // Témoin : sans le filtre NATIVE, la pièce de reprise serait signalée (ce test voit donc bien l'exemption).
        $i01 = array_values(array_filter(RestoreVerifier::diagnostics(), static fn (string $statement): bool => str_contains($statement, "'I01_INVOICE_TOTAL'")));
        $this->assertCount(1, $i01);
        $this->assertStringContainsString("i.origin='NATIVE'", $i01[0]);
        $unfiltered = DB::select(str_replace(" AND i.origin='NATIVE'", '', $i01[0]));
        $this->assertSame([$invoiceId], array_map(static fn (object $row): string => (string) $row->id, $unfiltered));
    }

    public function test_un_paiement_de_20000_cree_un_recu_et_laisse_30000_dus(): void
    {
        $invoiceId = (string) $this->import([$this->row(2, 'CARNET-0150')], false, $this->evidenceId())->assertCreated()->json('data.created_ids.0');

        $this->pay($invoiceId, $this->ledgerVersion($invoiceId), 20000)->assertCreated();

        $this->assertSame(1, DB::table('receipts')->where('clinic_id', $this->clinicId)->count());
        $this->assertSame(30000, (int) DB::table('vw_invoice_balances')->where('invoice_id', $invoiceId)->value('amount_due'));
    }

    public function test_la_meme_cle_rejoue_et_une_reference_deja_reprise_est_refusee(): void
    {
        $evidence = $this->evidenceId();
        $key = Ulid::generate();
        $first = $this->import([$this->row(2, 'Carnet-Été-01')], false, $evidence, $key)->assertCreated();
        $again = $this->import([$this->row(2, 'Carnet-Été-01')], false, $evidence, $key)->assertCreated();
        $this->assertSame($first->json('data.created_ids'), $again->json('data.created_ids'));
        $this->assertSame(1, DB::table('legacy_balance_imports')->where('clinic_id', $this->clinicId)->count());

        // Même référence (casse et accents ignorés), autre clé : refus lisible, rien n'est écrit.
        $refused = $this->import([$this->row(2, 'CARNET-ETE-01')], false, $evidence);
        $refused->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
        $this->assertArrayHasKey('rows.0.paper_reference', $refused->json('error.fields'));
        $this->assertSame(1, DB::table('legacy_balance_imports')->where('clinic_id', $this->clinicId)->count());
    }

    public function test_une_ligne_refusee_aucune_creance_n_est_reprise(): void
    {
        $evidence = $this->evidenceId();
        $rows = [
            $this->row(2, 'LOT-A'),
            $this->row(3, 'LOT-B', ['patient_id' => null, 'patient_record_number' => 'EE-2026-0001']),
            $this->row(4, 'LOT-A'),
            $this->row(5, 'LOT-C', ['already_paid' => 80000]),
            $this->row(6, 'LOT-D', ['patient_id' => null, 'patient_record_number' => 'EE-2099-9999']),
            $this->row(7, 'LOT-E', ['original_invoice_on' => '2099-01-01']),
        ];

        $preview = $this->import($rows, true, $evidence)->assertOk();
        $this->assertSame([4, 5, 6, 7], array_column($preview->json('data.rejected'), 'line'));
        $this->assertSame(2, $preview->json('data.accepted'));

        $this->import($rows, false, $evidence)->assertStatus(422);
        $this->assertSame(0, DB::table('legacy_balance_imports')->where('clinic_id', $this->clinicId)->count());
        $this->assertSame(0, DB::table('invoices')->where('clinic_id', $this->clinicId)->where('origin', 'LEGACY_BALANCE')->count());
        $this->assertSame(0, DB::table('document_number_usages')->where('clinic_id', $this->clinicId)->where('document_type', 'LEGACY_BALANCE')->count(), 'aucun numéro consommé');

        $ok = $this->import([$this->row(2, 'LOT-A'), $this->row(3, 'LOT-B', ['patient_id' => null, 'patient_record_number' => 'EE-2026-0001'])], false, $evidence)->assertCreated();
        $numbers = DB::table('invoices')->whereIn('id', $ok->json('data.created_ids'))->orderBy('number')->pluck('number')->all();
        $this->assertCount(2, $numbers);
        $this->assertNotSame($numbers[0], $numbers[1]);
    }

    public function test_sans_justificatif_rien_n_est_repris(): void
    {
        $this->import([$this->row(2, 'SANS-PREUVE')], false, null)
            ->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['evidence_file_id']]]);
        $this->import([$this->row(2, 'SANS-PREUVE')], false, Ulid::generate())->assertStatus(422);
    }

    public function test_seule_la_gerante_reprend_avec_reauthentification_et_module_ouvert(): void
    {
        $evidence = $this->evidenceId();

        $this->import([$this->row(2, 'R-1')], true, $evidence, reauthenticated: false)->assertStatus(423);
        $this->actingAsReauthenticated($this->cashier)->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/imports/legacy-balances', ['dry_run' => true, 'evidence_file_id' => $evidence, 'rows' => [$this->row(2, 'R-1')]])
            ->assertForbidden();

        config(['eeo.enabled_modules' => ['stock']]);
        $this->import([$this->row(2, 'R-1')], true, $evidence)->assertNotFound();
    }

    public function test_la_caisse_du_jour_ne_compte_pas_une_reprise_comme_vente(): void
    {
        $this->import([$this->row(2, 'CA-0001')], false, $this->evidenceId())->assertCreated();

        $report = $this->read('/api/v1/reports/cash-day?date=2026-10-22', $this->manager)->assertOk();
        $this->assertSame(0, $report->json('data.issued.count'));
        $this->assertSame(0, $report->json('data.issued.total_gross'));
    }
}
