<?php

namespace App\Support\Integrations\Kommo;

/**
 * Double déterministe du connecteur Kommo CRM en mode `fake` (`config('eeo.integrations.mode') === 'fake'`).
 * Ne renvoie et n'accepte que des informations commerciales et administratives sans appel réseau.
 */
final class FakeKommoClient implements KommoClientInterface
{
    /** @var list<array{external_lead_id: string, status: string, pipeline_stage: ?string, note: ?string}> */
    private array $pushedUpdates = [];

    /** @var list<array{external_lead_id: string, note: string}> */
    private array $addedNotes = [];

    public function fetchLeads(array $accountConfig, int $limit = 50): array
    {
        $limit = max(1, min(200, $limit));

        $configured = $accountConfig['fake_leads'] ?? null;
        if (is_array($configured)) {
            $out = [];
            foreach (array_slice(array_values($configured), 0, $limit) as $item) {
                if (! is_array($item)) {
                    continue;
                }
                $prospect = is_array($item['prospect'] ?? null) ? $item['prospect'] : [];
                $extLeadId = (string) ($item['external_lead_id'] ?? 'kommo-lead-custom');
                $out[] = [
                    'external_lead_id' => $extLeadId,
                    'external_conversation_id' => isset($item['external_conversation_id']) ? (string) $item['external_conversation_id'] : 'kommo-conv-'.$extLeadId,
                    'channel' => isset($item['channel']) ? (string) $item['channel'] : 'WHATSAPP',
                    'prospect' => [
                        'external_contact_id' => isset($prospect['external_contact_id']) ? (string) $prospect['external_contact_id'] : null,
                        'name' => (string) ($prospect['name'] ?? 'Prospect Kommo'),
                        'phone' => isset($prospect['phone']) ? (string) $prospect['phone'] : null,
                        'email' => isset($prospect['email']) ? (string) $prospect['email'] : null,
                    ],
                    'pipeline_id' => isset($item['pipeline_id']) ? (string) $item['pipeline_id'] : 'pipe-optique-1',
                    'pipeline_stage' => (string) ($item['pipeline_stage'] ?? 'QUALIFICATION'),
                    'product_interest' => isset($item['product_interest']) ? (string) $item['product_interest'] : null,
                    'budget_min' => isset($item['budget_min']) && is_int($item['budget_min']) ? $item['budget_min'] : null,
                    'budget_max' => isset($item['budget_max']) && is_int($item['budget_max']) ? $item['budget_max'] : null,
                    'acquisition_source' => isset($item['acquisition_source']) ? (string) $item['acquisition_source'] : 'WHATSAPP',
                    'status' => (string) ($item['status'] ?? 'OPEN'),
                    'etag' => isset($item['etag']) ? (string) $item['etag'] : 'etag-'.$extLeadId,
                ];
            }

            return $out;
        }

        $accountKey = is_string($accountConfig['external_account_id'] ?? null) && $accountConfig['external_account_id'] !== ''
            ? $accountConfig['external_account_id']
            : 'demo';

        $defaults = [
            [
                'external_lead_id' => 'kommo-lead-'.$accountKey.'-1001',
                'external_conversation_id' => 'kommo-conv-'.$accountKey.'-1001',
                'channel' => 'WHATSAPP',
                'prospect' => [
                    'external_contact_id' => 'kommo-contact-1001',
                    'name' => 'Amina Njoya',
                    'phone' => '+237690112233',
                    'email' => 'amina.njoya@example.invalid',
                ],
                'pipeline_id' => 'pipe-optique-1',
                'pipeline_stage' => 'QUALIFICATION',
                'product_interest' => 'Montures optiques et informations horaires',
                'budget_min' => 45000,
                'budget_max' => 120000,
                'acquisition_source' => 'WHATSAPP',
                'status' => 'OPEN',
                'etag' => 'etag-'.$accountKey.'-1001-v1',
            ],
            [
                'external_lead_id' => 'kommo-lead-'.$accountKey.'-1002',
                'external_conversation_id' => 'kommo-conv-'.$accountKey.'-1002',
                'channel' => 'MESSENGER',
                'prospect' => [
                    'external_contact_id' => 'kommo-contact-1002',
                    'name' => 'Brice Mbarga',
                    'phone' => '+237677445566',
                    'email' => null,
                ],
                'pipeline_id' => 'pipe-optique-1',
                'pipeline_stage' => 'PROPOSITION_RDV',
                'product_interest' => 'Solaires polarisées',
                'budget_min' => 30000,
                'budget_max' => 80000,
                'acquisition_source' => 'MESSENGER',
                'status' => 'OPEN',
                'etag' => 'etag-'.$accountKey.'-1002-v1',
            ],
        ];

        return array_slice($defaults, 0, $limit);
    }

    public function pushBookingStatus(
        array $accountConfig,
        string $externalLeadId,
        string $status,
        ?string $pipelineStage = null,
        ?string $note = null,
    ): array {
        $this->pushedUpdates[] = [
            'external_lead_id' => $externalLeadId,
            'status' => $status,
            'pipeline_stage' => $pipelineStage,
            'note' => $note,
        ];

        if ($note !== null && $note !== '') {
            $this->addAdministrativeNote($accountConfig, $externalLeadId, $note);
        }

        return [
            'external_lead_id' => $externalLeadId,
            'etag' => 'etag-sync-'.substr(sha1($externalLeadId.'|'.$status.'|'.($pipelineStage ?? '')), 0, 12),
            'synced' => true,
        ];
    }

    public function addAdministrativeNote(array $accountConfig, string $externalLeadId, string $note): array
    {
        $this->addedNotes[] = [
            'external_lead_id' => $externalLeadId,
            'note' => $note,
        ];

        return [
            'external_note_id' => 'kommo-note-'.count($this->addedNotes),
            'synced' => true,
        ];
    }

    /**
     * @return list<array{external_lead_id: string, status: string, pipeline_stage: ?string, note: ?string}>
     */
    public function recordedUpdates(): array
    {
        return $this->pushedUpdates;
    }

    /**
     * @return list<array{external_lead_id: string, note: string}>
     */
    public function recordedNotes(): array
    {
        return $this->addedNotes;
    }
}
