<?php

namespace App\Domain\Cash\Rules;

use App\Domain\Billing\Rules\FieldErrors;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\ValueObjects\Instant;
use App\Domain\Shared\ValueObjects\Money;
use App\Domain\Shared\ValueObjects\Text;
use Carbon\CarbonImmutable;

/**
 * Règles pures du rapprochement par canal de paiement (L1D06 : Mobile Money, banque, chèque, espèces).
 *
 * Sans accès base ni horloge : vérifie les bornes de période, l'unicité de cible des lignes (un paiement OU un
 * remboursement, jamais les deux, jamais en double dans le même relevé), et l'exigence d'un motif lorsque le
 * montant du relevé diffère de l'attendu serveur à la validation.
 */
final class PaymentReconciliationRules
{
    public const METHODS = ['CASH', 'MTN_MOMO', 'ORANGE_MONEY', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'];

    public const STATUSES = ['DRAFT', 'VALIDATED'];

    public const LINE_STATUSES = ['MATCHED', 'UNMATCHED', 'DISPUTED'];

    /**
     * Contrôle et convertit les bornes UTC ISO en format DATETIME(6) de MySQL (`[start, end)`).
     *
     * @return array{start_iso: string, end_iso: string, start_db: string, end_db: string}
     */
    public static function assertPeriod(mixed $startsAt, mixed $endsAt, FieldErrors $errors): array
    {
        $start = self::instant($startsAt, 'period_starts_at', $errors);
        $end = self::instant($endsAt, 'period_ends_at', $errors);
        if ($start !== null && $end !== null && $end->epochMilliseconds <= $start->epochMilliseconds) {
            $errors->add('period_ends_at', 'La fin de la période doit être postérieure à son début.');
        }
        $errors->throwIfAny();
        assert($start !== null && $end !== null);

        return [
            'start_iso' => $start->toString(),
            'end_iso' => $end->toString(),
            'start_db' => self::toDatabase($start),
            'end_db' => self::toDatabase($end),
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $rawLines
     * @return list<array{line_id: string, payment_id: ?string, refund_id: ?string, external_reference: ?string, statement_amount: int, status: string, note: ?string}>
     */
    public static function assertLines(array $rawLines, FieldErrors $errors): array
    {
        $seenPayments = [];
        $seenRefunds = [];
        $seenLineIds = [];
        $clean = [];

        foreach ($rawLines as $index => $line) {
            $prefix = 'lines.'.$index.'.';
            $lineId = (string) ($line['line_id'] ?? '');
            if ($lineId === '') {
                $errors->add($prefix.'line_id', 'Identifiant de ligne obligatoire.');
            } elseif (isset($seenLineIds[$lineId])) {
                $errors->add($prefix.'line_id', 'Deux lignes du même rapprochement ne peuvent pas porter le même identifiant.');
            }
            $seenLineIds[$lineId] = true;

            $paymentId = is_string($line['payment_id'] ?? null) && $line['payment_id'] !== '' ? $line['payment_id'] : null;
            $refundId = is_string($line['refund_id'] ?? null) && $line['refund_id'] !== '' ? $line['refund_id'] : null;
            if ($paymentId !== null && $refundId !== null) {
                $errors->add($prefix.'payment_id', 'Une ligne pointe soit un encaissement, soit un remboursement, jamais les deux.');
            }
            if ($paymentId !== null) {
                if (isset($seenPayments[$paymentId])) {
                    $errors->add($prefix.'payment_id', 'Cet encaissement est déjà pointé dans ce rapprochement.');
                }
                $seenPayments[$paymentId] = true;
            }
            if ($refundId !== null) {
                if (isset($seenRefunds[$refundId])) {
                    $errors->add($prefix.'refund_id', 'Ce remboursement est déjà pointé dans ce rapprochement.');
                }
                $seenRefunds[$refundId] = true;
            }

            $status = (string) ($line['status'] ?? '');
            if (! in_array($status, self::LINE_STATUSES, true)) {
                $errors->add($prefix.'status', 'Statut de ligne inconnu.');
            }
            if ($status === 'MATCHED' && $paymentId === null && $refundId === null) {
                $errors->add($prefix.'status', 'Une ligne pointée (MATCHED) doit référencer un encaissement ou un remboursement.');
            }

            $extRef = self::nullableTrimmed($line['external_reference'] ?? null);
            $note = self::nullableTrimmed($line['note'] ?? null);
            if ($paymentId === null && $refundId === null && $extRef === null && $note === null) {
                $errors->add($prefix.'external_reference', 'Une ligne sans pièce interne doit porter une référence externe ou une note (frais, écart).');
            }

            $statementAmount = Money::signed((int) ($line['statement_amount'] ?? 0), $prefix.'statement_amount');

            $clean[] = [
                'line_id' => $lineId,
                'payment_id' => $paymentId,
                'refund_id' => $refundId,
                'external_reference' => $extRef,
                'statement_amount' => $statementAmount,
                'status' => $status,
                'note' => $note,
            ];
        }

        $errors->throwIfAny();

        return $clean;
    }

    public static function assertVarianceReason(int $expectedAmount, int $statementAmount, mixed $rawReason): ?string
    {
        $reason = self::nullableTrimmed($rawReason);
        if ($statementAmount !== $expectedAmount && ($reason === null || mb_strlen($reason) < 3)) {
            throw BusinessError::validation([
                'variance_reason' => ['Un motif d\'écart (3 caractères au moins) est obligatoire lorsque le relevé diffère de l\'attendu serveur.'],
            ], 'Écart non motivé pour la validation du rapprochement.');
        }

        return $reason;
    }

    public static function toDatabase(Instant $instant): string
    {
        return CarbonImmutable::createFromTimestampMsUTC($instant->epochMilliseconds)->format('Y-m-d H:i:s.u');
    }

    public static function nullableTrimmed(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }
        $trimmed = Text::trim($value);

        return $trimmed === '' ? null : $trimmed;
    }

    private static function instant(mixed $value, string $field, FieldErrors $errors): ?Instant
    {
        if (! is_string($value) || $value === '') {
            $errors->add($field, 'Date UTC obligatoire.');

            return null;
        }
        try {
            return Instant::parse($value, $field);
        } catch (\Throwable $e) {
            $errors->add($field, $e->getMessage());

            return null;
        }
    }
}
