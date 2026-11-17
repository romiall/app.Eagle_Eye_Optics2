<?php

namespace Tests\Unit\Rules;

use App\Domain\Billing\Rules\FieldErrors;
use App\Domain\Shared\BusinessError;
use App\Domain\Workshop\Rules\WorkshopOrderRules;
use PHPUnit\Framework\TestCase;

/**
 * Règles pures de l'atelier optique (L1D04) : machine à états, reprise / révision, remise physique,
 * retards (hors états terminaux) et validation stricte positive des mesures optiques.
 */
final class WorkshopOrderRulesTest extends TestCase
{
    public function test_forward_transitions_rework_and_ready_revisions(): void
    {
        $received = WorkshopOrderRules::planTransition('ORDERED', 'STATUS_CHANGE', 'RECEIVED', 'NOT_APPLICABLE', null, null);
        self::assertSame('RECEIVED', $received['new_status']);
        self::assertFalse($received['increment_ready_revision']);
        self::assertTrue($received['sets_received_at']);

        $mounting = WorkshopOrderRules::planTransition('RECEIVED', 'STATUS_CHANGE', 'MOUNTING', 'NOT_APPLICABLE', null, null);
        self::assertSame('MOUNTING', $mounting['new_status']);
        self::assertFalse($mounting['sets_received_at']);

        $qc = WorkshopOrderRules::planTransition('MOUNTING', 'STATUS_CHANGE', 'QUALITY_CHECK', 'NOT_APPLICABLE', null, null);
        self::assertSame('QUALITY_CHECK', $qc['new_status']);

        $qcPass = WorkshopOrderRules::planTransition('QUALITY_CHECK', 'QUALITY_CHECK', 'READY', 'PASSED', 'RAS', null);
        self::assertSame('READY', $qcPass['new_status']);
        self::assertTrue($qcPass['increment_ready_revision']);

        $qcFail = WorkshopOrderRules::planTransition('QUALITY_CHECK', 'QUALITY_CHECK', 'MOUNTING', 'FAILED', 'Décentrement 1mm', null);
        self::assertSame('MOUNTING', $qcFail['new_status']);
        self::assertFalse($qcFail['increment_ready_revision']);

        $reworkFromReady = WorkshopOrderRules::planTransition('READY', 'REWORK', 'ORDERED', 'NOT_APPLICABLE', 'Verre rayé', null);
        self::assertSame('ORDERED', $reworkFromReady['new_status']);
        self::assertFalse($reworkFromReady['increment_ready_revision']);

        $delivered = WorkshopOrderRules::planTransition('READY', 'STATUS_CHANGE', 'DELIVERED', 'NOT_APPLICABLE', null, '01ARZ3NDEKTSV4RRFFQ69G5FAV');
        self::assertSame('DELIVERED', $delivered['new_status']);
        self::assertTrue($delivered['requires_delivery_line']);
    }

    public function test_invalid_transitions_and_missing_prerequisites_are_rejected(): void
    {
        $cases = [
            ['ORDERED', 'QUALITY_CHECK', 'READY', 'PASSED', 'Trop tôt', null, 409],
            ['MOUNTING', 'STATUS_CHANGE', 'DELIVERED', 'NOT_APPLICABLE', null, '01ARZ3NDEKTSV4RRFFQ69G5FAV', 409],
            ['READY', 'STATUS_CHANGE', 'DELIVERED', 'NOT_APPLICABLE', null, null, 422],
            ['READY', 'REWORK', 'ORDERED', 'NOT_APPLICABLE', '', null, 422],
            ['QUALITY_CHECK', 'QUALITY_CHECK', 'MOUNTING', 'FAILED', '   ', null, 422],
            ['DELIVERED', 'ADJUSTMENT', null, 'NOT_APPLICABLE', 'Note interdite', null, 409],
            ['CANCELLED', 'STATUS_CHANGE', 'ORDERED', 'NOT_APPLICABLE', null, null, 409],
        ];

        foreach ($cases as [$status, $eventType, $newStatus, $quality, $obs, $deliveryLineId, $expectedStatus]) {
            try {
                WorkshopOrderRules::planTransition($status, $eventType, $newStatus, $quality, $obs, $deliveryLineId);
                self::fail("Transition {$status} / {$eventType} devrait être refusée.");
            } catch (BusinessError $error) {
                self::assertSame($expectedStatus, $error->httpStatus);
            }
        }
    }

    public function test_overdue_rule_excludes_terminal_statuses_and_respects_instant_order(): void
    {
        $now = '2026-10-25T12:00:00.000Z';

        self::assertTrue(WorkshopOrderRules::isOverdue('ORDERED', '2026-10-25T11:59:59.000Z', $now));
        self::assertFalse(WorkshopOrderRules::isOverdue('ORDERED', '2026-10-25T12:00:00.000Z', $now));
        self::assertFalse(WorkshopOrderRules::isOverdue('ORDERED', null, $now));
        self::assertFalse(WorkshopOrderRules::isOverdue('DELIVERED', '2026-10-01T12:00:00.000Z', $now));
        self::assertFalse(WorkshopOrderRules::isOverdue('CANCELLED', '2026-10-01T12:00:00.000Z', $now));
    }

    public function test_positive_optical_measure_validation(): void
    {
        $errors = new FieldErrors;
        self::assertSame('32.50', WorkshopOrderRules::validatePositiveMeasure('32,5', 'pd_od', $errors));
        self::assertNull(WorkshopOrderRules::validatePositiveMeasure(null, 'pd_og', $errors));
        self::assertTrue($errors->isEmpty());

        self::assertNull(WorkshopOrderRules::validatePositiveMeasure('0', 'pd_od', $errors));
        self::assertNull(WorkshopOrderRules::validatePositiveMeasure('-12.00', 'fitting_height_od', $errors));
        self::assertArrayHasKey('pd_od', $errors->all());
        self::assertArrayHasKey('fitting_height_od', $errors->all());
    }
}
