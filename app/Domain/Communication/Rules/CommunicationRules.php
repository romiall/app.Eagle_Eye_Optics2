<?php

declare(strict_types=1);

namespace App\Domain\Communication\Rules;

use App\Domain\Shared\BusinessError;
use App\Domain\Shared\ValueObjects\Text;
use Carbon\CarbonImmutable;

/**
 * Règles pures de validation pour la communication, les consentements, les modèles et la segmentation.
 * Aucune arithmétique flottante, aucune E/S ni requête SQL.
 */
final class CommunicationRules
{
    public const CONSENT_CHANNELS = ['SMS', 'WHATSAPP', 'CALL', 'EMAIL'];

    public const TEMPLATE_CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL'];

    public const CONSENT_PURPOSES = ['APPOINTMENT', 'FOLLOW_UP', 'ORDER_UPDATE', 'PAYMENT_FOLLOW_UP', 'MARKETING'];

    public const REMINDER_PURPOSES = ['APPOINTMENT', 'FOLLOW_UP', 'ORDER_UPDATE', 'PAYMENT_FOLLOW_UP'];

    public const REMINDER_CHANNELS = ['INTERNAL', 'CALL', 'SMS', 'WHATSAPP'];

    public const OFFSET_UNITS = ['HOUR', 'DAY', 'MONTH'];

    public const PATIENT_ORIGINS = ['CRM', 'WEBSITE', 'WHATSAPP', 'MESSENGER', 'INSTAGRAM', 'MANUAL'];

    public const SUBJECT_TYPES = ['PATIENT', 'PROSPECT', 'BOTH'];

    public const ALLOWED_SEGMENT_KEYS = [
        'city',
        'origin',
        'appointment_count',
        'min_appointments',
        'max_appointments',
        'last_visit_days',
        'min_last_visit_days',
        'max_last_visit_days',
        'has_quote',
        'patient_or_prospect',
        'subject_type',
    ];

    /**
     * Mots-clés strictement interdits dans les variables de modèles et les critères de segmentation
     * (séparation stricte du dossier clinique : aucune pathologie, réfraction ou ordonnance).
     */
    public const FORBIDDEN_CLINICAL_TERMS = [
        'diagnosis',
        'diagnostics',
        'diagnostic',
        'refraction',
        'acuity',
        'visual_acuity',
        'prescription',
        'ordonnance',
        'complaint',
        'motif_clinique',
        'medication',
        'treatment',
        'traitement',
        'medical_history',
        'antecedents',
        'tonometry',
        'iop',
        'fundus',
        'pathology',
        'pathologie',
        'clinical_notes',
        'notes_cliniques',
        'anamnesis',
        'symptom',
        'symptome',
        'allergy',
        'allergie',
        'lens_power',
        'sphere',
        'cylinder',
        'axis',
        'addition',
        'prism',
        'ecart_pupillaire',
        'clinical',
        'clinique',
        'exam_result',
        'consultation_notes',
    ];

    public static function normalizeDestination(string $channel, string $raw): string
    {
        $trimmed = trim($raw);
        if ($trimmed === '') {
            throw BusinessError::validation(['destination' => ['La destination ne peut pas être vide.']]);
        }

        if ($channel === 'EMAIL') {
            $email = mb_strtolower($trimmed);
            if (strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
                throw BusinessError::validation(['destination' => ['Adresse e-mail invalide.']]);
            }

            return $email;
        }

        if (! in_array($channel, self::CONSENT_CHANNELS, true)) {
            throw BusinessError::validation(['channel' => ['Canal de communication inconnu.']]);
        }

        $compact = str_replace([' ', '-', '.', '(', ')'], '', $trimmed);
        if (str_starts_with($compact, '00')) {
            $compact = '+'.substr($compact, 2);
        } elseif (! str_starts_with($compact, '+') && preg_match('/^6[0-9]{8}$/', $compact) === 1) {
            $compact = '+237'.$compact;
        }

        if (preg_match('/^\+[1-9][0-9]{7,14}$/', $compact) !== 1) {
            throw BusinessError::validation([
                'destination' => ['Numéro de téléphone invalide (format international attendu, ex. +237690000000).'],
            ]);
        }

        return $compact;
    }

    public static function integrationProviderForChannel(string $channel): string
    {
        return match ($channel) {
            'SMS' => 'SMS',
            'WHATSAPP' => 'META_WHATSAPP',
            'EMAIL' => 'SMTP',
            default => throw BusinessError::validation(['channel' => ['Ce canal ne correspond pas à un fournisseur de messagerie externe.']]),
        };
    }

    /**
     * @param  array<int, mixed>  $allowedVariables
     * @return list<string>
     */
    public static function validateAllowedVariables(array $allowedVariables, string $field = 'allowed_variables'): array
    {
        $clean = [];
        $seen = [];
        foreach ($allowedVariables as $raw) {
            if (! is_string($raw)) {
                throw BusinessError::validation([$field => ['Chaque variable autorisée doit être une chaîne de caractères.']]);
            }
            $name = trim($raw);
            if (preg_match('/^[a-z][a-z0-9_]{0,63}$/', $name) !== 1) {
                throw BusinessError::validation([$field => ['Nom de variable invalide : « '.$name.' ».']]);
            }
            if (self::isClinicalTerm($name)) {
                throw BusinessError::validation([
                    $field => ['Variable clinique interdite dans les modèles de communication : « '.$name.' ».'],
                ]);
            }
            if (! isset($seen[$name])) {
                $seen[$name] = true;
                $clean[] = $name;
            }
        }

        return $clean;
    }

    /**
     * @return list<string>
     */
    public static function extractPlaceholders(string $body): array
    {
        $matches = [];
        preg_match_all('/\{\{\s*([^{}]+?)\s*\}\}/', $body, $matches);
        $names = [];
        $seen = [];
        $rawList = $matches[1];
        foreach ($rawList as $raw) {
            $name = trim($raw);
            if (! isset($seen[$name])) {
                $seen[$name] = true;
                $names[] = $name;
            }
        }

        return $names;
    }

    /**
     * @param  list<string>  $allowedVariables
     * @return list<string>
     */
    public static function validateTemplateBody(string $body, array $allowedVariables): array
    {
        $trimmed = trim($body);
        if ($trimmed === '') {
            throw BusinessError::validation(['body' => ['Le corps du modèle est obligatoire.']]);
        }

        $placeholders = self::extractPlaceholders($trimmed);
        $allowedMap = array_flip($allowedVariables);

        foreach ($placeholders as $name) {
            if (preg_match('/^[a-z][a-z0-9_]{0,63}$/', $name) !== 1) {
                throw BusinessError::validation(['body' => ['Marqueur de variable invalide : « '.$name.' ».']]);
            }
            if (self::isClinicalTerm($name)) {
                throw BusinessError::validation([
                    'body' => ['Variable clinique interdite dans un modèle de message : « '.$name.' ».'],
                ]);
            }
            if (! isset($allowedMap[$name])) {
                throw BusinessError::validation([
                    'body' => ['Variable non déclarée dans allowed_variables : « '.$name.' ».'],
                ]);
            }
        }

        return $placeholders;
    }

    /**
     * @param  list<string>  $allowedVariables
     * @param  array<array-key, mixed>  $values
     */
    public static function renderTemplate(string $body, array $allowedVariables, array $values): string
    {
        $placeholders = self::validateTemplateBody($body, $allowedVariables);
        $allowedMap = array_flip($allowedVariables);

        $normalizedValues = [];
        foreach ($values as $key => $value) {
            if (! is_string($key) || ! isset($allowedMap[$key])) {
                throw BusinessError::validation(['variables' => ['Variable non autorisée par le modèle : « '.(string) $key.' ».']]);
            }
            if (self::isClinicalTerm($key)) {
                throw BusinessError::validation(['variables' => ['Variable clinique interdite : « '.$key.' ».']]);
            }
            if ($value === null || (! is_string($value) && ! is_int($value) && ! is_bool($value))) {
                throw BusinessError::validation(['variables' => ['Valeur invalide pour la variable « '.$key.' ».']]);
            }
            $normalizedValues[$key] = is_bool($value) ? ($value ? 'oui' : 'non') : (string) $value;
        }

        foreach ($placeholders as $required) {
            if (! array_key_exists($required, $normalizedValues)) {
                throw BusinessError::validation(['variables' => ['Variable requise manquante : « '.$required.' ».']]);
            }
        }

        $rendered = preg_replace_callback(
            '/\{\{\s*([a-z][a-z0-9_]{0,63})\s*\}\}/',
            static function (array $m) use ($normalizedValues): string {
                return $normalizedValues[$m[1]] ?? $m[0];
            },
            $body,
        );

        return is_string($rendered) ? $rendered : $body;
    }

    /**
     * @param  array<array-key, mixed>  $criteria
     * @return array<string, mixed>
     */
    public static function validateSegmentCriteria(array $criteria): array
    {
        self::assertNoClinicalKeys($criteria, 'criteria');

        $allowed = array_flip(self::ALLOWED_SEGMENT_KEYS);
        $normalized = [];

        foreach ($criteria as $key => $value) {
            if (! is_string($key) || ! isset($allowed[$key])) {
                throw BusinessError::validation([
                    'criteria' => ['Critère de segmentation non autorisé : « '.(string) $key.' ».'],
                ]);
            }

            if ($value === null) {
                continue;
            }

            switch ($key) {
                case 'city':
                    if (! is_string($value) || trim($value) === '' || mb_strlen($value) > 120) {
                        throw BusinessError::validation(['criteria.city' => ['La ville doit être une chaîne non vide (120 caractères max.).']]);
                    }
                    $normalized['city'] = trim($value);
                    break;

                case 'origin':
                    if (! is_string($value) || ! in_array($value, self::PATIENT_ORIGINS, true)) {
                        throw BusinessError::validation(['criteria.origin' => ['Origine prospect inconnue.']]);
                    }
                    $normalized['origin'] = $value;
                    break;

                case 'appointment_count':
                case 'min_appointments':
                case 'max_appointments':
                case 'last_visit_days':
                case 'min_last_visit_days':
                case 'max_last_visit_days':
                    if (! is_int($value) || $value < 0 || $value > 36500) {
                        throw BusinessError::validation(['criteria.'.$key => ['Entier positif ou nul attendu (0 à 36500).']]);
                    }
                    $normalized[$key] = $value;
                    break;

                case 'has_quote':
                    if (! is_bool($value)) {
                        throw BusinessError::validation(['criteria.has_quote' => ['Booléen attendu.']]);
                    }
                    $normalized['has_quote'] = $value;
                    break;

                case 'patient_or_prospect':
                case 'subject_type':
                    if (! is_string($value) || ! in_array($value, self::SUBJECT_TYPES, true)) {
                        throw BusinessError::validation(['criteria.'.$key => ['Type de contact attendu : PATIENT, PROSPECT ou BOTH.']]);
                    }
                    $normalized[$key] = $value;
                    break;
            }
        }

        if (isset($normalized['min_appointments'], $normalized['max_appointments'])
            && $normalized['min_appointments'] > $normalized['max_appointments']) {
            throw BusinessError::validation(['criteria.max_appointments' => ['La borne maximale doit être supérieure ou égale au minimum.']]);
        }

        if (isset($normalized['min_last_visit_days'], $normalized['max_last_visit_days'])
            && $normalized['min_last_visit_days'] > $normalized['max_last_visit_days']) {
            throw BusinessError::validation(['criteria.max_last_visit_days' => ['La borne maximale de jours doit être supérieure ou égale au minimum.']]);
        }

        return $normalized;
    }

    public static function normalizeLocalSendTime(?string $time): ?string
    {
        if ($time === null) {
            return null;
        }
        $trimmed = trim($time);
        if ($trimmed === '') {
            return null;
        }
        if (preg_match('/^([01][0-9]|2[0-3]):([0-5][0-9])(:([0-5][0-9]))?$/', $trimmed, $m) !== 1) {
            throw BusinessError::validation(['local_send_time' => ['Heure locale attendue au format HH:MM ou HH:MM:SS.']]);
        }

        return strlen($trimmed) === 5 ? $trimmed.':00' : $trimmed;
    }

    public static function validateReminderOffset(string $offsetUnit, int $offsetValue): void
    {
        if (! in_array($offsetUnit, self::OFFSET_UNITS, true)) {
            throw BusinessError::validation(['offset_unit' => ['Unité de décalage attendue : HOUR, DAY ou MONTH.']]);
        }
        if ($offsetValue < -3650 || $offsetValue > 3650) {
            throw BusinessError::validation(['offset_value' => ['Le décalage doit être compris entre -3650 et 3650.']]);
        }
    }

    public static function computeDueAt(
        CarbonImmutable $referenceUtc,
        string $offsetUnit,
        int $offsetValue,
        ?string $localSendTime = null,
        string $clinicTimezone = 'Africa/Douala',
    ): CarbonImmutable {
        self::validateReminderOffset($offsetUnit, $offsetValue);
        $cleanTime = self::normalizeLocalSendTime($localSendTime);

        $local = $referenceUtc->setTimezone($clinicTimezone);
        $shifted = match ($offsetUnit) {
            'HOUR' => $local->addHours($offsetValue),
            'DAY' => $local->addDays($offsetValue),
            default => $local->addMonthsNoOverflow($offsetValue),
        };

        if ($cleanTime !== null) {
            [$hour, $minute, $second] = array_map('intval', explode(':', $cleanTime));
            $shifted = $shifted->setTime($hour, $minute, $second, 0);
        }

        return $shifted->setTimezone('UTC');
    }

    public static function requiredText(string $value, int $maxLength, string $field): string
    {
        $trimmed = Text::trim($value);
        if ($trimmed === '') {
            throw BusinessError::validation([$field => ['Ce champ est obligatoire.']]);
        }
        if (mb_strlen($trimmed) > $maxLength) {
            throw BusinessError::validation([$field => ['Longueur maximale dépassée ('.$maxLength.' caractères).']]);
        }

        return $trimmed;
    }

    public static function assertIdempotencyKey(mixed $key): string
    {
        if (! is_string($key) || preg_match('/^[A-Za-z0-9._:-]{8,128}\z/', $key) !== 1) {
            throw BusinessError::validation([
                'Idempotency-Key' => ['L\'en-tête Idempotency-Key valide (8 à 128 caractères) est obligatoire.'],
            ]);
        }

        return $key;
    }

    public static function parsePositivePage(mixed $raw): int
    {
        if ($raw === null || $raw === '') {
            return 1;
        }
        if (is_int($raw) && $raw >= 1) {
            return $raw;
        }
        if (is_string($raw) && ctype_digit($raw) && (int) $raw >= 1) {
            return (int) $raw;
        }

        throw BusinessError::validation(['page' => ['Numéro de page entier >= 1 attendu.']]);
    }

    public static function parseOptionalUlid(string $field, mixed $raw): ?string
    {
        if (! is_string($raw) || $raw === '') {
            return null;
        }
        if (preg_match('/^[0-9A-HJKMNP-TV-Z]{26}\z/', $raw) !== 1) {
            throw BusinessError::validation([$field => ['Identifiant ULID invalide.']]);
        }

        return $raw;
    }

    /**
     * @param  list<string>  $allowed
     */
    public static function parseOptionalEnum(string $field, mixed $raw, array $allowed, string $message): ?string
    {
        if (! is_string($raw) || $raw === '') {
            return null;
        }
        if (! in_array($raw, $allowed, true)) {
            throw BusinessError::validation([$field => [$message]]);
        }

        return $raw;
    }

    public static function isClinicalTerm(string $key): bool
    {
        $normalized = strtolower(trim($key));
        if ($normalized === '') {
            return false;
        }

        foreach (self::FORBIDDEN_CLINICAL_TERMS as $term) {
            if ($normalized === $term || str_contains($normalized, $term)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  array<array-key, mixed>  $data
     */
    private static function assertNoClinicalKeys(array $data, string $field): void
    {
        foreach ($data as $key => $value) {
            if (is_string($key) && self::isClinicalTerm($key)) {
                throw BusinessError::validation([
                    $field => ['Donnée ou critère clinique strictement interdit : « '.$key.' ».'],
                ]);
            }
            if (is_array($value)) {
                self::assertNoClinicalKeys($value, $field);
            }
        }
    }
}
