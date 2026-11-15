<?php

namespace App\Domain\Crm;

use App\Application\Locking\TransactionLocks;
use App\Application\TransactionRunner;
use App\Support\Integrations\Contracts\OutboxConsumerInterface;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Consommateur outbox CRM (L2D03 / L2D05) : répercute vers Kommo les transferts humains
 * (`HumanHandoffRequested`) et les confirmations administratives de rendez-vous sans jamais
 * transmettre d'information clinique ou médicale.
 */
final class CrmOutboxConsumer implements OutboxConsumerInterface
{
    public function __construct(
        private readonly CrmMirror $mirror,
        private readonly TransactionRunner $transactions,
    ) {}

    public function supports(string $eventType): bool
    {
        return in_array($eventType, [
            'HumanHandoffRequested',
            'PublicBookingRequested',
            'AppointmentConfirmed',
        ], true);
    }

    public function handle(stdClass $outboxRow, array $payload): void
    {
        $clinicId = (string) $outboxRow->clinic_id;
        $eventType = (string) $outboxRow->event_type;

        if ($eventType === 'HumanHandoffRequested') {
            $leadId = isset($payload['lead_id']) && is_string($payload['lead_id']) ? $payload['lead_id'] : null;
            if ($leadId === null || $leadId === '') {
                return;
            }
            $handoffType = (string) ($payload['event_type'] ?? 'REQUEST');
            $targetStatus = $handoffType === 'RESUME_BOT' ? 'OPEN' : ($handoffType === 'CLOSE' ? 'CLOSED' : 'HUMAN_TAKEOVER');
            $note = match ($handoffType) {
                'RESUME_BOT' => 'Conversation rendue à l\'assistant automatisé.',
                'CLOSE' => 'Conversation CRM clôturée.',
                default => 'Transfert vers un conseiller humain demandé.',
            };
            $this->mirror->pushLeadStatusToKommo($clinicId, $leadId, $targetStatus, null, $note);

            return;
        }

        if ($eventType === 'PublicBookingRequested') {
            $bookingId = isset($payload['booking_request_id']) && is_string($payload['booking_request_id'])
                ? $payload['booking_request_id']
                : null;
            if ($bookingId === null) {
                return;
            }
            $booking = DB::table('public_booking_requests')
                ->where('clinic_id', $clinicId)
                ->where('id', $bookingId)
                ->first(['prospect_contact_id', 'public_reference']);
            if ($booking === null) {
                return;
            }
            $leadIds = $this->leadIdsForProspect($clinicId, (string) $booking->prospect_contact_id);
            foreach ($leadIds as $leadId) {
                $this->mirror->pushLeadStatusToKommo(
                    $clinicId,
                    $leadId,
                    'APPOINTMENT_BOOKED',
                    'RDV_DEMANDE',
                    'Demande administrative de rendez-vous : '.$booking->public_reference,
                );
            }

            return;
        }

        if ($eventType === 'AppointmentConfirmed') {
            $prospectId = isset($payload['prospect_contact_id']) && is_string($payload['prospect_contact_id'])
                ? $payload['prospect_contact_id']
                : null;
            if ($prospectId === null || $prospectId === '') {
                return;
            }
            $leadIds = $this->leadIdsForProspect($clinicId, $prospectId);
            if ($leadIds === []) {
                return;
            }

            $nowSql = CarbonImmutable::now('UTC')->format('Y-m-d H:i:s.u');
            $this->transactions->run(function () use ($clinicId, $leadIds, $nowSql): void {
                $locks = new TransactionLocks($clinicId);
                $locks->clinic();
                $sorted = $leadIds;
                sort($sorted, SORT_STRING);
                foreach ($sorted as $leadId) {
                    $locks->crmLead($leadId);
                }
                DB::table('crm_leads')
                    ->where('clinic_id', $clinicId)
                    ->whereIn('id', $sorted)
                    ->where('status', 'OPEN')
                    ->update(['status' => 'APPOINTMENT_BOOKED', 'updated_at' => $nowSql]);
            });

            foreach ($leadIds as $leadId) {
                $this->mirror->pushLeadStatusToKommo(
                    $clinicId,
                    $leadId,
                    'APPOINTMENT_BOOKED',
                    'RDV_CONFIRME',
                    'Rendez-vous confirmé au cabinet.',
                );
            }
        }
    }

    /**
     * @return list<string>
     */
    private function leadIdsForProspect(string $clinicId, string $prospectId): array
    {
        return array_values(DB::table('crm_leads')
            ->where('clinic_id', $clinicId)
            ->where('prospect_contact_id', $prospectId)
            ->orderBy('id')
            ->pluck('id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all());
    }
}
