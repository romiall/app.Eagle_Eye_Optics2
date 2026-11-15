<?php

namespace App\Http\Resources;

use Carbon\CarbonImmutable;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use stdClass;

/**
 * Mise en forme des ressources CRM, base de connaissances et assistant borné (L2D03–L2D05)
 * selon `contracts/schemas/resources/communication.json`. Aucune donnée clinique n'y est exposée.
 */
final class CrmPresenter
{
    /**
     * @return array<string, mixed>
     */
    public static function prospect(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'name' => (string) $row->name,
            'phone' => $row->phone === null ? null : (string) $row->phone,
            'email' => $row->email === null ? null : (string) $row->email,
            'patient_id' => $row->patient_id === null ? null : (string) $row->patient_id,
            'origin' => (string) $row->origin,
            'administrative_notes' => $row->administrative_notes === null ? null : (string) $row->administrative_notes,
            'version' => (int) $row->version,
            'created_at' => self::instant((string) $row->created_at),
            'updated_at' => self::instant((string) $row->updated_at),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function lead(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'prospect_contact_id' => (string) $row->prospect_contact_id,
            'prospect_name' => $row->prospect_name === null ? null : (string) $row->prospect_name,
            'integration_account_id' => (string) $row->integration_account_id,
            'external_lead_id' => (string) $row->external_lead_id,
            'pipeline_id' => $row->pipeline_id === null ? null : (string) $row->pipeline_id,
            'pipeline_stage' => $row->pipeline_stage === null ? null : (string) $row->pipeline_stage,
            'product_interest' => $row->product_interest === null ? null : (string) $row->product_interest,
            'budget_min' => $row->budget_min === null ? null : (int) $row->budget_min,
            'budget_max' => $row->budget_max === null ? null : (int) $row->budget_max,
            'acquisition_source' => $row->acquisition_source === null ? null : (string) $row->acquisition_source,
            'assigned_to' => $row->assigned_to === null ? null : (string) $row->assigned_to,
            'status' => (string) $row->status,
            'last_synced_at' => $row->last_synced_at === null ? null : self::instant((string) $row->last_synced_at),
            'updated_at' => self::instant((string) $row->updated_at),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function conversation(stdClass $row): array
    {
        $lastActivity = $row->last_activity_at ?? $row->updated_at ?? $row->created_at;

        return [
            'id' => (string) $row->id,
            'crm_lead_id' => $row->crm_lead_id === null ? null : (string) $row->crm_lead_id,
            'integration_account_id' => (string) $row->integration_account_id,
            'external_conversation_id' => (string) $row->external_conversation_id,
            'channel' => (string) $row->channel,
            'status' => (string) $row->status,
            'human_owner_id' => $row->human_owner_id === null ? null : (string) $row->human_owner_id,
            'takeover_at' => $row->takeover_at === null ? null : self::instant((string) $row->takeover_at),
            'takeover_reason' => $row->takeover_reason === null ? null : (string) $row->takeover_reason,
            'administrative_summary' => $row->administrative_summary === null ? null : (string) $row->administrative_summary,
            'bot_resumed_at' => $row->bot_resumed_at === null ? null : self::instant((string) $row->bot_resumed_at),
            'last_activity_at' => self::instant((string) $lastActivity),
            'version' => (int) $row->version,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function knowledgeVersion(stdClass $row): array
    {
        $isPublished = $row->published_at !== null && $row->retired_at === null;

        return [
            'id' => (string) $row->id,
            'entry_id' => (string) $row->entry_id,
            'revision_no' => (int) $row->revision_no,
            'content' => (string) $row->content,
            'language' => (string) $row->language,
            'authored_by' => (string) $row->authored_by,
            'approved_by' => $row->approved_by === null ? null : (string) $row->approved_by,
            'approved_at' => $row->approved_at === null ? null : self::instant((string) $row->approved_at),
            'published_at' => $row->published_at === null ? null : self::instant((string) $row->published_at),
            'retired_at' => $row->retired_at === null ? null : self::instant((string) $row->retired_at),
            'is_published' => $isPublished,
            'created_at' => self::instant((string) $row->created_at),
        ];
    }

    /**
     * @param  array{entry: stdClass, published_version: ?stdClass, versions: list<stdClass>}  $hydrated
     * @return array<string, mixed>
     */
    public static function knowledgeEntry(array $hydrated): array
    {
        $entry = $hydrated['entry'];
        $published = $hydrated['published_version'];

        return [
            'id' => (string) $entry->id,
            'code' => (string) $entry->code,
            'title' => (string) $entry->title,
            'category' => (string) $entry->category,
            'active' => (bool) $entry->active,
            'version' => (int) $entry->version,
            'published_version' => $published === null ? null : self::knowledgeVersion($published),
            'versions' => array_map(
                static fn (stdClass $ver): array => self::knowledgeVersion($ver),
                $hydrated['versions'],
            ),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function handoff(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'conversation_id' => (string) $row->conversation_id,
            'event_type' => (string) $row->event_type,
            'actor_id' => $row->actor_id === null ? null : (string) $row->actor_id,
            'reason' => $row->reason === null ? null : (string) $row->reason,
            'administrative_summary' => $row->administrative_summary === null ? null : (string) $row->administrative_summary,
            'occurred_at' => self::instant((string) $row->occurred_at),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function assistantRun(stdClass $row): array
    {
        $versionIds = [];
        if (is_string($row->knowledge_version_ids) && $row->knowledge_version_ids !== '') {
            $decoded = json_decode($row->knowledge_version_ids, true);
            if (is_array($decoded)) {
                foreach ($decoded as $item) {
                    if (is_string($item)) {
                        $versionIds[] = $item;
                    }
                }
            }
        }

        $toolResults = [];
        if (is_string($row->sanitized_tool_results) && $row->sanitized_tool_results !== '') {
            $decoded = json_decode($row->sanitized_tool_results, false);
            if (is_array($decoded)) {
                foreach ($decoded as $item) {
                    if ($item instanceof stdClass) {
                        $toolResults[] = $item;
                    }
                }
            }
        }

        return [
            'id' => (string) $row->id,
            'conversation_id' => (string) $row->conversation_id,
            'engine_name' => (string) $row->engine_name,
            'model_name' => (string) $row->model_name,
            'rules_version' => (string) $row->rules_version,
            'started_at' => self::instant((string) $row->started_at),
            'completed_at' => $row->completed_at === null ? null : self::instant((string) $row->completed_at),
            'status' => (string) $row->status,
            'input_tokens' => $row->input_tokens === null ? null : (int) $row->input_tokens,
            'output_tokens' => $row->output_tokens === null ? null : (int) $row->output_tokens,
            'knowledge_version_ids' => $versionIds,
            'sanitized_tool_results' => $toolResults,
            'error_code' => $row->error_code === null ? null : (string) $row->error_code,
        ];
    }

    /**
     * @param  array{
     *     run: stdClass,
     *     reply: string,
     *     handoff_triggered: bool,
     *     clinical_refusal: bool,
     *     conversation_status: string,
     *     knowledge_citations: list<string>,
     *     booking_reference: ?string,
     * }  $result
     * @return array<string, mixed>
     */
    public static function assistantTurnResult(array $result): array
    {
        return [
            'run' => self::assistantRun($result['run']),
            'reply' => $result['reply'],
            'handoff_triggered' => $result['handoff_triggered'],
            'clinical_refusal' => $result['clinical_refusal'],
            'conversation_status' => $result['conversation_status'],
            'knowledge_citations' => $result['knowledge_citations'],
            'booking_reference' => $result['booking_reference'],
        ];
    }

    /**
     * @param  LengthAwarePaginator<int, stdClass>  $page
     * @return array{current_page: int, last_page: int, per_page: int, total: int}
     */
    public static function pagination(LengthAwarePaginator $page): array
    {
        return [
            'current_page' => $page->currentPage(),
            'last_page' => $page->lastPage(),
            'per_page' => $page->perPage(),
            'total' => $page->total(),
        ];
    }

    private static function instant(string $stored): string
    {
        return CarbonImmutable::parse($stored, 'UTC')->format('Y-m-d\TH:i:s.v\Z');
    }
}
