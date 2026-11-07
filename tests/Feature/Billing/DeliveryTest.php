<?php

namespace Tests\Feature\Billing;

use App\Domain\Access\Approvals\ApprovalSubject;
use App\Domain\Shared\Ulid;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Tests\Support\ApprovalFixtures;
use Tests\Support\BillingFixtures;
use Tests\Support\DeliveryFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Remise au patient (I01, AT15, AT16, AT17, EE016, EE026, IT15) sur MySQL réel : remise partielle puis totale d'une facture émise ;
 * la réserve posée à l'émission est consommée et le physique baisse dans la même transaction (rien n'est soustrait deux
 * fois) ; un mouvement SALE_DELIVERY négatif par ligne de remise ; lot non expiré au jour local ; remise d'une facture
 * non soldée seulement avec l'approbation exacte de la gérante ; rejeu idempotent ; remise confirmée immuable.
 * Données fictives.
 */
final class DeliveryTest extends TestCase
{
    use ApprovalFixtures;
    use BillingFixtures;
    use DeliveryFixtures;
    use MigratedDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling(['sales', 'stock', 'settings']);
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    public function test_remise_partielle_puis_totale_consomme_la_reserve_sans_double_soustraction(): void
    {
        $position = $this->seedPosition($this->item['frame'], '5');
        [$invoice] = $this->settledInvoice([$this->line($this->item['frame'], '2', 1, 40000)]);
        $line = $this->invoiceLine($invoice);
        $this->assertSame('2.000', (string) DB::table('stock_positions')->where('id', $position)->value('reserved'));
        $invoiceBefore = DB::table('invoices')->where('id', $invoice)->first();

        $first = $this->deliver($invoice, [$this->deliveryLine($line, $this->item['frame'], '1')]);

        $first->assertCreated()
            ->assertJsonPath('data.status', 'CONFIRMED')
            ->assertJsonPath('data.invoice_id', $invoice)
            ->assertJsonPath('data.credit_delivery_approval_id', null)
            ->assertJsonPath('data.lines.0.quantity', '1.000')
            ->assertJsonPath('data.lines.0.stock_position_id', $position);
        $this->assertMatchesContract($first, 'schemas/resources/billing.json#/$defs/DeliveryResponse');
        $row = DB::table('stock_positions')->where('id', $position)->first();
        $this->assertNotNull($row);
        $this->assertSame(['4.000', '1.000', '3.000'], [(string) $row->on_hand, (string) $row->reserved, (string) $row->central_available], 'Le disponible ne bouge pas : la quantité remise était déjà réservée.');
        $movement = DB::table('stock_movements')->where('kind', 'SALE_DELIVERY')->first();
        $this->assertNotNull($movement);
        $this->assertSame('-1.000', (string) $movement->signed_quantity);
        $this->assertSame($first->json('data.lines.0.id'), $movement->delivery_line_id);
        $reservation = DB::table('stock_reservations')->where('invoice_line_id', $line)->first();
        $this->assertNotNull($reservation);
        $this->assertSame(['ACTIVE', '1.000'], [(string) $reservation->status, (string) $reservation->consumed_quantity]);
        $delivery = DB::table('deliveries')->where('id', $first->json('data.id'))->first();
        $this->assertNotNull($delivery);
        $this->assertDataMatchesContract(json_decode((string) $delivery->patient_snapshot, false, 512, JSON_THROW_ON_ERROR), 'snapshots/delivery-patient.json');

        $view = $this->read('/api/v1/invoices/'.$invoice.'/deliveries')->assertOk();
        $this->assertMatchesContract($view, 'schemas/resources/billing.json#/$defs/InvoiceDeliveriesResponse');
        $view->assertJsonPath('data.lines.0.delivered', '1.000')
            ->assertJsonPath('data.lines.0.remaining', '1.000')
            ->assertJsonPath('data.lines.0.reserved_open', '1.000')
            ->assertJsonPath('data.amount_due', 0);

        $this->deliver($invoice, [$this->deliveryLine($line, $this->item['frame'], '1')])->assertCreated();

        $this->assertSame(['3.000', '0.000'], [$this->onHand('stock_positions', $position), (string) DB::table('stock_positions')->where('id', $position)->value('reserved')]);
        $this->assertSame('CONSUMED', DB::table('stock_reservations')->where('invoice_line_id', $line)->value('status'));
        $this->read('/api/v1/invoices/'.$invoice.'/deliveries')->assertJsonPath('data.lines.0.remaining', '0.000')->assertJsonPath('data.lines.0.deliverable', false);
        $this->assertEquals($invoiceBefore, DB::table('invoices')->where('id', $invoice)->first(), 'La remise ne change jamais la facture émise.');

        $this->deliver($invoice, [$this->deliveryLine($line, $this->item['frame'], '1')])
            ->assertStatus(422)
            ->assertJsonPath('error.details.remaining', '0.000')
            ->assertJsonStructure(['error' => ['fields' => ['lines.0.quantity']]]);
        $this->assertSame(2, DB::table('stock_movements')->where('kind', 'SALE_DELIVERY')->count());
        $this->assertSame(2, DB::table('outbox_events')->where('event_type', 'DeliveryConfirmed')->count());
    }

    public function test_le_vecteur_5_3_1_reste_un_et_refuse_le_depassement(): void
    {
        $position = $this->seedPosition($this->item['frame'], '5');
        [$invoice] = $this->settledInvoice([$this->line($this->item['frame'], '5', 1, 40000)]);
        $line = $this->invoiceLine($invoice);

        $this->deliver($invoice, [$this->deliveryLine($line, $this->item['frame'], '3')])->assertCreated();
        $this->deliver($invoice, [$this->deliveryLine($line, $this->item['frame'], '1')])->assertCreated();

        $this->deliver($invoice, [$this->deliveryLine($line, $this->item['frame'], '2')])
            ->assertStatus(422)
            ->assertJsonPath('error.details.remaining', '1.000');
        $this->deliver($invoice, [
            $this->deliveryLine($line, $this->item['frame'], '1'),
            $this->deliveryLine($line, $this->item['frame'], '1'),
        ])->assertStatus(422);
        $this->deliver($invoice, [$this->deliveryLine($line, $this->item['frame'], '0.5')])->assertStatus(422);
        $this->assertSame('1.000', $this->onHand('stock_positions', $position));
        $this->read('/api/v1/invoices/'.$invoice.'/deliveries')->assertJsonPath('data.lines.0.remaining', '1.000');
    }

    public function test_un_article_sans_stock_se_remet_sans_reserve_ni_mouvement(): void
    {
        [$invoice] = $this->settledInvoice([$this->line($this->item['lens'], '1', 1, 60000)]);
        $line = $this->invoiceLine($invoice);

        $this->deliver($invoice, [$this->deliveryLine($line, $this->item['lens'])])
            ->assertCreated()
            ->assertJsonPath('data.lines.0.reservation_id', null)
            ->assertJsonPath('data.lines.0.stock_position_id', null);

        $this->assertSame(0, DB::table('stock_movements')->count());
        $this->deliver($invoice, [$this->deliveryLine($line, $this->item['lens'], '1', ['stock_movement_id' => Ulid::generate()])])->assertStatus(422);
    }

    public function test_un_lot_expire_au_jour_local_de_la_remise_n_est_pas_remis(): void
    {
        $position = $this->seedPosition($this->item['drops'], '2');
        $lot = $this->seedLot($position, $this->item['drops'], 'LOT-FICTIF-1', '2026-10-22', '2');
        [$invoice] = $this->settledInvoice([$this->line($this->item['drops'], '1', 1, 5000)]);
        $this->assertSame($lot, DB::table('stock_reservations')->where('invoice_line_id', $this->invoiceLine($invoice))->value('stock_lot_id'));

        // Le lendemain (heure du cabinet), le lot réservé est expiré.
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-23 08:00:00', 'UTC'));
        $this->deliver($invoice, [$this->deliveryLine($this->invoiceLine($invoice), $this->item['drops'])], ['delivered_at' => '2026-10-23T08:00:00.000Z'])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'LOT_EXPIRED')
            ->assertJsonPath('error.details.expires_on', '2026-10-22');

        $this->assertSame('2.000', $this->onHand('stock_lots', $lot));
        $this->assertSame(0, DB::table('deliveries')->count());
    }

    public function test_un_lot_qui_expire_le_jour_meme_reste_remis_ce_jour_la(): void
    {
        $position = $this->seedPosition($this->item['drops'], '2');
        $lot = $this->seedLot($position, $this->item['drops'], 'LOT-FICTIF-2', '2026-10-22', '2');
        [$invoice] = $this->settledInvoice([$this->line($this->item['drops'], '1', 1, 5000)]);

        $this->deliver($invoice, [$this->deliveryLine($this->invoiceLine($invoice), $this->item['drops'])])
            ->assertCreated()
            ->assertJsonPath('data.lines.0.stock_lot_id', $lot);

        $this->assertSame(['1.000', '0.000'], [$this->onHand('stock_lots', $lot), (string) DB::table('stock_lots')->where('id', $lot)->value('reserved')]);
        $this->assertSame($lot, DB::table('stock_movements')->where('kind', 'SALE_DELIVERY')->value('lot_id'));
    }

    public function test_une_facture_non_soldee_exige_l_approbation_exacte_de_la_gerante(): void
    {
        $position = $this->seedPosition($this->item['frame'], '3');
        [$invoice] = $this->issuedInvoice([$this->line($this->item['frame'], '2', 1, 40000)], $this->manager);
        $line = $this->invoiceLine($invoice);

        $this->deliver($invoice, [$this->deliveryLine($line, $this->item['frame'])])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'APPROVAL_REQUIRED_OR_EXPIRED')
            ->assertJsonPath('error.details.amount_due', 80000);
        $this->assertSame(0, DB::table('deliveries')->count());
        $this->assertSame('3.000', $this->onHand('stock_positions', $position));

        $approval = $this->approved(ApprovalSubject::creditDelivery($invoice, 80000, [['invoice_line_id' => $line, 'quantity' => '1']])->toArray(), $this->cashier);

        // Contenu différent (deux articles au lieu d'un) : refusé, l'approbation reste utilisable.
        $this->deliver($invoice, [$this->deliveryLine($line, $this->item['frame'], '2')], ['credit_delivery_approval_id' => $approval])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'APPROVAL_REQUIRED_OR_EXPIRED');
        $this->assertSame('APPROVED', DB::table('approvals')->where('id', $approval)->value('status'));

        $this->deliver($invoice, [$this->deliveryLine($line, $this->item['frame'], '1')], ['credit_delivery_approval_id' => $approval])
            ->assertCreated()
            ->assertJsonPath('data.credit_delivery_approval_id', $approval);
        $this->assertSame('CONSUMED', DB::table('approvals')->where('id', $approval)->value('status'));
        $this->assertSame($approval, DB::table('deliveries')->where('invoice_id', $invoice)->value('credit_delivery_approval_id'));

        // Une approbation ne sert qu'une fois.
        $this->deliver($invoice, [$this->deliveryLine($line, $this->item['frame'], '1')], ['credit_delivery_approval_id' => $approval])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'APPROVAL_REQUIRED_OR_EXPIRED');
    }

    public function test_un_encaissement_entre_la_demande_et_la_remise_exige_une_nouvelle_approbation(): void
    {
        $this->seedPosition($this->item['frame'], '3');
        [$invoice] = $this->issuedInvoice([$this->line($this->item['frame'], '1', 1, 40000)], $this->manager);
        $line = $this->invoiceLine($invoice);
        $approval = $this->approved(ApprovalSubject::creditDelivery($invoice, 40000, [['invoice_line_id' => $line, 'quantity' => '1']])->toArray(), $this->cashier);
        $this->pay($invoice, 1, 10000)->assertCreated();

        $this->deliver($invoice, [$this->deliveryLine($line, $this->item['frame'])], ['credit_delivery_approval_id' => $approval])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'APPROVAL_REQUIRED_OR_EXPIRED');
    }

    public function test_la_gerante_remet_a_credit_directement_avec_la_meme_tracabilite(): void
    {
        $this->seedPosition($this->item['frame'], '3');
        [$invoice] = $this->issuedInvoice([$this->line($this->item['frame'], '1', 1, 40000)], $this->manager);
        $approval = Ulid::generate();

        $this->deliver($invoice, [$this->deliveryLine($this->invoiceLine($invoice), $this->item['frame'])], ['credit_delivery_approval_id' => $approval], $this->manager)
            ->assertCreated()
            ->assertJsonPath('data.credit_delivery_approval_id', $approval);

        $row = DB::table('approvals')->where('id', $approval)->first();
        $this->assertNotNull($row);
        $this->assertSame(['delivery.confirm', 'invoices', $invoice, 'CONSUMED'], [(string) $row->action_code, (string) $row->target_type, (string) $row->target_id, (string) $row->status]);
        $audit = DB::table('audit_events')->where('action', 'delivery.confirmed')->first();
        $this->assertNotNull($audit);
        $this->assertStringContainsString('DIRECT', (string) $audit->sanitized_diff);
    }

    public function test_une_facture_soldee_ignore_un_identifiant_d_approbation_fourni(): void
    {
        $this->seedPosition($this->item['frame'], '3');
        [$invoice] = $this->settledInvoice([$this->line($this->item['frame'], '1', 1, 40000)]);
        $approval = Ulid::generate();

        $this->deliver($invoice, [$this->deliveryLine($this->invoiceLine($invoice), $this->item['frame'])], ['credit_delivery_approval_id' => $approval])
            ->assertCreated()
            ->assertJsonPath('data.credit_delivery_approval_id', null);
        $this->assertFalse(DB::table('approvals')->where('id', $approval)->exists());
    }

    public function test_le_rejeu_de_la_meme_cle_rend_la_meme_remise_sans_seconde_sortie(): void
    {
        $position = $this->seedPosition($this->item['frame'], '3');
        [$invoice] = $this->settledInvoice([$this->line($this->item['frame'], '1', 1, 40000)]);
        $body = $this->deliveryBody($invoice, [$this->deliveryLine($this->invoiceLine($invoice), $this->item['frame'])]);
        $key = Ulid::generate();

        $first = $this->write('POST', '/api/v1/invoices/'.$invoice.'/deliveries', $body, null, $key)->assertCreated();
        $replay = $this->write('POST', '/api/v1/invoices/'.$invoice.'/deliveries', $body, null, $key)->assertCreated();

        // Le résultat rejoué sort de la colonne JSON, dont MySQL normalise l'ordre des clés : même contenu, pas même ordre.
        $this->assertEquals($first->json('data'), $replay->json('data'));
        $this->assertSame(1, DB::table('deliveries')->count());
        $this->assertSame(1, DB::table('stock_movements')->where('kind', 'SALE_DELIVERY')->count());
        $this->assertSame('2.000', $this->onHand('stock_positions', $position));

        // Même remise sous une nouvelle clé : identifiant déjà pris, rien n'est remis deux fois.
        $this->write('POST', '/api/v1/invoices/'.$invoice.'/deliveries', $body)
            ->assertStatus(422)
            ->assertJsonStructure(['error' => ['fields' => ['delivery_id']]]);
    }

    public function test_les_refus_d_etat_et_de_date(): void
    {
        $this->seedPosition($this->item['frame'], '3');
        [$draft] = $this->draft([$this->line($this->item['frame'])], $this->manager);
        $this->deliver($draft, [$this->deliveryLine($this->invoiceLine($draft), $this->item['frame'])])
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED');

        [$invoice] = $this->settledInvoice([$this->line($this->item['frame'], '1', 1, 40000)]);
        $line = $this->invoiceLine($invoice);
        $this->deliver($invoice, [$this->deliveryLine($line, $this->item['frame'])], ['delivered_at' => '2026-10-21T09:30:00.000Z'])
            ->assertStatus(422)
            ->assertJsonStructure(['error' => ['fields' => ['delivered_at']]]);
        $this->deliver($invoice, [$this->deliveryLine($line, $this->item['frame'])], ['delivered_at' => '2026-10-22T11:30:00.000Z'])
            ->assertStatus(422);
        $this->deliver($invoice, [$this->deliveryLine($line, $this->item['drops'])])->assertStatus(422);
        $this->deliver($invoice, [$this->deliveryLine(Ulid::generate(), $this->item['frame'])])->assertStatus(422);
        $this->assertSame(0, DB::table('deliveries')->where('invoice_id', $invoice)->count());
    }

    public function test_une_facture_detenue_par_un_poste_se_remet_sur_ce_poste(): void
    {
        $this->seedPosition($this->item['frame'], '3');
        [$invoice] = $this->settledInvoice([$this->line($this->item['frame'], '1', 1, 40000)]);
        $this->seedWriteOwner($invoice);

        $this->deliver($invoice, [$this->deliveryLine($this->invoiceLine($invoice), $this->item['frame'])])
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'WRITE_OWNER_REQUIRED');
    }

    public function test_droits_et_module(): void
    {
        $this->seedPosition($this->item['frame'], '3');
        [$invoice] = $this->settledInvoice([$this->line($this->item['frame'], '1', 1, 40000)]);
        $line = $this->invoiceLine($invoice);

        $this->deliver($invoice, [$this->deliveryLine($line, $this->item['frame'])], [], $this->reception)->assertForbidden();
        $this->deliver($invoice, [$this->deliveryLine($line, $this->item['frame'])], [], $this->clinician)->assertForbidden();
        $this->write('POST', '/api/v1/invoices/'.Ulid::generate().'/deliveries', $this->deliveryBody($invoice, [$this->deliveryLine($line, $this->item['frame'])]))->assertStatus(422);

        config(['eeo.enabled_modules' => ['stock', 'settings']]);
        $this->deliver($invoice, [$this->deliveryLine($line, $this->item['frame'])])->assertNotFound();
        $this->read('/api/v1/invoices/'.$invoice.'/deliveries')->assertNotFound();
    }

    public function test_une_remise_confirmee_est_immuable(): void
    {
        $this->seedPosition($this->item['frame'], '3');
        [$invoice] = $this->settledInvoice([$this->line($this->item['frame'], '1', 1, 40000)]);
        $id = (string) $this->deliver($invoice, [$this->deliveryLine($this->invoiceLine($invoice), $this->item['frame'])])->assertCreated()->json('data.id');

        $this->expectExceptionMessage('Finalized record is immutable');
        DB::table('deliveries')->where('id', $id)->update(['delivered_at' => '2026-10-22 10:00:00.000000']);
    }
}
