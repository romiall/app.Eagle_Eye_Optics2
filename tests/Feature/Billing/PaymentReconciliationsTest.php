<?php

namespace Tests\Feature\Billing;

use App\Domain\Shared\Ulid;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\Support\PatientFixtures;
use Tests\Support\ValidatesContracts;
use Tests\TestCase;

/**
 * Rapprochements par canal de paiement et export comptable Q13 (L1D06). Données fictives.
 */
final class PaymentReconciliationsTest extends TestCase
{
    use BillingFixtures;
    use MigratedDatabase;
    use PatientFixtures;
    use ValidatesContracts;

    private const JPEG = "\xFF\xD8\xFF\xE0\x00\x10JFIF-releve-fictif";

    private const PDF = "%PDF-1.4\n%releve-fictif\n%%EOF\n";

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling();
        config(['eeo.numbering.prefixes.LEGACY_BALANCE' => 'TEST-REP']);
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    public function test_depot_releve_exige_reauthentification_octets_valides_et_telechargement_prive(): void
    {
        $this->uploadEvidence(self::JPEG, 'image/jpeg', false)->assertStatus(423);
        $this->uploadEvidence('GIF89a-invalide', 'image/jpeg', true)
            ->assertStatus(422)
            ->assertJsonStructure(['error' => ['fields' => ['content']]]);

        $created = $this->uploadEvidence(self::JPEG, 'image/jpeg', true)->assertCreated();
        $this->assertMatchesContract($created, 'schemas/resources/billing.json#/$defs/StatementEvidenceResponse');
        $fileId = (string) $created->json('data.file_id');

        // Déduplication par empreinte : le même relevé déposé deux fois rend le même file_id.
        $again = $this->uploadEvidence(self::JPEG, 'image/jpeg', true)->assertCreated();
        $this->assertSame($fileId, (string) $again->json('data.file_id'));

        $this->actingAsFresh($this->cashier)
            ->get('/api/v1/payment-reconciliations/statement-file/'.$fileId)
            ->assertForbidden();

        $download = $this->actingAsFresh($this->manager)
            ->get('/api/v1/payment-reconciliations/statement-file/'.$fileId)
            ->assertOk();
        $download->assertHeader('Content-Type', 'image/jpeg');
        $this->assertSame(self::JPEG, $download->getContent());
    }

    public function test_candidats_attendus_et_frais_sans_doublon_entre_rapprochements(): void
    {
        $item = $this->seedItem($this->clinicId, ['sale_price' => 15000]);
        [$inv1Id] = $this->issuedInvoice([$this->line($item, '2', 1, 15000)]); // 30 000
        $pay1 = $this->pay($inv1Id, 1, 18000, 'MTN_MOMO', ['reference' => 'MOMO-TX-001'])->assertCreated();
        $pay1Id = (string) $pay1->json('data.payment_id');

        [$inv2Id] = $this->issuedInvoice([$this->line($item, '1', 1, 12000)], $this->manager); // 12 000
        $pay2 = $this->pay($inv2Id, 1, 12000, 'MTN_MOMO', ['reference' => 'MOMO-TX-002'])->assertCreated();
        $pay2Id = (string) $pay2->json('data.payment_id');

        // Encaissement CASH ignoré sur le canal MTN_MOMO.
        $cashSessionId = $this->openedSession($this->cashier);
        $this->pay($inv1Id, 2, 5000, 'CASH', ['cash_session_id' => $cashSessionId], $this->cashier)->assertCreated();

        $start = CarbonImmutable::now('UTC')->subHour()->format('Y-m-d\TH:i:s.v\Z');
        $end = CarbonImmutable::now('UTC')->addHour()->format('Y-m-d\TH:i:s.v\Z');

        $candidatesRes = $this->read('/api/v1/payment-reconciliations/candidates?'.http_build_query([
            'method' => 'MTN_MOMO',
            'period_starts_at' => $start,
            'period_ends_at' => $end,
        ]), $this->manager)->assertOk();
        $this->assertMatchesContract($candidatesRes, 'schemas/resources/billing.json#/$defs/PaymentReconciliationCandidatesResponse');
        $this->assertSame(30000, $candidatesRes->json('data.expected_amount'));
        $this->assertCount(2, $candidatesRes->json('data.candidates'));
        $this->assertTrue($candidatesRes->json('data.freshness.complete'));

        $evidenceId = (string) $this->uploadEvidence(self::PDF, 'application/pdf', true)->assertCreated()->json('data.file_id');
        $rec1Id = Ulid::generate();
        $rec1 = $this->write('POST', '/api/v1/payment-reconciliations', [
            'expected_version' => null,
            'reconciliation_id' => $rec1Id,
            'method' => 'MTN_MOMO',
            'period_starts_at' => $start,
            'period_ends_at' => $end,
            'statement_amount' => 17600,
            'statement_file_id' => $evidenceId,
            'variance_reason' => 'Frais opérateur 400 FCFA sur lot 1',
            'lines' => [
                [
                    'line_id' => Ulid::generate(),
                    'payment_id' => $pay1Id,
                    'refund_id' => null,
                    'external_reference' => 'MOMO-TX-001',
                    'statement_amount' => 18000,
                    'status' => 'MATCHED',
                    'note' => null,
                ],
                [
                    'line_id' => Ulid::generate(),
                    'payment_id' => null,
                    'refund_id' => null,
                    'external_reference' => 'FEE-001',
                    'statement_amount' => -400,
                    'status' => 'UNMATCHED',
                    'note' => 'Commission MTN MoMo',
                ],
            ],
        ], $this->manager)->assertCreated();
        $this->assertMatchesContract($rec1, 'schemas/resources/billing.json#/$defs/PaymentReconciliationResponse');
        $this->assertSame('DRAFT', $rec1->json('data.status'));
        $this->assertSame(30000, $rec1->json('data.expected_amount'));
        $this->assertSame(-12400, $rec1->json('data.variance_amount'));

        // Un règlement déjà pointé disparaît des candidats pour tout AUTRE rapprochement...
        $otherCandidates = $this->read('/api/v1/payment-reconciliations/candidates?'.http_build_query([
            'method' => 'MTN_MOMO',
            'period_starts_at' => $start,
            'period_ends_at' => $end,
        ]), $this->manager)->assertOk();
        $this->assertCount(1, $otherCandidates->json('data.candidates'));
        $this->assertSame($pay2Id, $otherCandidates->json('data.candidates.0.payment_id'));

        // ... mais reste visible lorsqu'on passe reconciliation_id du brouillon courant.
        $sameCandidates = $this->read('/api/v1/payment-reconciliations/candidates?'.http_build_query([
            'method' => 'MTN_MOMO',
            'period_starts_at' => $start,
            'period_ends_at' => $end,
            'reconciliation_id' => $rec1Id,
        ]), $this->manager)->assertOk();
        $this->assertCount(2, $sameCandidates->json('data.candidates'));

        // Tenter de pointer pay1 dans un SECOND rapprochement est refusé (409).
        $this->write('POST', '/api/v1/payment-reconciliations', [
            'expected_version' => null,
            'reconciliation_id' => Ulid::generate(),
            'method' => 'MTN_MOMO',
            'period_starts_at' => $start,
            'period_ends_at' => $end,
            'statement_amount' => 18000,
            'statement_file_id' => null,
            'variance_reason' => null,
            'lines' => [
                [
                    'line_id' => Ulid::generate(),
                    'payment_id' => $pay1Id,
                    'refund_id' => null,
                    'external_reference' => 'DUP-TRY',
                    'statement_amount' => 18000,
                    'status' => 'MATCHED',
                    'note' => null,
                ],
            ],
        ], $this->manager)->assertStatus(409);

        // Mise à jour du brouillon pour inclure pay2 également.
        $updated = $this->write('PATCH', '/api/v1/payment-reconciliations/'.$rec1Id, [
            'expected_version' => null,
            'reconciliation_id' => $rec1Id,
            'method' => 'MTN_MOMO',
            'period_starts_at' => $start,
            'period_ends_at' => $end,
            'statement_amount' => 29600,
            'statement_file_id' => $evidenceId,
            'variance_reason' => 'Frais opérateur 400 FCFA retenus par MTN',
            'lines' => [
                [
                    'line_id' => Ulid::generate(),
                    'payment_id' => $pay1Id,
                    'refund_id' => null,
                    'external_reference' => 'MOMO-TX-001',
                    'statement_amount' => 18000,
                    'status' => 'MATCHED',
                    'note' => null,
                ],
                [
                    'line_id' => Ulid::generate(),
                    'payment_id' => $pay2Id,
                    'refund_id' => null,
                    'external_reference' => 'MOMO-TX-002',
                    'statement_amount' => 12000,
                    'status' => 'MATCHED',
                    'note' => null,
                ],
                [
                    'line_id' => Ulid::generate(),
                    'payment_id' => null,
                    'refund_id' => null,
                    'external_reference' => 'FEE-MOMO-001',
                    'statement_amount' => -400,
                    'status' => 'DISPUTED',
                    'note' => 'Commission contestée',
                ],
            ],
        ], $this->manager)->assertOk();
        $this->assertMatchesContract($updated, 'schemas/resources/billing.json#/$defs/PaymentReconciliationResponse');
        $this->assertSame(1, $updated->json('data.disputed_lines_count'));
        $this->assertSame(30000, $updated->json('data.matched_lines_amount'));
    }

    public function test_validation_fige_rapprochement_et_exige_motif_sur_ecart(): void
    {
        $item = $this->seedItem($this->clinicId, ['sale_price' => 10000]);
        [$invId] = $this->issuedInvoice([$this->line($item, '1', 1, 10000)]);
        $pay = $this->pay($invId, 1, 10000, 'ORANGE_MONEY', ['reference' => 'OM-999'])->assertCreated();

        $start = CarbonImmutable::now('UTC')->subHour()->format('Y-m-d\TH:i:s.v\Z');
        $end = CarbonImmutable::now('UTC')->addHour()->format('Y-m-d\TH:i:s.v\Z');
        $recId = Ulid::generate();

        $this->write('POST', '/api/v1/payment-reconciliations', [
            'expected_version' => null,
            'reconciliation_id' => $recId,
            'method' => 'ORANGE_MONEY',
            'period_starts_at' => $start,
            'period_ends_at' => $end,
            'statement_amount' => 9800,
            'statement_file_id' => null,
            'variance_reason' => null,
            'lines' => [[
                'line_id' => Ulid::generate(),
                'payment_id' => (string) $pay->json('data.payment_id'),
                'refund_id' => null,
                'external_reference' => 'OM-999',
                'statement_amount' => 10000,
                'status' => 'MATCHED',
                'note' => null,
            ]],
        ], $this->manager)->assertCreated();

        // Validation sans réauthentification -> 423.
        $this->actingAsFresh($this->manager)
            ->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/payment-reconciliations/'.$recId.'/validate', [
                'expected_version' => null,
                'reconciliation_id' => $recId,
                'statement_amount' => 9800,
                'statement_file_id' => null,
                'variance_reason' => 'Frais OM',
            ])->assertStatus(423);

        // Écart (-200) sans motif valide -> 422.
        $this->actingAsReauthenticated($this->manager)
            ->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/payment-reconciliations/'.$recId.'/validate', [
                'expected_version' => null,
                'reconciliation_id' => $recId,
                'statement_amount' => 9800,
                'statement_file_id' => null,
                'variance_reason' => '',
            ])->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['variance_reason']]]);

        $validated = $this->actingAsReauthenticated($this->manager)
            ->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/payment-reconciliations/'.$recId.'/validate', [
                'expected_version' => null,
                'reconciliation_id' => $recId,
                'statement_amount' => 9800,
                'statement_file_id' => null,
                'variance_reason' => 'Frais Orange Money de 200 FCFA retenus à la source',
            ])->assertOk();
        $this->assertMatchesContract($validated, 'schemas/resources/billing.json#/$defs/PaymentReconciliationResponse');
        $this->assertSame('VALIDATED', $validated->json('data.status'));
        $this->assertSame(-200, $validated->json('data.variance_amount'));
        $this->assertNotNull($validated->json('data.validated_at'));

        // Immuable après validation.
        $this->write('PATCH', '/api/v1/payment-reconciliations/'.$recId, [
            'expected_version' => null,
            'reconciliation_id' => $recId,
            'method' => 'ORANGE_MONEY',
            'period_starts_at' => $start,
            'period_ends_at' => $end,
            'statement_amount' => 10000,
            'statement_file_id' => null,
            'variance_reason' => null,
            'lines' => [],
        ], $this->manager)->assertStatus(409);

        $page = $this->read('/api/v1/payment-reconciliations?status=VALIDATED', $this->manager)->assertOk();
        $this->assertMatchesContract($page, 'schemas/resources/billing.json#/$defs/PaymentReconciliationPage');
        $this->assertSame(1, $page->json('meta.total'));
    }

    public function test_export_comptable_q13_separe_ca_encaissements_depenses_rapprochements_impayes_et_valorisation(): void
    {
        $item = $this->seedItem($this->clinicId, ['sale_price' => 20000, 'purchase_cost' => 4500]);
        $pos = $this->seedPosition($item, '2', '0', '0');
        $lot = $this->seedLot($pos, $item, 'LOT-Q13', null, '2');
        DB::table('stock_lots')->where('clinic_id', $this->clinicId)->where('id', $lot)->update(['unit_cost' => 4500]);

        // Vente native : facture 20 000, avoir 5 000 => CA net = 15 000. Encaissement CASH 10 000 -> reste dû natif = 5 000.
        [$invId] = $this->issuedInvoice([$this->line($item, '1', 1, 20000)]);
        $invLineId = (string) DB::table('invoice_lines')->where('clinic_id', $this->clinicId)->where('invoice_id', $invId)->value('id');
        $sessionId = $this->openedSession($this->manager, 50000);
        $this->pay($invId, 1, 10000, 'CASH', ['cash_session_id' => $sessionId], $this->manager)->assertCreated();

        $this->actingAsReauthenticated($this->manager)
            ->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/invoices/'.$invId.'/credit-notes', [
                'expected_version' => 2,
                'invoice_id' => $invId,
                'credit_note_id' => Ulid::generate(),
                'number_usage_id' => Ulid::generate(),
                'number' => null,
                'amount_gross' => 5000,
                'reason' => 'Remise commerciale accordée',
                'approval_id' => Ulid::generate(),
                'document_id' => Ulid::generate(),
                'lines' => [[
                    'credit_note_line_id' => Ulid::generate(),
                    'invoice_line_id' => $invLineId,
                    'quantity' => null,
                    'amount_gross' => 5000,
                    'reason' => 'Geste commercial',
                ]],
            ])->assertCreated();

        // Dépense de caisse (L1D05) : 2 500 FCFA catégorisée.
        $catId = Ulid::generate();
        $this->actingAsReauthenticated($this->manager)
            ->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/expense-categories', [
                'expected_version' => null,
                'category_id' => $catId,
                'code' => 'FOURN',
                'name' => 'Fournitures bureau',
                'active' => true,
            ])->assertOk();
        $this->actingAsReauthenticated($this->manager)
            ->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/cash-sessions/'.$sessionId.'/movements', [
                'expected_version' => null,
                'movement_id' => Ulid::generate(),
                'cash_session_id' => $sessionId,
                'movement_kind' => 'EXPENSE',
                'signed_amount' => -2500,
                'expense_category_id' => $catId,
                'reason' => 'Achat papier facture',
                'reference' => 'FAC-PAP-1',
                'approval_id' => Ulid::generate(),
            ])->assertCreated();

        // Reprise de créance papier (12 000, déjà payé 0) puis règlement MoMo 4 000 => exclu du CA, présent dans encaissements.on_legacy & impayés.
        $legacyEvidence = (string) $this->actingAsReauthenticated($this->manager)
            ->call('POST', '/api/v1/legacy-balances/evidence', [], [], [], $this->transformHeadersToServerVars([
                'CONTENT_TYPE' => 'image/jpeg',
                'X-Content-Sha256' => hash('sha256', self::JPEG),
                'Idempotency-Key' => 'leg-ev-'.Ulid::generate(),
            ]), self::JPEG)->assertCreated()->json('data.file_id');
        $patientId = $this->seedPatient($this->clinicId, 'Ndi', 'Alice');
        $legacyInvoiceId = (string) $this->actingAsReauthenticated($this->manager)
            ->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/imports/legacy-balances', [
                'dry_run' => false,
                'evidence_file_id' => $legacyEvidence,
                'rows' => [[
                    'line' => 2,
                    'patient_id' => $patientId,
                    'patient_record_number' => null,
                    'paper_reference' => 'CARNET-Q13-1',
                    'original_total' => 12000,
                    'already_paid' => 0,
                    'original_invoice_on' => '2026-09-10',
                ]],
            ])->assertCreated()->json('data.created_ids.0');
        $legacyPay = $this->pay($legacyInvoiceId, 1, 4000, 'MTN_MOMO', ['reference' => 'MOMO-LEG-4'])->assertCreated();

        // Rapprochement MoMo validé (attendu 4 000, relevé 3 700, écart -300).
        $start = CarbonImmutable::now('UTC')->subHour()->format('Y-m-d\TH:i:s.v\Z');
        $end = CarbonImmutable::now('UTC')->addHour()->format('Y-m-d\TH:i:s.v\Z');
        $recId = Ulid::generate();
        $this->write('POST', '/api/v1/payment-reconciliations', [
            'expected_version' => null,
            'reconciliation_id' => $recId,
            'method' => 'MTN_MOMO',
            'period_starts_at' => $start,
            'period_ends_at' => $end,
            'statement_amount' => 3700,
            'statement_file_id' => null,
            'variance_reason' => 'Frais transfert',
            'lines' => [[
                'line_id' => Ulid::generate(),
                'payment_id' => (string) $legacyPay->json('data.payment_id'),
                'refund_id' => null,
                'external_reference' => 'MOMO-LEG-4',
                'statement_amount' => 4000,
                'status' => 'MATCHED',
                'note' => null,
            ]],
        ], $this->manager)->assertCreated();
        $this->actingAsReauthenticated($this->manager)
            ->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/payment-reconciliations/'.$recId.'/validate', [
                'expected_version' => null,
                'reconciliation_id' => $recId,
                'statement_amount' => 3700,
                'statement_file_id' => null,
                'variance_reason' => 'Frais transfert 300 FCFA',
            ])->assertOk();

        // Lecture comptable Q13 (JSON).
        $today = CarbonImmutable::now('Africa/Douala')->format('Y-m-d');
        $q13 = $this->read('/api/v1/reports/accounting-export?from='.$today.'&to='.$today, $this->manager)->assertOk();
        $this->assertMatchesContract($q13, 'schemas/resources/operations.json#/$defs/AccountingExportReportResponse');

        $this->assertSame(15000, $q13->json('data.revenue.net_revenue'));
        $this->assertSame(14000, $q13->json('data.collections.net_total'));
        $this->assertSame(4000, $q13->json('data.collections.on_legacy.net_amount'));
        $this->assertSame(2500, $q13->json('data.expenses.total_amount'));
        $this->assertSame(1, $q13->json('data.reconciliations.validated_count'));
        $this->assertSame(-300, $q13->json('data.reconciliations.by_method.0.variance_total'));
        $this->assertSame(13000, $q13->json('data.receivables_at_read.amount_due')); // 5 000 natif + 8 000 reprise
        $this->assertSame(8000, $q13->json('data.receivables_at_read.of_which_legacy.amount_due'));
        $this->assertSame(9000, $q13->json('data.stock_valuation_at_read.known_cost_value'));

        // Téléchargement CSV Q13.
        $csvRes = $this->actingAsFresh($this->manager)
            ->get('/api/v1/reports/accounting-export/download?from='.$today.'&to='.$today)
            ->assertOk();
        $this->assertStringStartsWith('text/csv', (string) $csvRes->headers->get('Content-Type'));
        $body = $csvRes->getContent();
        $this->assertStringStartsWith("\xEF\xBB\xBF", $body);
        $this->assertStringContainsString('EAGLES_EYE_OPTICS_EXPORT_COMPTABLE_Q13', $body);
        $this->assertStringContainsString('CHIFFRE_AFFAIRES', $body);
        $this->assertStringContainsString('ENCAISSEMENT_CANAL', $body);
        $this->assertStringContainsString('DEPENSE_CATEGORIE', $body);
        $this->assertStringContainsString('RAPPROCHEMENT_CANAL', $body);
        $this->assertStringContainsString('IMPAYES_A_L_INSTANT', $body);
        $this->assertStringContainsString('STOCK_VALO_INSTANT', $body);

        // Caissière refusée sur Q13.
        $this->read('/api/v1/reports/accounting-export?from='.$today.'&to='.$today, $this->cashier)->assertForbidden();
    }

    private function uploadEvidence(string $bytes, string $type, bool $reauthenticated): TestResponse
    {
        $client = $reauthenticated ? $this->actingAsReauthenticated($this->manager) : $this->actingAsFresh($this->manager);
        $headers = [
            'CONTENT_TYPE' => $type,
            'X-Content-Sha256' => hash('sha256', $bytes),
            'Idempotency-Key' => 'rec-ev-'.Ulid::generate(),
        ];

        return $client->call('POST', '/api/v1/payment-reconciliations/statement-file', [], [], [], $this->transformHeadersToServerVars($headers), $bytes);
    }
}
