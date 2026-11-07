<?php

namespace Tests\Feature\Billing;

use App\Domain\Shared\Ulid;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\Support\OfflineResourceFixtures;
use Tests\Support\SyncFixtures;
use Tests\TestCase;

/**
 * Fraîcheur des totaux de la finance (R01 ; fichier 19 « Dashboard distant » ; AT45) avec de VRAIS postes, une VRAIE
 * clé ES256 et le chemin de synchronisation :
 *
 *  - un fait venu d'un poste est compté UNE fois par le rapport central, même quand le poste renvoie son lot (ACK perdu) ;
 *  - un poste à jour est complet ; des commandes reçues qui attendent (pièce liée absente) rendent les totaux INCOMPLETS ;
 *  - un poste sans nouvelle depuis plus de 24 h avant la fin de la période est signalé ; un poste jamais synchronisé aussi ;
 *    un poste qui ne détient ni plage de pièces financières ni propriété de facture, ou qui n'est plus actif, n'est pas
 *    une caisse et n'est pas listé.
 * Données fictives ; horloge figée à 09 h 30 UTC le 22/10/2026 (BillingFixtures).
 */
final class FinancialReportFreshnessTest extends TestCase
{
    use BillingFixtures;
    use MigratedDatabase;
    use OfflineResourceFixtures;
    use SyncFixtures;

    private const SCHEMA = 'schemas/resources/operations.json#/$defs/FinancialReportResponse';

    private string $receptionGrant;

    private string $cashierGrant;

    private string $patientRange;

    private string $invoiceRange;

    private string $receiptRange;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling(['patients', 'sales', 'stock', 'offline']);
        $this->signingDevice('Caisse A (fictive)');
        $this->receptionGrant = $this->seedGrant($this->syncDevice, $this->reception);
        $this->cashierGrant = $this->seedGrant($this->syncDevice, $this->cashier);
        $this->patientRange = $this->seedRange($this->receptionGrant, 'PATIENT', 101, 150);
        $this->invoiceRange = $this->seedRange($this->cashierGrant, 'INVOICE', 501, 600);
        $this->receiptRange = $this->seedRange($this->cashierGrant, 'RECEIPT', 501, 600);
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    private function finance(string $query, ?User $as = null): TestResponse
    {
        return $this->read('/api/v1/reports/financial'.$query, $as ?? $this->manager);
    }

    /** @return array<string, mixed> */
    private function report(string $query = '?from=2026-10-22&to=2026-10-22'): array
    {
        $response = $this->finance($query)->assertOk();
        $this->assertMatchesContract($response, self::SCHEMA);

        return (array) $response->json('data');
    }

    /**
     * Journal du poste : patient, brouillon (examen 15 000), émission, paiements de 5 000 puis 10 000.
     *
     * @return array{commands: list<array{core: array<string, mixed>, event_hash: string, signature: string}>, patient: string, invoice: string}
     */
    private function journal(): array
    {
        $patient = $this->patientPayload('EE-2026-0101');
        $invoice = Ulid::generate();

        return [
            'patient' => (string) $patient['patient_id'],
            'invoice' => $invoice,
            'commands' => [
                $this->signed('CreatePatient', $patient, 'patient_records', (string) $patient['patient_id'], $this->reception, $this->receptionGrant, null, $this->patientRange),
                $this->signed('CreateInvoiceDraft', $this->syncDraftPayload($invoice, (string) $patient['patient_id'], [$this->line($this->item['exam'])]), 'invoices', $invoice, $this->cashier, $this->cashierGrant),
                $this->signed('IssueInvoice', $this->syncIssuePayload($invoice, 'TEST-FAC-2026-000501', 15000), 'invoices', $invoice, $this->cashier, $this->cashierGrant, 1, $this->invoiceRange, [], '2026-10-22T09:21:00.000Z'),
                $this->signed('RegisterPayment', $this->syncPaymentPayload($invoice, 'TEST-REC-2026-000501', 5000), 'invoices', $invoice, $this->cashier, $this->cashierGrant, 1, $this->receiptRange, [], '2026-10-22T09:22:00.000Z'),
                $this->signed('RegisterPayment', $this->syncPaymentPayload($invoice, 'TEST-REC-2026-000502', 10000, '2026-10-22T09:23:00.000Z'), 'invoices', $invoice, $this->cashier, $this->cashierGrant, 2, $this->receiptRange, [], '2026-10-22T09:23:00.000Z'),
            ],
        ];
    }

    public function test_un_fait_de_poste_est_compte_une_seule_fois_meme_apres_un_renvoi_et_le_poste_a_jour_est_complet(): void
    {
        ['commands' => $commands] = $this->journal();
        $this->push($commands)->assertOk();

        $data = $this->report();

        // La vente de 15 000 et ses deux paiements, tels que le central les a appliqués.
        $this->assertSame(['count' => 1, 'total_gross' => 15000], $data['revenue']['issued']);
        $this->assertSame(15000, $data['collections']['net_total']);
        $this->assertSame(2, $data['collections']['by_method'][0]['payments_count']);
        $this->assertSame(0, $data['receivables']['amount_due']);
        // Le poste est une caisse (plages de factures et de reçus, propriété de la facture émise) et vient de synchroniser.
        $this->assertTrue($data['freshness']['complete']);
        $this->assertSame(24, $data['freshness']['silence_hours']);
        $this->assertCount(1, $data['freshness']['devices']);
        $device = $data['freshness']['devices'][0];
        $this->assertSame($this->syncDevice, $device['device_id']);
        $this->assertSame('Caisse A (fictive)', $device['name']);
        $this->assertSame(['UP_TO_DATE', 0, 0, '2026-10-22T09:30:00.000Z'], [$device['state'], $device['commands_pending'], $device['commands_in_conflict'], $device['last_sync_at']]);

        // Le poste n'a pas reçu l'ACK et renvoie son lot, plusieurs fois : ALREADY_ACCEPTED, aucun fait de plus.
        $this->push($commands)->assertOk()->assertJsonPath('results.4.status', 'ALREADY_ACCEPTED');
        $this->push($commands)->assertOk();
        $again = $this->report();
        $this->assertSame($data['revenue'], $again['revenue']);
        $this->assertSame($data['collections'], $again['collections']);
        $this->assertSame(2, DB::table('payments')->count());
    }

    public function test_des_commandes_recues_qui_attendent_rendent_les_totaux_incomplets(): void
    {
        ['commands' => $commands] = $this->journal();
        $this->push($commands)->assertOk();
        // Le poste a ensuite enregistré une facture d'un patient que le serveur ne connaît pas encore : reçue, en attente.
        $missingPatient = Ulid::generate();
        $invoice = Ulid::generate();
        $waiting = $this->signed('CreateInvoiceDraft', $this->syncDraftPayload($invoice, $missingPatient, [$this->line($this->item['exam'])]), 'invoices', $invoice, $this->cashier, $this->cashierGrant);
        $this->push([$waiting])->assertOk()->assertJsonPath('results.0.status', 'WAITING_DEPENDENCY');

        $data = $this->report();

        $this->assertFalse($data['freshness']['complete']);
        $this->assertSame('WAITING', $data['freshness']['devices'][0]['state']);
        $this->assertSame(1, $data['freshness']['devices'][0]['commands_pending']);
        // Le fait en attente n'est PAS dans les totaux : ils restent ceux de l'état appliqué.
        $this->assertSame(['count' => 1, 'total_gross' => 15000], $data['revenue']['issued']);
        $this->assertSame(15000, $data['collections']['net_total']);
    }

    public function test_un_poste_muet_ou_jamais_synchronise_est_signale_et_ce_qui_n_est_pas_une_caisse_est_ignore(): void
    {
        // Caisse A : dernière pièce reçue il y a près de 50 h.
        $cashA = $this->syncDevice;
        DB::table('enrolled_devices')->where('id', $cashA)->update(['last_sync_at' => '2026-10-20 08:00:00.000000']);
        // Caisse D : détient une plage de reçus, n'a jamais rien envoyé.
        $never = $this->signingDevice('Caisse D (jamais synchronisée)');
        $grant = $this->seedGrant($never, $this->cashier);
        $this->seedRange($grant, 'RECEIPT', 901, 950, 2026, $never);
        // Accueil : poste actif sans plage ni propriété, perdu : détient une plage mais n'est plus actif.
        $this->seedDevice('Accueil seul');
        $lost = $this->signingDevice('Caisse perdue', 'LOST');
        $lostGrant = $this->seedGrant($lost, $this->cashier);
        $this->seedRange($lostGrant, 'INVOICE', 951, 999, 2026, $lost);

        $data = $this->report();

        $this->assertFalse($data['freshness']['complete']);
        $devices = collect($data['freshness']['devices'])->keyBy('name');
        $this->assertSame(['Caisse A (fictive)', 'Caisse D (jamais synchronisée)'], $devices->keys()->all(), 'ni l\'accueil seul ni le poste perdu');
        $this->assertSame('SILENT', $devices['Caisse A (fictive)']['state']);
        $this->assertSame('2026-10-20T08:00:00.000Z', $devices['Caisse A (fictive)']['last_sync_at']);
        $this->assertSame('SILENT', $devices['Caisse D (jamais synchronisée)']['state']);
        $this->assertNull($devices['Caisse D (jamais synchronisée)']['last_sync_at']);

        // La fraîcheur se mesure à la fin de la PÉRIODE : pour une période close le 15 octobre, le poste qui a envoyé quelque
        // chose le 20 est à jour (il a parlé après la fin de la période) ; celui qui n'a jamais rien envoyé reste muet.
        $old = collect($this->report('?from=2026-10-10&to=2026-10-15')['freshness']['devices'])->keyBy('name');
        $this->assertSame('UP_TO_DATE', $old['Caisse A (fictive)']['state']);
        $this->assertSame('SILENT', $old['Caisse D (jamais synchronisée)']['state']);

        // Et un poste qui vient de parler passe à jour pour la période en cours.
        DB::table('enrolled_devices')->where('id', $cashA)->update(['last_sync_at' => CarbonImmutable::now('UTC')->subHours(2)->format('Y-m-d H:i:s.u')]);
        $recent = collect($this->report()['freshness']['devices'])->keyBy('name');
        $this->assertSame('UP_TO_DATE', $recent['Caisse A (fictive)']['state']);
    }

    public function test_la_gerante_seule_lit_la_fraicheur(): void
    {
        $this->finance('?from=2026-10-22&to=2026-10-22', $this->cashier)->assertForbidden();
        $this->finance('?from=2026-10-22&to=2026-10-22', $this->reception)->assertForbidden();
    }
}
