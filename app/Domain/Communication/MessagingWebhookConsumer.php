<?php

declare(strict_types=1);

namespace App\Domain\Communication;

use App\Application\Locking\TransactionLocks;
use App\Application\TransactionRunner;
use App\Domain\Access\AuditRecorder;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\Ulid;
use App\Support\Integrations\Contracts\WebhookConsumerInterface;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Consommateur des webhooks fournisseurs de messagerie (SMS, Meta WhatsApp, SMTP) :
 * - met à jour les statuts de livraison/lecture sur `message_attempts` et `campaign_recipients` ;
 * - déclenche un opt-out (`REVOKED`) immédiat dès réception d'un mot-clé STOP / ARRÊT.
 */
final class MessagingWebhookConsumer implements WebhookConsumerInterface
{
    private const SUPPORTED_PROVIDERS = ['SMS', 'META_WHATSAPP', 'SMTP'];

    private const STOP_KEYWORDS = ['STOP', 'ARRET', 'ARRÊT', 'UNSUBSCRIBE', 'DESABONNER', 'DÉSABONNER', 'STOP ALL'];

    public function __construct(
        private readonly TransactionRunner $transactions,
        private readonly ConsentLedger $consents,
        private readonly AuditRecorder $audit,
    ) {}

    public function supports(string $provider): bool
    {
        return in_array(strtoupper($provider), self::SUPPORTED_PROVIDERS, true);
    }

    public function handle(string $clinicId, string $accountId, string $provider, array $payload): void
    {
        $normalizedProvider = strtoupper($provider);
        $channel = $this->channelForProvider($normalizedProvider);
        $now = CarbonImmutable::now('UTC');

        // 1. Traitement des mises à jour de statut de livraison / lecture (message_attempts + campaign_recipients).
        foreach ($this->extractStatusEvents($payload) as $statusEvent) {
            $providerMessageId = $statusEvent['provider_message_id'];
            $mappedStatus = $statusEvent['status'];
            $errorCode = $statusEvent['error_code'];

            $this->transactions->run(function () use ($clinicId, $accountId, $providerMessageId, $mappedStatus, $errorCode, $now): void {
                $locks = new TransactionLocks($clinicId);
                $locks->clinic();

                $attempt = DB::table('message_attempts')
                    ->where('clinic_id', $clinicId)
                    ->where('integration_account_id', $accountId)
                    ->where('provider_message_id', $providerMessageId)
                    ->first();

                if (! $attempt instanceof stdClass) {
                    return;
                }

                $attemptId = (string) $attempt->id;
                if ($attempt->campaign_recipient_id !== null) {
                    $locks->campaignRecipient((string) $attempt->campaign_recipient_id);
                }
                $lockedAttempt = $locks->messageAttempt($attemptId);
                if ($lockedAttempt === null) {
                    return;
                }

                $nowDb = $now->format('Y-m-d H:i:s.u');
                DB::table('message_attempts')
                    ->where('clinic_id', $clinicId)
                    ->where('id', $attemptId)
                    ->update([
                        'status' => $mappedStatus,
                        'delivered_at' => in_array($mappedStatus, ['DELIVERED', 'READ'], true)
                            ? ($lockedAttempt->delivered_at ?? $nowDb)
                            : $lockedAttempt->delivered_at,
                        'read_at' => $mappedStatus === 'READ'
                            ? ($lockedAttempt->read_at ?? $nowDb)
                            : $lockedAttempt->read_at,
                        'error_code' => $errorCode ?? $lockedAttempt->error_code,
                        'updated_at' => $nowDb,
                    ]);

                if ($lockedAttempt->campaign_recipient_id !== null) {
                    $recipientStatus = match ($mappedStatus) {
                        'DELIVERED', 'READ' => 'DELIVERED',
                        'FAILED' => 'FAILED',
                        default => 'SUBMITTED',
                    };
                    DB::table('campaign_recipients')
                        ->where('clinic_id', $clinicId)
                        ->where('id', (string) $lockedAttempt->campaign_recipient_id)
                        ->update([
                            'status' => $recipientStatus,
                            'updated_at' => $nowDb,
                        ]);
                }

                $this->audit->record(
                    $clinicId,
                    null,
                    'communication.webhook.delivery_status',
                    'message_attempts',
                    $attemptId,
                    null,
                    ['status' => $mappedStatus, 'error_code' => $errorCode],
                    'Webhook ('.$accountId.')',
                );
            });
        }

        // 2. Détection d'opt-out entrant (mot-clé STOP / ARRÊT).
        foreach ($this->extractInboundMessages($payload) as $inbound) {
            $normalizedText = mb_strtoupper(trim($inbound['text']));
            $firstWord = explode(' ', $normalizedText)[0];
            if (! in_array($normalizedText, self::STOP_KEYWORDS, true)
                && ! in_array($firstWord, self::STOP_KEYWORDS, true)) {
                continue;
            }

            $context = CommandContext::job(
                $clinicId,
                'webhook:'.$normalizedProvider.':STOP',
                Ulid::generate(),
                $now,
            );

            $this->consents->revokeAllForDestination(
                $context,
                $channel,
                $inbound['from'],
                'Opt-out automatique par webhook '.$normalizedProvider.' (mot-clé '.$normalizedText.')',
            );
        }
    }

    private function channelForProvider(string $provider): string
    {
        return match ($provider) {
            'META_WHATSAPP' => 'WHATSAPP',
            'SMTP' => 'EMAIL',
            default => 'SMS',
        };
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return list<array{provider_message_id: string, status: string, error_code: ?string}>
     */
    private function extractStatusEvents(array $payload): array
    {
        $events = [];

        if (is_array($payload['statuses'] ?? null)) {
            foreach ($payload['statuses'] as $entry) {
                if (! is_array($entry)) {
                    continue;
                }
                $id = $entry['id'] ?? ($entry['provider_message_id'] ?? null);
                $rawStatus = $entry['status'] ?? null;
                if (is_string($id) && $id !== '' && is_string($rawStatus)) {
                    $events[] = [
                        'provider_message_id' => $id,
                        'status' => $this->mapDeliveryStatus($rawStatus),
                        'error_code' => is_string($entry['error_code'] ?? null) ? substr($entry['error_code'], 0, 100) : null,
                    ];
                }
            }
        }

        $singleId = $payload['provider_message_id'] ?? ($payload['message_id'] ?? null);
        $singleStatus = $payload['status'] ?? null;
        if (is_string($singleId) && $singleId !== '' && is_string($singleStatus)) {
            $events[] = [
                'provider_message_id' => $singleId,
                'status' => $this->mapDeliveryStatus($singleStatus),
                'error_code' => is_string($payload['error_code'] ?? null) ? substr($payload['error_code'], 0, 100) : null,
            ];
        }

        return $events;
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return list<array{from: string, text: string}>
     */
    private function extractInboundMessages(array $payload): array
    {
        $messages = [];

        if (is_array($payload['messages'] ?? null)) {
            foreach ($payload['messages'] as $msg) {
                if (! is_array($msg)) {
                    continue;
                }
                $from = $msg['from'] ?? ($msg['sender'] ?? null);
                $text = is_array($msg['text'] ?? null)
                    ? ($msg['text']['body'] ?? null)
                    : ($msg['text'] ?? ($msg['body'] ?? null));
                if (is_string($from) && $from !== '' && is_string($text) && $text !== '') {
                    $messages[] = ['from' => $from, 'text' => $text];
                }
            }
        }

        $singleFrom = $payload['from'] ?? ($payload['sender'] ?? null);
        $singleText = $payload['text'] ?? ($payload['body'] ?? ($payload['keyword'] ?? null));
        if (is_string($singleFrom) && $singleFrom !== '' && is_string($singleText) && $singleText !== '') {
            $messages[] = ['from' => $singleFrom, 'text' => $singleText];
        }

        return $messages;
    }

    private function mapDeliveryStatus(string $raw): string
    {
        return match (strtoupper(trim($raw))) {
            'SENT', 'ACCEPTED', 'SUBMITTED', 'QUEUED' => 'SUBMITTED',
            'DELIVERED' => 'DELIVERED',
            'READ', 'SEEN' => 'READ',
            'FAILED', 'UNDELIVERED', 'REJECTED', 'BOUNCED' => 'FAILED',
            default => 'UNKNOWN',
        };
    }
}
