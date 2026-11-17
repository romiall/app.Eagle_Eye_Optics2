<?php

namespace App\Domain\Crm;

use App\Application\Locking\TransactionLocks;
use App\Application\TransactionRunner;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\Text;
use App\Support\Integrations\Contracts\WebhookConsumerInterface;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Consommateur de webhooks entrants vérifiés pour Kommo CRM et les canaux Meta
 * (WhatsApp, Messenger, Instagram) : crée ou met à jour de façon idempotente le prospect,
 * la piste commerciale et la conversation sans aucune donnée clinique.
 */
final class CrmWebhookConsumer implements WebhookConsumerInterface
{
    public function __construct(
        private readonly CrmMirror $mirror,
        private readonly TransactionRunner $transactions,
    ) {}

    public function supports(string $provider): bool
    {
        return in_array($provider, [
            'KOMMO',
            'META_WHATSAPP',
            'META_MESSENGER',
            'META_INSTAGRAM',
        ], true);
    }

    public function handle(string $clinicId, string $accountId, string $provider, array $payload): void
    {
        $now = CarbonImmutable::now('UTC');
        $correlationId = Ulid::generate();
        $context = CommandContext::job($clinicId, 'webhook.'.$provider, $correlationId, $now);

        if ($provider === 'KOMMO') {
            $leads = $this->normalizeKommoWebhook($payload);
            if ($leads !== []) {
                $this->mirror->upsertLeadsInContext($context, $accountId, $leads);
            }

            return;
        }

        $channel = match ($provider) {
            'META_MESSENGER' => 'MESSENGER',
            'META_INSTAGRAM' => 'INSTAGRAM',
            default => 'WHATSAPP',
        };

        $normalized = $this->normalizeMetaWebhook($payload, $channel);
        if ($normalized === null) {
            return;
        }

        $nowSql = $now->format('Y-m-d H:i:s.u');
        $extConvId = $normalized['external_conversation_id'];

        $existingConvId = DB::table('crm_conversations')
            ->where('clinic_id', $clinicId)
            ->where('integration_account_id', $accountId)
            ->where('external_conversation_id', $extConvId)
            ->value('id');

        if (is_string($existingConvId) && $existingConvId !== '') {
            $this->transactions->run(function () use ($clinicId, $existingConvId, $nowSql): void {
                $locks = new TransactionLocks($clinicId);
                $locks->clinic();
                $conv = $locks->crmConversation($existingConvId);
                if ($conv === null) {
                    return;
                }

                DB::table('crm_conversations')
                    ->where('clinic_id', $clinicId)
                    ->where('id', $existingConvId)
                    ->update([
                        'last_activity_at' => $nowSql,
                        'updated_at' => $nowSql,
                    ]);
            });

            return;
        }

        $this->mirror->upsertLeadsInContext($context, $accountId, [$normalized['lead']]);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return list<array<string, mixed>>
     */
    private function normalizeKommoWebhook(array $payload): array
    {
        $rawLeads = [];
        if (is_array($payload['leads'] ?? null)) {
            foreach (['status', 'add', 'update'] as $bucket) {
                if (is_array($payload['leads'][$bucket] ?? null)) {
                    foreach ($payload['leads'][$bucket] as $item) {
                        if (is_array($item)) {
                            $rawLeads[] = $item;
                        }
                    }
                }
            }
        } elseif (isset($payload['external_lead_id']) || isset($payload['id'])) {
            $rawLeads[] = $payload;
        }

        $out = [];
        foreach ($rawLeads as $item) {
            $extLeadId = (string) ($item['external_lead_id'] ?? $item['id'] ?? '');
            if ($extLeadId === '') {
                continue;
            }
            $prospect = is_array($item['prospect'] ?? null) ? $item['prospect'] : [];
            $out[] = [
                'external_lead_id' => $extLeadId,
                'external_conversation_id' => $item['external_conversation_id'] ?? ('kommo-conv-'.$extLeadId),
                'channel' => $item['channel'] ?? 'WHATSAPP',
                'prospect' => [
                    'external_contact_id' => $prospect['external_contact_id'] ?? null,
                    'name' => (string) ($prospect['name'] ?? ($item['name'] ?? 'Prospect Kommo')),
                    'phone' => $prospect['phone'] ?? null,
                    'email' => $prospect['email'] ?? null,
                ],
                'pipeline_id' => isset($item['pipeline_id']) ? (string) $item['pipeline_id'] : null,
                'pipeline_stage' => (string) ($item['pipeline_stage'] ?? ($item['status_id'] ?? 'OPEN')),
                'product_interest' => $item['product_interest'] ?? null,
                'budget_min' => is_int($item['budget_min'] ?? null) ? $item['budget_min'] : (is_int($item['price'] ?? null) ? $item['price'] : null),
                'budget_max' => is_int($item['budget_max'] ?? null) ? $item['budget_max'] : (is_int($item['price'] ?? null) ? $item['price'] : null),
                'acquisition_source' => $item['acquisition_source'] ?? 'KOMMO',
                'status' => $item['status'] ?? 'OPEN',
                'etag' => isset($item['updated_at']) ? (string) $item['updated_at'] : null,
            ];
        }

        return $out;
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return ?array{external_conversation_id: string, lead: array<string, mixed>}
     */
    private function normalizeMetaWebhook(array $payload, string $channel): ?array
    {
        $extConvId = is_string($payload['external_conversation_id'] ?? null)
            ? Text::trim($payload['external_conversation_id'])
            : (is_string($payload['sender_id'] ?? null) ? Text::trim($payload['sender_id']) : '');

        if ($extConvId === '') {
            return null;
        }
        $extConvId = mb_substr($extConvId, 0, 180);

        $name = is_string($payload['sender_name'] ?? null) && Text::trim($payload['sender_name']) !== ''
            ? mb_substr(Text::trim($payload['sender_name']), 0, 180)
            : 'Contact '.$channel;

        $phone = is_string($payload['sender_phone'] ?? null) ? $payload['sender_phone'] : null;

        return [
            'external_conversation_id' => $extConvId,
            'lead' => [
                'external_lead_id' => 'meta-'.$channel.'-'.$extConvId,
                'external_conversation_id' => $extConvId,
                'channel' => $channel,
                'prospect' => [
                    'external_contact_id' => is_string($payload['sender_id'] ?? null) ? $payload['sender_id'] : $extConvId,
                    'name' => $name,
                    'phone' => $phone,
                    'email' => null,
                ],
                'pipeline_id' => null,
                'pipeline_stage' => 'INBOUND_'.$channel,
                'product_interest' => null,
                'budget_min' => null,
                'budget_max' => null,
                'acquisition_source' => $channel,
                'status' => 'OPEN',
                'etag' => null,
            ],
        ];
    }
}
