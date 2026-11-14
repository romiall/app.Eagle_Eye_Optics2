<?php

namespace App\Domain\Workshop\Rules;

use App\Domain\Billing\Rules\FieldErrors;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\ValueObjects\Diopter;
use App\Domain\Shared\ValueObjects\Instant;

/**
 * Règles pures du cycle atelier optique (L1D04, EE028, AT31). Aucun float, aucun accès base ou horloge système.
 */
final class WorkshopOrderRules
{
    public const STATUSES = [
        'ORDERED',
        'RECEIVED',
        'MOUNTING',
        'QUALITY_CHECK',
        'READY',
        'DELIVERED',
        'CANCELLED',
    ];

    public const EVENT_TYPES = [
        'STATUS_CHANGE',
        'REWORK',
        'QUALITY_CHECK',
        'ADJUSTMENT',
        'CANCEL',
    ];

    public const QUALITY_RESULTS = [
        'PASSED',
        'FAILED',
        'NOT_APPLICABLE',
    ];

    public const TERMINAL_STATUSES = ['DELIVERED', 'CANCELLED'];

    /** @var array<string, list<string>> */
    private const FORWARD_TRANSITIONS = [
        'ORDERED' => ['RECEIVED'],
        'RECEIVED' => ['MOUNTING'],
        'MOUNTING' => ['QUALITY_CHECK'],
        'READY' => ['DELIVERED'],
    ];

    /**
     * Valide la progression demandée et retourne le nouvel état normalisé.
     *
     * @return array{
     *   event_type: string,
     *   new_status: string,
     *   quality_result: string,
     *   observations: ?string,
     *   increment_ready_revision: bool,
     *   requires_delivery_line: bool,
     *   sets_received_at: bool
     * }
     */
    public static function planTransition(
        string $currentStatus,
        string $eventType,
        ?string $requestedStatus,
        ?string $qualityResult,
        ?string $observations,
        ?string $deliveryLineId,
    ): array {
        if (! in_array($eventType, self::EVENT_TYPES, true)) {
            throw BusinessError::validation(['event_type' => ['Type d\'événement atelier inconnu.']]);
        }

        if (in_array($currentStatus, self::TERMINAL_STATUSES, true)) {
            throw BusinessError::stateRefused(
                'Cette commande atelier est déjà close ('.$currentStatus.') et ne peut plus évoluer.',
                $currentStatus,
            );
        }

        $cleanObservations = self::cleanOptional($observations, 4000);
        $result = $qualityResult ?? 'NOT_APPLICABLE';
        if (! in_array($result, self::QUALITY_RESULTS, true)) {
            throw BusinessError::validation(['quality_result' => ['Résultat de contrôle qualité invalide.']]);
        }

        return match ($eventType) {
            'STATUS_CHANGE' => self::planStatusChange($currentStatus, $requestedStatus, $result, $cleanObservations, $deliveryLineId),
            'QUALITY_CHECK' => self::planQualityCheck($currentStatus, $result, $cleanObservations),
            'REWORK' => self::planRework($currentStatus, $requestedStatus, $result, $cleanObservations),
            'ADJUSTMENT' => self::planAdjustment($currentStatus, $result, $cleanObservations),
            'CANCEL' => self::planCancel($currentStatus, $result, $cleanObservations),
        };
    }

    /**
     * Une commande active dont l'échéance est antérieure à maintenant est en retard.
     */
    public static function isOverdue(string $status, ?string $expectedAtIso, string $nowIso): bool
    {
        if ($expectedAtIso === null) {
            return false;
        }
        if (in_array($status, ['READY', 'DELIVERED', 'CANCELLED'], true)) {
            return false;
        }

        $expected = Instant::parse($expectedAtIso, 'expected_at');
        $now = Instant::parse($nowIso, 'now');
        if ($expected === null || $now === null) {
            return false;
        }

        return $expected->epochMilliseconds < $now->epochMilliseconds;
    }

    public static function cleanOptional(?string $value, int $maxLength): ?string
    {
        if ($value === null) {
            return null;
        }
        $trimmed = trim($value);
        if ($trimmed === '') {
            return null;
        }

        return mb_substr($trimmed, 0, $maxLength);
    }

    /**
     * @return array{
     *   event_type: string,
     *   new_status: string,
     *   quality_result: string,
     *   observations: ?string,
     *   increment_ready_revision: bool,
     *   requires_delivery_line: bool,
     *   sets_received_at: bool
     * }
     */
    private static function planStatusChange(
        string $currentStatus,
        ?string $requestedStatus,
        string $qualityResult,
        ?string $observations,
        ?string $deliveryLineId,
    ): array {
        if ($qualityResult !== 'NOT_APPLICABLE') {
            throw BusinessError::validation(['quality_result' => ['Le résultat de contrôle qualité doit être NOT_APPLICABLE pour un simple changement d\'état.']]);
        }
        if ($requestedStatus === null || $requestedStatus === '') {
            throw BusinessError::validation(['new_status' => ['Le nouvel état est obligatoire.']]);
        }
        $allowed = self::FORWARD_TRANSITIONS[$currentStatus] ?? [];
        if (! in_array($requestedStatus, $allowed, true)) {
            throw BusinessError::stateRefused(
                'Transition refusée depuis '.$currentStatus.' vers '.$requestedStatus.'.',
                $currentStatus,
            );
        }
        if ($requestedStatus === 'DELIVERED' && ($deliveryLineId === null || $deliveryLineId === '')) {
            throw BusinessError::validation([
                'delivery_line_id' => ['Une remise confirmée au patient (delivery_line_id) est obligatoire pour passer la commande à DELIVERED.'],
            ]);
        }

        return [
            'event_type' => 'STATUS_CHANGE',
            'new_status' => $requestedStatus,
            'quality_result' => 'NOT_APPLICABLE',
            'observations' => $observations,
            'increment_ready_revision' => false,
            'requires_delivery_line' => $requestedStatus === 'DELIVERED',
            'sets_received_at' => $requestedStatus === 'RECEIVED',
        ];
    }

    /**
     * @return array{
     *   event_type: string,
     *   new_status: string,
     *   quality_result: string,
     *   observations: ?string,
     *   increment_ready_revision: bool,
     *   requires_delivery_line: bool,
     *   sets_received_at: bool
     * }
     */
    private static function planQualityCheck(string $currentStatus, string $qualityResult, ?string $observations): array
    {
        if ($currentStatus !== 'QUALITY_CHECK') {
            throw BusinessError::stateRefused(
                'Le contrôle qualité exige que la commande soit au statut QUALITY_CHECK (statut actuel : '.$currentStatus.').',
                $currentStatus,
            );
        }
        if (! in_array($qualityResult, ['PASSED', 'FAILED'], true)) {
            throw BusinessError::validation(['quality_result' => ['Le contrôle qualité exige PASSED ou FAILED.']]);
        }
        if ($qualityResult === 'FAILED' && self::tooShort($observations, 3)) {
            throw BusinessError::validation(['observations' => ['Un contrôle qualité refusé exige un motif d\'au moins 3 caractères.']]);
        }

        return [
            'event_type' => 'QUALITY_CHECK',
            'new_status' => $qualityResult === 'PASSED' ? 'READY' : 'MOUNTING',
            'quality_result' => $qualityResult,
            'observations' => $observations,
            'increment_ready_revision' => $qualityResult === 'PASSED',
            'requires_delivery_line' => false,
            'sets_received_at' => false,
        ];
    }

    /**
     * @return array{
     *   event_type: string,
     *   new_status: string,
     *   quality_result: string,
     *   observations: ?string,
     *   increment_ready_revision: bool,
     *   requires_delivery_line: bool,
     *   sets_received_at: bool
     * }
     */
    private static function planRework(
        string $currentStatus,
        ?string $requestedStatus,
        string $qualityResult,
        ?string $observations,
    ): array {
        if (! in_array($currentStatus, ['RECEIVED', 'MOUNTING', 'QUALITY_CHECK', 'READY'], true)) {
            throw BusinessError::stateRefused(
                'Une reprise exige un équipement déjà reçu ou monté (statut actuel : '.$currentStatus.').',
                $currentStatus,
            );
        }
        $target = $requestedStatus ?? 'ORDERED';
        if (! in_array($target, ['ORDERED', 'MOUNTING'], true)) {
            throw BusinessError::validation(['new_status' => ['Une reprise replace la commande à ORDERED ou MOUNTING.']]);
        }
        if (self::tooShort($observations, 3)) {
            throw BusinessError::validation(['observations' => ['Une reprise exige un motif d\'au moins 3 caractères.']]);
        }
        if ($qualityResult === 'PASSED') {
            throw BusinessError::validation(['quality_result' => ['Une reprise ne peut pas porter le résultat PASSED.']]);
        }

        return [
            'event_type' => 'REWORK',
            'new_status' => $target,
            'quality_result' => $qualityResult,
            'observations' => $observations,
            'increment_ready_revision' => false,
            'requires_delivery_line' => false,
            'sets_received_at' => false,
        ];
    }

    /**
     * @return array{
     *   event_type: string,
     *   new_status: string,
     *   quality_result: string,
     *   observations: ?string,
     *   increment_ready_revision: bool,
     *   requires_delivery_line: bool,
     *   sets_received_at: bool
     * }
     */
    private static function planAdjustment(string $currentStatus, string $qualityResult, ?string $observations): array
    {
        if (self::tooShort($observations, 3)) {
            throw BusinessError::validation(['observations' => ['Un ajustement atelier exige un motif d\'au moins 3 caractères.']]);
        }
        if ($qualityResult !== 'NOT_APPLICABLE') {
            throw BusinessError::validation(['quality_result' => ['Le résultat de contrôle qualité doit être NOT_APPLICABLE pour un ajustement.']]);
        }

        return [
            'event_type' => 'ADJUSTMENT',
            'new_status' => $currentStatus,
            'quality_result' => 'NOT_APPLICABLE',
            'observations' => $observations,
            'increment_ready_revision' => false,
            'requires_delivery_line' => false,
            'sets_received_at' => false,
        ];
    }

    /**
     * @return array{
     *   event_type: string,
     *   new_status: string,
     *   quality_result: string,
     *   observations: ?string,
     *   increment_ready_revision: bool,
     *   requires_delivery_line: bool,
     *   sets_received_at: bool
     * }
     */
    private static function planCancel(string $currentStatus, string $qualityResult, ?string $observations): array
    {
        if (self::tooShort($observations, 3)) {
            throw BusinessError::validation(['observations' => ['L\'annulation d\'une commande atelier exige un motif d\'au moins 3 caractères.']]);
        }
        if ($qualityResult !== 'NOT_APPLICABLE') {
            throw BusinessError::validation(['quality_result' => ['Le résultat de contrôle qualité doit être NOT_APPLICABLE pour une annulation.']]);
        }

        return [
            'event_type' => 'CANCEL',
            'new_status' => 'CANCELLED',
            'quality_result' => 'NOT_APPLICABLE',
            'observations' => $observations,
            'increment_ready_revision' => false,
            'requires_delivery_line' => false,
            'sets_received_at' => false,
        ];
    }

    private static function tooShort(?string $text, int $min): bool
    {
        return $text === null || mb_strlen($text) < $min;
    }

    /**
     * Valide un écart pupillaire ou hauteur de montage positif (DECIMAL(6,2) > 0).
     */
    public static function validatePositiveMeasure(?string $raw, string $field, FieldErrors $errors): ?string
    {
        if ($raw === null || trim($raw) === '') {
            return null;
        }
        try {
            $parsed = Diopter::parse(trim($raw), $field);
            if ($parsed === null) {
                return null;
            }
            if ($parsed->isNegative() || $parsed->isZero()) {
                $errors->add($field, 'La mesure doit être strictement positive.');

                return null;
            }

            return $parsed->canonical();
        } catch (RuleViolation $e) {
            $errors->add($field, $e->getMessage());

            return null;
        }
    }
}
