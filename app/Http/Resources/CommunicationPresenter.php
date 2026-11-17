<?php

declare(strict_types=1);

namespace App\Http\Resources;

use Carbon\CarbonImmutable;
use stdClass;

/**
 * Mise en forme des ressources Communication & Campagnes (L2D06-L2D08) selon `contracts/schemas/resources/communication.json`.
 * Aucune destination en clair ni donnée clinique n'est jamais exposée.
 */
final class CommunicationPresenter
{
    /**
     * @return array<string, mixed>
     */
    public static function consent(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'patient_id' => $row->patient_id !== null ? (string) $row->patient_id : null,
            'prospect_contact_id' => $row->prospect_contact_id !== null ? (string) $row->prospect_contact_id : null,
            'channel' => (string) $row->channel,
            'purpose' => (string) $row->purpose,
            'status' => (string) $row->status,
            'destination_masked' => (string) ($row->destination_masked ?? '***'),
            'recorded_at' => self::instant((string) $row->recorded_at),
            'recorded_by' => $row->recorded_by !== null ? (string) $row->recorded_by : null,
            'proof' => $row->proof !== null ? (string) $row->proof : null,
            'policy_version' => (string) $row->policy_version,
            'event_sequence' => (int) $row->event_sequence,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function templateVersion(stdClass $row): array
    {
        $decodedVars = is_string($row->allowed_variables ?? null)
            ? json_decode($row->allowed_variables, true)
            : ($row->allowed_variables ?? []);
        $allowedVars = is_array($decodedVars)
            ? array_values(array_filter($decodedVars, static fn (mixed $v): bool => is_string($v)))
            : [];

        return [
            'id' => (string) $row->id,
            'template_id' => (string) $row->template_id,
            'integration_account_id' => $row->integration_account_id !== null ? (string) $row->integration_account_id : null,
            'revision_no' => (int) $row->revision_no,
            'provider_template_id' => $row->provider_template_id !== null ? (string) $row->provider_template_id : null,
            'language' => (string) $row->language,
            'body' => (string) $row->body,
            'allowed_variables' => $allowedVars,
            'provider_approval_status' => (string) $row->provider_approval_status,
            'approved_by' => $row->approved_by !== null ? (string) $row->approved_by : null,
            'approved_at' => $row->approved_at !== null ? self::instant((string) $row->approved_at) : null,
            'created_at' => self::instant((string) $row->created_at),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function template(stdClass $row): array
    {
        $versions = [];
        if (is_array($row->versions ?? null)) {
            foreach ($row->versions as $version) {
                if ($version instanceof stdClass) {
                    $versions[] = self::templateVersion($version);
                }
            }
        }

        return [
            'id' => (string) $row->id,
            'code' => (string) $row->code,
            'channel' => (string) $row->channel,
            'purpose' => (string) $row->purpose,
            'active' => (bool) $row->active,
            'version' => (int) $row->version,
            'versions' => $versions,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function reminderPolicy(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'code' => (string) $row->code,
            'label' => (string) $row->label,
            'purpose' => (string) $row->purpose,
            'channel' => (string) $row->channel,
            'offset_unit' => (string) $row->offset_unit,
            'offset_value' => (int) $row->offset_value,
            'local_send_time' => $row->local_send_time !== null ? substr((string) $row->local_send_time, 0, 8) : null,
            'active' => (bool) $row->active,
            'version' => (int) $row->version,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function messageAttempt(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'task_id' => $row->task_id !== null ? (string) $row->task_id : null,
            'campaign_recipient_id' => $row->campaign_recipient_id !== null ? (string) $row->campaign_recipient_id : null,
            'integration_account_id' => (string) $row->integration_account_id,
            'template_version_id' => $row->template_version_id !== null ? (string) $row->template_version_id : null,
            'consent_event_id' => $row->consent_event_id !== null ? (string) $row->consent_event_id : null,
            'dedupe_key' => (string) $row->dedupe_key,
            'provider_message_id' => $row->provider_message_id !== null ? (string) $row->provider_message_id : null,
            'attempt_no' => (int) $row->attempt_no,
            'status' => (string) $row->status,
            'submitted_at' => $row->submitted_at !== null ? self::instant((string) $row->submitted_at) : null,
            'delivered_at' => $row->delivered_at !== null ? self::instant((string) $row->delivered_at) : null,
            'read_at' => $row->read_at !== null ? self::instant((string) $row->read_at) : null,
            'error_code' => $row->error_code !== null ? (string) $row->error_code : null,
            'created_at' => self::instant((string) $row->created_at),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function audienceSegment(stdClass $row): array
    {
        $decoded = is_string($row->criteria ?? null)
            ? json_decode($row->criteria, true)
            : ($row->criteria ?? []);
        $criteriaObject = is_array($decoded) && $decoded !== [] ? $decoded : (object) [];

        return [
            'id' => (string) $row->id,
            'name' => (string) $row->name,
            'criteria' => $criteriaObject,
            'criteria_schema_version' => (string) $row->criteria_schema_version,
            'created_by' => (string) $row->created_by,
            'version' => (int) $row->version,
            'updated_at' => self::instant((string) $row->updated_at),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function campaignRecipient(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'campaign_id' => (string) $row->campaign_id,
            'patient_id' => $row->patient_id !== null ? (string) $row->patient_id : null,
            'prospect_contact_id' => $row->prospect_contact_id !== null ? (string) $row->prospect_contact_id : null,
            'destination_masked' => (string) ($row->destination_masked ?? '***'),
            'consent_event_id' => $row->consent_event_id !== null ? (string) $row->consent_event_id : null,
            'status' => (string) $row->status,
            'exclusion_reason' => $row->exclusion_reason !== null ? (string) $row->exclusion_reason : null,
            'consent_checked_at' => $row->consent_checked_at !== null ? self::instant((string) $row->consent_checked_at) : null,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function campaign(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'name' => (string) $row->name,
            'segment_id' => (string) $row->segment_id,
            'template_version_id' => (string) $row->template_version_id,
            'approval_id' => $row->approval_id !== null ? (string) $row->approval_id : null,
            'scheduled_at' => $row->scheduled_at !== null ? self::instant((string) $row->scheduled_at) : null,
            'status' => (string) $row->status,
            'created_by' => (string) $row->created_by,
            'target_frozen_at' => $row->target_frozen_at !== null ? self::instant((string) $row->target_frozen_at) : null,
            'eligible_count' => (int) ($row->eligible_count ?? 0),
            'excluded_count' => (int) ($row->excluded_count ?? 0),
            'delivered_count' => (int) ($row->delivered_count ?? 0),
            'failed_count' => (int) ($row->failed_count ?? 0),
            'created_at' => self::instant((string) $row->created_at),
            'updated_at' => self::instant((string) $row->updated_at),
        ];
    }

    /**
     * @param  array{campaign_id: string, total_candidates: int, eligible_count: int, excluded_count: int, sample: list<stdClass>}  $preview
     * @return array<string, mixed>
     */
    public static function campaignPreview(array $preview): array
    {
        return [
            'campaign_id' => $preview['campaign_id'],
            'total_candidates' => $preview['total_candidates'],
            'eligible_count' => $preview['eligible_count'],
            'excluded_count' => $preview['excluded_count'],
            'sample' => array_map(self::campaignRecipient(...), $preview['sample']),
        ];
    }

    private static function instant(string $dbOrIso): string
    {
        return CarbonImmutable::parse($dbOrIso, 'UTC')->utc()->format('Y-m-d\TH:i:s.v\Z');
    }
}
