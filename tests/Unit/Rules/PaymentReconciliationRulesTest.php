<?php

namespace Tests\Unit\Rules;

use App\Domain\Billing\Rules\FieldErrors;
use App\Domain\Cash\Rules\PaymentReconciliationRules;
use App\Domain\Shared\BusinessError;
use PHPUnit\Framework\TestCase;

/**
 * Règles pures de rapprochement par canal (L1D06).
 */
final class PaymentReconciliationRulesTest extends TestCase
{
    public function test_periode_invalide_ou_inversee_est_refusee(): void
    {
        $this->expectException(BusinessError::class);
        PaymentReconciliationRules::assertPeriod(
            '2026-10-10T10:00:00.000Z',
            '2026-10-10T10:00:00.000Z',
            new FieldErrors,
        );
    }

    public function test_ligne_avec_paiement_et_remboursement_simultanes_est_refusee(): void
    {
        $this->expectException(BusinessError::class);
        PaymentReconciliationRules::assertLines([[
            'line_id' => '01J00000000000000000000001',
            'payment_id' => '01J00000000000000000000002',
            'refund_id' => '01J00000000000000000000003',
            'external_reference' => null,
            'statement_amount' => 5000,
            'status' => 'MATCHED',
            'note' => null,
        ]], new FieldErrors);
    }

    public function test_doublon_de_paiement_dans_le_meme_rapprochement_est_refuse(): void
    {
        $this->expectException(BusinessError::class);
        PaymentReconciliationRules::assertLines([
            [
                'line_id' => '01J00000000000000000000001',
                'payment_id' => '01J00000000000000000000010',
                'refund_id' => null,
                'external_reference' => 'TX-1',
                'statement_amount' => 5000,
                'status' => 'MATCHED',
                'note' => null,
            ],
            [
                'line_id' => '01J00000000000000000000002',
                'payment_id' => '01J00000000000000000000010',
                'refund_id' => null,
                'external_reference' => 'TX-2',
                'statement_amount' => 5000,
                'status' => 'MATCHED',
                'note' => null,
            ],
        ], new FieldErrors);
    }

    public function test_ligne_matched_sans_piece_interne_est_refusee(): void
    {
        $this->expectException(BusinessError::class);
        PaymentReconciliationRules::assertLines([[
            'line_id' => '01J00000000000000000000001',
            'payment_id' => null,
            'refund_id' => null,
            'external_reference' => 'FRAIS-MOMO',
            'statement_amount' => -250,
            'status' => 'MATCHED',
            'note' => 'Frais opérateur',
        ]], new FieldErrors);
    }

    public function test_ligne_unmatched_pour_frais_operateur_est_acceptee(): void
    {
        $lines = PaymentReconciliationRules::assertLines([[
            'line_id' => '01J00000000000000000000001',
            'payment_id' => null,
            'refund_id' => null,
            'external_reference' => 'FRAIS-MOMO-OCT',
            'statement_amount' => -300,
            'status' => 'UNMATCHED',
            'note' => 'Frais opérateur MTN MoMo',
        ]], new FieldErrors);

        $this->assertCount(1, $lines);
        $this->assertSame(-300, $lines[0]['statement_amount']);
        $this->assertSame('UNMATCHED', $lines[0]['status']);
    }

    public function test_ecart_non_nul_exige_un_motif_a_la_validation(): void
    {
        $this->assertNull(PaymentReconciliationRules::assertVarianceReason(10000, 10000, null));
        $this->assertSame('Frais prélevés', PaymentReconciliationRules::assertVarianceReason(10000, 9700, '  Frais prélevés  '));

        $this->expectException(BusinessError::class);
        PaymentReconciliationRules::assertVarianceReason(10000, 9700, 'ok');
    }
}
