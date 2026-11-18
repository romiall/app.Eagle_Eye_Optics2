<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import { ApiError, NetworkUnavailable } from '@/app/api'
import { formatInstantFr } from '@/app/clinicTime'
import {
  listOutboxEvents,
  listWebhookInbox,
  newIdempotencyKey,
  processOutboxEvents,
  reconcileIntegrations,
} from '@/app/services/communication'
import ReadNotice from '@/components/feedback/ReadNotice.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextField from '@/components/form/TextField.vue'
import EmptyState from '@/components/layout/EmptyState.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import SectionCard from '@/components/layout/SectionCard.vue'
import StatusChip from '@/components/layout/StatusChip.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import PaginationControls from '@/components/ui/PaginationControls.vue'
import {
  OUTBOX_STATUS_BADGES,
  OUTBOX_STATUS_OPTIONS,
  WEBHOOK_STATUS_BADGES,
  WEBHOOK_STATUS_OPTIONS,
} from '@/domain/communication/types'
import type {
  IntegrationReconcileResult,
  OutboxBatchResult,
  OutboxEventsStatus,
  WebhookInboxStatus,
} from '@/domain/contracts/generated'
import { useServerRead } from '@/pages/today/useServerRead'

/**
 * Supervision de la boîte d'envoi (outbox), du journal des webhooks signés et du rattrapage global
 * des intégrations (L2D01 / L2D09).
 */
const router = useRouter()
const integrationsTarget = computed(() =>
  router.hasRoute('integrations') ? { name: 'integrations' } : '/parametres/integrations',
)
const communicationHomeTarget = computed(() =>
  router.hasRoute('communication') ? { name: 'communication' } : '/communication',
)

// --- Outbox ---

const outboxFilter = reactive<{
  page: number
  status: OutboxEventsStatus | null
  eventTypeInput: string
  eventType: string | null
}>({
  page: 1,
  status: null,
  eventTypeInput: '',
  eventType: null,
})

const outboxRead = useServerRead(
  () =>
    listOutboxEvents({
      page: outboxFilter.page,
      status: outboxFilter.status,
      eventType: outboxFilter.eventType,
    }),
  { isEmpty: (page) => page.data.length === 0 },
)

function changeOutboxStatus(val: string | null): void {
  outboxFilter.status = (val as OutboxEventsStatus | null) ?? null
  outboxFilter.page = 1
  void outboxRead.reload()
}

function applyOutboxFilters(): void {
  outboxFilter.eventType =
    outboxFilter.eventTypeInput.trim() !== '' ? outboxFilter.eventTypeInput.trim() : null
  outboxFilter.page = 1
  void outboxRead.reload()
}

function goOutboxPage(page: number): void {
  outboxFilter.page = page
  void outboxRead.reload()
}

const batchLimitText = ref('50')
const batchBusy = ref(false)
const batchResult = ref<OutboxBatchResult | null>(null)
const batchError = ref<string | null>(null)

async function triggerOutboxBatch(): Promise<void> {
  if (batchBusy.value) return
  batchError.value = null
  batchResult.value = null
  const limit = Number.parseInt(batchLimitText.value.trim(), 10)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    batchError.value = 'La taille du lot doit être un entier entre 1 et 200.'
    return
  }
  batchBusy.value = true
  try {
    batchResult.value = await processOutboxEvents(
      {
        limit,
        ...(outboxFilter.eventType ? { event_types: [outboxFilter.eventType] } : {}),
      },
      newIdempotencyKey(),
    )
    await outboxRead.reload()
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      batchError.value = 'Serveur injoignable : traitement du lot non confirmé.'
    } else if (failure instanceof ApiError) {
      batchError.value = failure.message
    } else {
      throw failure
    }
  } finally {
    batchBusy.value = false
  }
}

// --- Webhooks ---

const webhookFilter = reactive<{
  page: number
  status: WebhookInboxStatus | null
}>({
  page: 1,
  status: null,
})

const webhooksRead = useServerRead(
  () =>
    listWebhookInbox({
      page: webhookFilter.page,
      status: webhookFilter.status,
    }),
  { isEmpty: (page) => page.data.length === 0 },
)

function changeWebhookStatus(val: string | null): void {
  webhookFilter.status = (val as WebhookInboxStatus | null) ?? null
  webhookFilter.page = 1
  void webhooksRead.reload()
}

function goWebhookPage(page: number): void {
  webhookFilter.page = page
  void webhooksRead.reload()
}

// --- Rattrapage global ---

const reconcileBusy = ref(false)
const reconcileResult = ref<IntegrationReconcileResult | null>(null)
const reconcileError = ref<string | null>(null)

async function triggerGlobalReconcile(): Promise<void> {
  if (reconcileBusy.value) return
  reconcileError.value = null
  reconcileResult.value = null
  reconcileBusy.value = true
  try {
    const parsed = Number.parseInt(batchLimitText.value.trim(), 10)
    const limit = Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 200 ? parsed : 50
    reconcileResult.value = await reconcileIntegrations({ limit }, newIdempotencyKey())
    await Promise.all([outboxRead.reload(), webhooksRead.reload()])
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      reconcileError.value = 'Serveur injoignable : rattrapage global non confirmé.'
    } else if (failure instanceof ApiError) {
      reconcileError.value = failure.message
    } else {
      throw failure
    }
  } finally {
    reconcileBusy.value = false
  }
}
</script>

<template>
  <section aria-labelledby="titre-outbox-webhooks" class="page-stack max-w-6xl">
    <PageHeader
      title-id="titre-outbox-webhooks"
      title="Boîte d’envoi et webhooks"
      subtitle="File des événements internes outbox, journal des webhooks signés et rattrapage complet des intégrations."
      icon="send"
      eyebrow="Supervision technique"
    >
      <template #actions>
        <LinkButton :to="integrationsTarget" variant="secondary">
          Configurer les connecteurs
        </LinkButton>
        <LinkButton :to="communicationHomeTarget" variant="ghost">
          Retour Communication
        </LinkButton>
        <AppButton
          variant="primary"
          :pending="reconcileBusy"
          pending-label="Rattrapage…"
          @click="triggerGlobalReconcile"
        >
          Lancer le rattrapage global
        </AppButton>
      </template>
    </PageHeader>

    <StateMessage state="empty" title="À quoi sert cet écran ?">
      Ce journal technique suit les échanges automatiques avec les services externes (Google Agenda,
      Kommo, SMS, WhatsApp). Au quotidien, l’équipe du cabinet n’a rien à y faire ; en cas de retard
      d’envoi, la gérante peut cliquer sur « Lancer le rattrapage global ».
    </StateMessage>

    <StateMessage v-if="reconcileResult" state="success" title="Rattrapage global terminé">
      {{ reconcileResult.outbox_processed }} événement(s) outbox traité(s) ·
      {{ reconcileResult.webhooks_processed }} webhook(s) traité(s) ·
      {{ reconcileResult.attempts_reconciled }} tentative(s) rapprochée(s) ·
      {{ reconcileResult.calendar_synced }} agenda(s) synchronisé(s).
    </StateMessage>

    <StateMessage v-if="reconcileError" state="error" title="Rattrapage global impossible">
      {{ reconcileError }}
    </StateMessage>

    <SectionCard
      title="Boîte d’envoi des événements (Outbox)"
      title-id="titre-outbox"
      description="Filtrez les événements internes en attente ou en échec et déclenchez un lot de traitement."
      icon="send"
    >
      <div class="space-y-4">
        <div class="toolbar">
          <div class="min-w-44">
            <SelectField
              label="Statut outbox"
              :model-value="outboxFilter.status"
              :options="OUTBOX_STATUS_OPTIONS"
              placeholder="Tous les statuts"
              @update:model-value="changeOutboxStatus"
            />
          </div>
          <TextField
            v-model="outboxFilter.eventTypeInput"
            label="Type d’événement"
            placeholder="ex. AppointmentConfirmed"
          />
          <AppButton variant="secondary" @click="applyOutboxFilters">Filtrer</AppButton>
          <div class="w-32">
            <TextField
              v-model="batchLimitText"
              label="Taille du lot"
              inputmode="numeric"
              placeholder="50"
            />
          </div>
          <AppButton
            variant="primary"
            :pending="batchBusy"
            pending-label="Traitement…"
            @click="triggerOutboxBatch"
          >
            Traiter un lot outbox
          </AppButton>
        </div>

        <StateMessage v-if="batchResult" state="success" title="Lot outbox traité">
          {{ batchResult.processed }} traité(s) · {{ batchResult.failed }} en échec ·
          {{ batchResult.skipped }} ignoré(s).
        </StateMessage>
        <StateMessage v-if="batchError" state="error" title="Traitement de lot refusé">
          {{ batchError }}
        </StateMessage>

        <ReadNotice
          :state="outboxRead.state.value"
          :error="outboxRead.error.value"
          subject="la boîte d’envoi outbox"
          @retry="outboxRead.reload()"
        />

        <EmptyState
          v-if="outboxRead.state.value === 'empty'"
          title="Aucun événement outbox pour ce filtre"
          icon="send"
          flat
          title-as="h3"
        >
          Les événements métier émis pour les connecteurs apparaîtront ici.
        </EmptyState>

        <template v-else-if="outboxRead.data.value">
          <div class="data-table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th scope="col">Événement</th>
                  <th scope="col">Source</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Essais</th>
                  <th scope="col">Erreur / Corrélation</th>
                  <th scope="col">Création</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="event in outboxRead.data.value.data" :key="event.id">
                  <th scope="row">
                    <code>{{ event.event_type }}</code>
                    <span class="block text-xs text-muted">v{{ event.event_version }}</span>
                  </th>
                  <td>
                    {{ event.source_type }}
                    <span class="block text-xs text-muted">
                      <code>{{ event.source_id }}</code>
                    </span>
                  </td>
                  <td>
                    <StatusChip :tone="OUTBOX_STATUS_BADGES[event.status].tone">
                      {{ OUTBOX_STATUS_BADGES[event.status].label }}
                    </StatusChip>
                  </td>
                  <td>{{ event.attempt_count }}</td>
                  <td>
                    <span v-if="event.last_error_code" class="text-danger">
                      {{ event.last_error_code }}
                    </span>
                    <span v-else class="text-muted">—</span>
                    <span class="block text-xs text-muted">
                      <code>{{ event.correlation_id }}</code>
                    </span>
                  </td>
                  <td>{{ formatInstantFr(event.created_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <PaginationControls
            :current-page="outboxRead.data.value.meta.current_page"
            :last-page="outboxRead.data.value.meta.last_page"
            :total="outboxRead.data.value.meta.total"
            :busy="outboxRead.state.value === 'loading'"
            unit="événements"
            @page="goOutboxPage"
          />
        </template>
      </div>
    </SectionCard>

    <SectionCard
      title="Journal des webhooks signés"
      title-id="titre-webhooks-inbox"
      description="Notifications entrantes des fournisseurs (Meta, Google, Kommo, SMS) vérifiées par signature."
      icon="shield"
      flush
    >
      <template #actions>
        <div class="min-w-48">
          <SelectField
            label="Filtrer par statut webhook"
            :model-value="webhookFilter.status"
            :options="WEBHOOK_STATUS_OPTIONS"
            placeholder="Tous les statuts"
            @update:model-value="changeWebhookStatus"
          />
        </div>
      </template>

      <div class="px-4 pt-2 sm:px-6">
        <ReadNotice
          :state="webhooksRead.state.value"
          :error="webhooksRead.error.value"
          subject="le journal des webhooks"
          @retry="webhooksRead.reload()"
        />
      </div>

      <div v-if="webhooksRead.state.value === 'empty'" class="p-4 sm:p-6">
        <EmptyState title="Aucun webhook reçu pour ce filtre" icon="shield" flat title-as="h3">
          Les réceptions signées et leur issue de traitement apparaîtront ici.
        </EmptyState>
      </div>

      <template v-else-if="webhooksRead.data.value">
        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Clé fournisseur</th>
                <th scope="col">Statut</th>
                <th scope="col">Essais</th>
                <th scope="col">Reçu / Traité</th>
                <th scope="col">Erreur</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="hook in webhooksRead.data.value.data" :key="hook.id">
                <th scope="row">
                  <code>{{ hook.provider_event_key }}</code>
                </th>
                <td>
                  <StatusChip :tone="WEBHOOK_STATUS_BADGES[hook.status].tone">
                    {{ WEBHOOK_STATUS_BADGES[hook.status].label }}
                  </StatusChip>
                </td>
                <td>{{ hook.attempt_count }}</td>
                <td>
                  {{ formatInstantFr(hook.received_at) }}
                  <span v-if="hook.processed_at" class="block text-xs text-muted">
                    Traité le {{ formatInstantFr(hook.processed_at) }}
                  </span>
                </td>
                <td>{{ hook.last_error_code ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="p-4 sm:px-6">
          <PaginationControls
            :current-page="webhooksRead.data.value.meta.current_page"
            :last-page="webhooksRead.data.value.meta.last_page"
            :total="webhooksRead.data.value.meta.total"
            :busy="webhooksRead.state.value === 'loading'"
            unit="webhooks"
            @page="goWebhookPage"
          />
        </div>
      </template>
    </SectionCard>
  </section>
</template>
