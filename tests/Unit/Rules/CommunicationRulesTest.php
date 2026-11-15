<?php

declare(strict_types=1);

namespace Tests\Unit\Rules;

use App\Domain\Communication\Rules\CommunicationRules;
use App\Domain\Shared\BusinessError;
use Carbon\CarbonImmutable;
use PHPUnit\Framework\TestCase;

final class CommunicationRulesTest extends TestCase
{
    public function test_normalizes_cameroon_phone_and_email_destinations(): void
    {
        self::assertSame('+237690001234', CommunicationRules::normalizeDestination('SMS', '690 00-12.34'));
        self::assertSame('+237690001234', CommunicationRules::normalizeDestination('WHATSAPP', '00237 690001234'));
        self::assertSame('+33612345678', CommunicationRules::normalizeDestination('SMS', '+33 6 12 34 56 78'));
        self::assertSame('patient.test@exemple.cm', CommunicationRules::normalizeDestination('EMAIL', '  Patient.Test@EXEMPLE.CM '));
    }

    public function test_rejects_invalid_phone_or_email_destinations(): void
    {
        foreach (['123', 'abc', '+237'] as $badPhone) {
            try {
                CommunicationRules::normalizeDestination('SMS', $badPhone);
                self::fail('Numéro invalide accepté : '.$badPhone);
            } catch (BusinessError $e) {
                self::assertSame(422, $e->httpStatus);
                self::assertSame('VALIDATION_FAILED', $e->errorCode);
            }
        }

        try {
            CommunicationRules::normalizeDestination('EMAIL', 'pas-un-email');
            self::fail('E-mail invalide accepté.');
        } catch (BusinessError $e) {
            self::assertSame(422, $e->httpStatus);
        }
    }

    public function test_blocks_clinical_variables_and_undeclared_placeholders(): void
    {
        $clinicalNames = [
            'diagnosis',
            'refraction',
            'visual_acuity',
            'prescription',
            'complaint',
            'medication',
            'medical_history',
        ];

        foreach ($clinicalNames as $name) {
            try {
                CommunicationRules::validateAllowedVariables([$name]);
                self::fail('Variable clinique acceptée : '.$name);
            } catch (BusinessError $e) {
                self::assertSame(422, $e->httpStatus);
                self::assertSame('VALIDATION_FAILED', $e->errorCode);
            }
        }

        try {
            CommunicationRules::validateTemplateBody('Bonjour {{first_name}}, motif {{diagnosis}}', ['first_name']);
            self::fail('Marqueur clinique accepté dans le corps.');
        } catch (BusinessError $e) {
            self::assertSame(422, $e->httpStatus);
        }

        try {
            CommunicationRules::validateTemplateBody('Bonjour {{unknown_var}}', ['first_name']);
            self::fail('Marqueur non déclaré accepté.');
        } catch (BusinessError $e) {
            self::assertSame(422, $e->httpStatus);
        }
    }

    public function test_renders_template_with_declared_non_clinical_variables(): void
    {
        $allowed = CommunicationRules::validateAllowedVariables(['first_name', 'appointment_date', 'clinic_name']);
        $rendered = CommunicationRules::renderTemplate(
            'Bonjour {{ first_name }}, rendez-vous le {{appointment_date}} chez {{clinic_name}}.',
            $allowed,
            [
                'first_name' => 'Amina',
                'appointment_date' => '23/10/2026',
                'clinic_name' => 'Eagle Eye Douala',
            ],
        );

        self::assertSame('Bonjour Amina, rendez-vous le 23/10/2026 chez Eagle Eye Douala.', $rendered);
    }

    public function test_rejects_clinical_keys_in_segment_criteria_and_validates_bounds(): void
    {
        foreach (['diagnosis', 'refraction', 'acuity', 'prescription', 'complaint', 'medication', 'medical_history'] as $badKey) {
            try {
                CommunicationRules::validateSegmentCriteria(['city' => 'Douala', $badKey => 'myopie']);
                self::fail('Critère clinique accepté : '.$badKey);
            } catch (BusinessError $e) {
                self::assertSame(422, $e->httpStatus);
            }
        }

        $clean = CommunicationRules::validateSegmentCriteria([
            'city' => ' Douala ',
            'origin' => 'WEBSITE',
            'min_appointments' => 1,
            'max_appointments' => 5,
            'last_visit_days' => 90,
            'has_quote' => true,
            'patient_or_prospect' => 'PATIENT',
        ]);

        self::assertSame('Douala', $clean['city']);
        self::assertSame(1, $clean['min_appointments']);

        try {
            CommunicationRules::validateSegmentCriteria(['min_appointments' => 5, 'max_appointments' => 2]);
            self::fail('Bornes incohérentes acceptées.');
        } catch (BusinessError $e) {
            self::assertSame(422, $e->httpStatus);
        }
    }

    public function test_computes_reminder_due_at_with_timezone_and_local_send_time(): void
    {
        // Rendez-vous le 2026-10-25 à 10:00 locale Africa/Douala (09:00 UTC) ; rappel J-1 à 18:00 locale (17:00 UTC).
        $startsUtc = CarbonImmutable::parse('2026-10-25 09:00:00', 'UTC');
        $due = CommunicationRules::computeDueAt($startsUtc, 'DAY', -1, '18:00', 'Africa/Douala');

        self::assertSame('2026-10-24T17:00:00Z', $due->format('Y-m-d\TH:i:s\Z'));
    }
}
