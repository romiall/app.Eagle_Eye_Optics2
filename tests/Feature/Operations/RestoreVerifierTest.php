<?php

namespace Tests\Feature\Operations;

use App\Domain\Operations\RestoreVerifier;
use App\Domain\Shared\Ulid;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\Support\OfflineResourceFixtures;
use Tests\TestCase;

/**
 * Vérification d'une base restaurée (X03 ; AT27) sur MySQL réel : la base de test joue la base restaurée. Une vente
 * réelle par l'API (facture émise, paiement, reçu) passe tous les contrôles ; chaque altération simulée (numéro
 * consommé au-delà de la séquence, empreinte d'audit fausse, fichier privé manquant) est détectée ; une plage de
 * numéros encore ouverte sur un poste est une ALERTE de réconciliation. Commandes : refus d'une base qui n'est pas
 * jetable, journal des sauvegardes (une sauvegarde sans clé n'est jamais « réussie »). Données fictives.
 */
final class RestoreVerifierTest extends TestCase
{
    use BillingFixtures;
    use MigratedDatabase;
    use OfflineResourceFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling(['patients', 'sales', 'stock']);
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    /**
     * @return array{status: string, checks: list<array{code: string, label: string, status: string, count: int, details: list<string>}>, facts: array<string, mixed>}
     */
    private function verify(?\Closure $digest = null): array
    {
        return (new RestoreVerifier(DB::connection()))->verify($digest ?? static fn (string $path): ?string => null);
    }

    /**
     * @param  array{checks: list<array{code: string, label: string, status: string, count: int, details: list<string>}>}  $report
     * @return array{code: string, label: string, status: string, count: int, details: list<string>}
     */
    private static function check(array $report, string $code): array
    {
        foreach ($report['checks'] as $check) {
            if ($check['code'] === $code) {
                return $check;
            }
        }
        self::fail('Contrôle absent : '.$code);
    }

    /** Vente réelle : facture émise et un paiement avec son reçu. Rend le numéro du reçu. */
    private function sale(): string
    {
        [$invoice, $total] = $this->issuedInvoice([$this->line($this->item['lens'], '1', 1, 80000)], $this->manager);
        $this->pay($invoice, $this->ledgerVersion($invoice), 30000, 'MTN_MOMO', [], $this->manager)->assertCreated();
        $this->assertSame(80000, $total);

        return (string) DB::table('receipts')->where('invoice_id', $invoice)->value('number');
    }

    public function test_une_base_coherente_passe_tous_les_controles_et_rend_le_dernier_recu(): void
    {
        $receipt = $this->sale();

        $report = $this->verify();

        foreach (['SCHEMA_TABLES', 'INTEGRITY', 'SEQUENCES', 'NUMBERED_DOCUMENTS', 'AUDIT_HASHES', 'STORED_FILES', 'OFFLINE_RECONCILIATION'] as $code) {
            $this->assertSame(RestoreVerifier::PASS, self::check($report, $code)['status'], $code.' : '.implode(' | ', self::check($report, $code)['details']));
        }
        $this->assertSame(RestoreVerifier::PASS, $report['status']);
        $this->assertSame($receipt, $report['facts']['last_receipt_number'], 'le dernier reçu est retrouvé');
        $this->assertSame(1, $report['facts']['receipts']);
    }

    public function test_un_numero_consomme_au_dela_de_la_sequence_est_une_remise_a_zero(): void
    {
        $this->sale();
        DB::table('document_number_usages')->insert([
            'id' => Ulid::generate(), 'clinic_id' => $this->clinicId, 'allocation_id' => null, 'document_type' => 'RECEIPT',
            'document_year' => 2026, 'number_value' => 999, 'rendered_number' => 'TEST-REC-000999', 'entity_type' => 'receipts',
            'entity_id' => Ulid::generate(), 'source_device_id' => null, 'actor_id' => $this->manager->id,
            'consumed_at' => '2026-10-22 09:30:00.000000', 'status' => 'USED',
            'created_at' => '2026-10-22 09:30:00.000000', 'updated_at' => '2026-10-22 09:30:00.000000',
        ]);

        $sequences = self::check($this->verify(), 'SEQUENCES');
        $this->assertSame(RestoreVerifier::FAIL, $sequences['status']);
        $this->assertStringContainsString('RECEIPT 2026', $sequences['details'][0]);
        $this->assertStringContainsString('999', $sequences['details'][0]);
    }

    public function test_une_empreinte_d_audit_fausse_et_un_fichier_manquant_sont_detectes(): void
    {
        $this->sale();
        $forged = Ulid::generate();
        DB::table('audit_events')->insert([
            'id' => $forged, 'clinic_id' => $this->clinicId, 'actor_id' => $this->manager->id, 'actor_name_snapshot' => 'Gérante fictive',
            'action' => 'invoice.issued', 'target_type' => 'invoices', 'target_id' => null,
            'recorded_at' => '2026-10-22 09:31:00.000000', 'correlation_id' => 'test', 'reason' => null, 'sanitized_diff' => null,
            'previous_hash' => null, 'event_hash' => str_repeat('0', 64),
            'created_at' => '2026-10-22 09:31:00.000000', 'updated_at' => '2026-10-22 09:31:00.000000',
        ]);
        $present = Ulid::generate();
        $missing = Ulid::generate();
        foreach ([$present => 'documents/present.pdf', $missing => 'documents/absent.pdf'] as $id => $path) {
            DB::table('stored_files')->insert([
                'id' => $id, 'clinic_id' => $this->clinicId, 'private_path' => $path, 'mime_type' => 'application/pdf',
                'size_bytes' => 10, 'sha256' => hash('sha256', 'fictif'), 'classification' => 'FINANCIAL',
                'encryption_key_id' => null, 'uploaded_by' => $this->manager->id, 'archived_at' => null,
                'created_at' => '2026-10-22 09:31:00.000000', 'updated_at' => '2026-10-22 09:31:00.000000',
            ]);
        }

        $report = $this->verify(static fn (string $path): ?string => $path === 'documents/present.pdf' ? hash('sha256', 'fictif') : null);

        $audit = self::check($report, 'AUDIT_HASHES');
        $this->assertSame(RestoreVerifier::FAIL, $audit['status']);
        $this->assertSame([$forged], $audit['details']);
        $files = self::check($report, 'STORED_FILES');
        $this->assertSame(RestoreVerifier::FAIL, $files['status']);
        $this->assertSame(1, $files['count']);
        $this->assertStringContainsString($missing, $files['details'][0]);
        $this->assertSame(RestoreVerifier::FAIL, $report['status']);

        // Sans dossier de fichiers restaurés : alerte, jamais un succès présumé.
        $this->assertSame(RestoreVerifier::WARN, self::check((new RestoreVerifier(DB::connection()))->verify(null), 'STORED_FILES')['status']);
    }

    public function test_une_plage_ouverte_sur_un_poste_est_a_reconcilier_avant_reouverture(): void
    {
        $this->sale();
        $device = $this->seedDevice('Caisse A');
        DB::table('document_number_allocations')->insert([
            'id' => Ulid::generate(), 'clinic_id' => $this->clinicId, 'device_id' => $device, 'grant_id' => $this->seedGrant($device, $this->cashier),
            'document_type' => 'RECEIPT', 'document_year' => 2026, 'range_start' => 101, 'range_end' => 150, 'last_consumed_value' => 104,
            'status' => 'ACTIVE', 'allocated_at' => '2026-10-22 08:00:00.000000', 'closed_at' => null, 'version' => 1,
            'created_at' => '2026-10-22 08:00:00.000000', 'updated_at' => '2026-10-22 08:00:00.000000',
        ]);
        // Le serveur a réservé la plage : la séquence est à son bout.
        DB::table('document_sequences')->where('clinic_id', $this->clinicId)->where('document_type', 'RECEIPT')->where('document_year', 2026)
            ->update(['last_value' => 150]);

        $report = $this->verify();

        $this->assertSame(RestoreVerifier::PASS, self::check($report, 'SEQUENCES')['status']);
        $offline = self::check($report, 'OFFLINE_RECONCILIATION');
        $this->assertSame(RestoreVerifier::WARN, $offline['status']);
        $this->assertStringContainsString('101–150', $offline['details'][0]);
        $this->assertStringContainsString('104', $offline['details'][0]);
        $this->assertSame(RestoreVerifier::WARN, $report['status']);
    }

    public function test_les_diagnostics_versionnes_sont_lus_un_par_un(): void
    {
        $statements = RestoreVerifier::diagnostics();
        $expected = substr_count((string) file_get_contents(base_path('database/05_integrity_checks.sql')), "\nSELECT '");
        $this->assertGreaterThan(20, $expected);
        $this->assertCount($expected, $statements);
        foreach ($statements as $statement) {
            $this->assertStringNotContainsString('--', $statement);
        }
    }

    public function test_la_commande_refuse_la_base_de_l_application_et_une_base_non_jetable(): void
    {
        $live = (string) config('database.connections.'.config('database.default').'.database');
        $this->assertSame(2, Artisan::call('eeo:restore:verify', ['database' => $live]));
        $this->assertSame(2, Artisan::call('eeo:restore:verify', ['database' => 'eeo_production']));
        $this->assertSame(2, Artisan::call('eeo:restore:verify', ['database' => 'eeo_restore', '--started-at' => 'hier']));
    }

    public function test_le_nom_d_une_base_jetable_accepte_le_suffixe_court_des_hebergeurs_a_noms_limites(): void
    {
        // Hostinger limite le nom d'une base à 14 caractères après le préfixe du compte : « eagleseye_rest » tient, « eagleseye_restore » non.
        $this->assertSame(2, Artisan::call('eeo:restore:verify', ['database' => 'eagleseye_rest', '--started-at' => 'hier']));
        $this->assertStringNotContainsString('le nom de la base jetable', Artisan::output());

        $this->assertSame(2, Artisan::call('eeo:restore:verify', ['database' => 'eagleseye_rester', '--started-at' => 'hier']));
        $this->assertStringContainsString('le nom de la base jetable', Artisan::output());
    }

    public function test_la_base_jetable_se_lit_avec_son_propre_utilisateur_quand_il_est_fourni(): void
    {
        // Un utilisateur par base (Hostinger) : celui de l'application n'a aucun droit sur la base jetable. Un utilisateur inconnu
        // est refusé par le serveur, ce qui prouve que les identifiants fournis remplacent ceux de l'application.
        config(['eeo.restore.db_username' => 'utilisateur_inconnu_x', 'eeo.restore.db_password' => 'mot-de-passe-factice']);

        $this->assertSame(1, Artisan::call('eeo:restore:verify', ['database' => 'eeo_absente_restore']));
        $output = Artisan::output(); // la sortie se vide à la lecture : une seule fois
        $this->assertStringContainsString('Vérification impossible', $output);
        $this->assertStringContainsString('utilisateur_inconnu_x', $output);
    }

    public function test_une_sauvegarde_sans_cle_est_consignee_non_chiffree(): void
    {
        $this->assertSame(0, Artisan::call('eeo:backup:record', [
            '--scope' => 'SERVER_DATABASE', '--status' => 'SUCCEEDED', '--started-at' => '2026-10-22T01:00:00Z',
            '--completed-at' => '2026-10-22T01:05:00Z', '--destination' => '/home/fictif/eeo-backups/eeo-backup-20261022T010000Z',
            '--sha256' => hash('sha256', 'a'), '--size' => '1024',
        ]));
        $plain = DB::table('backup_runs')->where('clinic_id', $this->clinicId)->orderByDesc('created_at')->first();
        $this->assertNotNull($plain);
        $this->assertSame('FAILED', $plain->status);
        $this->assertSame('NOT_ENCRYPTED', $plain->error_code);

        $this->assertSame(0, Artisan::call('eeo:backup:record', [
            '--scope' => 'SERVER_FILES', '--status' => 'SUCCEEDED', '--started-at' => '2026-10-22T01:00:00Z',
            '--completed-at' => '2026-10-22T01:06:00Z', '--destination' => '/home/fictif/eeo-backups/eeo-backup-20261022T010000Z',
            '--sha256' => hash('sha256', 'b'), '--size' => '2048', '--key-id' => 'sha256:0123456789abcdef',
        ]));
        $encrypted = DB::table('backup_runs')->where('clinic_id', $this->clinicId)->where('scope', 'SERVER_FILES')->first();
        $this->assertNotNull($encrypted);
        $this->assertSame('SUCCEEDED', $encrypted->status);
        $this->assertSame('sha256:0123456789abcdef', $encrypted->encryption_key_id);

        $this->assertSame(2, Artisan::call('eeo:backup:record', ['--scope' => 'TOUT', '--status' => 'SUCCEEDED']));
    }
}
