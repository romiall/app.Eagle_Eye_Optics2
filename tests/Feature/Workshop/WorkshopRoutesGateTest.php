<?php

namespace Tests\Feature\Workshop;

use App\Domain\Shared\Ulid;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Mise en service progressive et droits de l'atelier optique (L1D04) :
 * - module `workshop` fermé -> 404 partout (même gérante) ;
 * - module ouvert : réservé strictement au droit `workshop.manage` (403 sinon).
 */
final class WorkshopRoutesGateTest extends TestCase
{
    use BillingFixtures;
    use MigratedDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling(['sales', 'stock']);
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    public function test_disabled_workshop_module_hides_all_routes_with_404(): void
    {
        $id = Ulid::generate();

        $this->read('/api/v1/workshop-orders', $this->manager)->assertStatus(404);
        $this->read('/api/v1/workshop-orders/eligible-lines', $this->manager)->assertStatus(404);
        $this->read('/api/v1/workshop-orders/'.$id, $this->manager)->assertStatus(404);
        $this->write('POST', '/api/v1/workshop-orders', ['expected_version' => null], $this->manager)->assertStatus(404);
        $this->write('POST', '/api/v1/workshop-orders/'.$id.'/advance', ['expected_version' => 1], $this->manager)->assertStatus(404);
    }

    public function test_permission_gate_reserves_workshop_routes_to_workshop_manage(): void
    {
        config(['eeo.enabled_modules' => ['sales', 'stock', 'workshop']]);
        $id = Ulid::generate();

        foreach ([$this->cashier, $this->clinician, $this->reception] as $staff) {
            $this->read('/api/v1/workshop-orders', $staff)->assertStatus(403);
            $this->read('/api/v1/workshop-orders/eligible-lines', $staff)->assertStatus(403);
            $this->read('/api/v1/workshop-orders/'.$id, $staff)->assertStatus(403);
            $this->write('POST', '/api/v1/workshop-orders', ['expected_version' => null], $staff)->assertStatus(403);
            $this->write('POST', '/api/v1/workshop-orders/'.$id.'/advance', ['expected_version' => 1], $staff)->assertStatus(403);
        }

        $this->read('/api/v1/workshop-orders', $this->manager)->assertOk();
        $this->read('/api/v1/workshop-orders/eligible-lines', $this->manager)->assertOk();
        $this->read('/api/v1/workshop-orders/'.$id, $this->manager)->assertStatus(404);

        $this->allowPermission($this->clinician, 'workshop.manage');
        $this->read('/api/v1/workshop-orders', $this->clinician)->assertOk();
    }
}
