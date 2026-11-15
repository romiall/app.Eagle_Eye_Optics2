<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import { ApiError, NetworkUnavailable } from '@/app/api'
import { formatInstantFr } from '@/app/clinicTime'
import {
  getCrmConversation,
  listAssistantRuns,
  listConversationHandoffs,
  listCrmConversations,
  newIdempotencyKey,
  requestHumanHandoff,
  resumeConversationBot,
  runAssistantTurn,
} from '@/app/services/communication'
import ReadNotice from '@/components/feedback/ReadNotice.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import CheckboxField from '@/components/form/CheckboxField.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import TextField from '@/components/form/TextField.vue'
import EmptyState from '@/components/layout/EmptyState.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import SectionCard from '@/components/layout/SectionCard.vue'
import StatusChip from '@/components/layout/StatusChip.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import PaginationControls from '@/components/ui/PaginationControls.vue'
import {
  ASSISTANT_RUN_STATUS_BADGES,
  CONVERSATION_STATUS_BADGES,
  CONVERSATION_STATUS_OPTIONS,
  CRM_CHANNEL_LABELS,
  HANDOFF_EVENT_BADGES,
} from '@/domain/communication/types'
import type {
  AssistantRun,
  AssistantTurnResult,
  ConversationHandoff,
  CrmConversation,
  CrmConversationsStatus,
} from '@/domain/contracts/generated'
import { useServerRead } from '@/pages/today/useServerRead'

/**
 * File des conversations CRM, simulateur / exécuteur borné de l'assistant (avec refus clinique
 * et citations sourcées), bascule vers un conseiller humain et reprise de l'assistant.
 */
const router = useRouter()
const communicationHomeTarget = computed(() =>
  router.hasRoute('communication') ? { name: 'communication' } : '/communication',
)

const statusFilter = ref<CrmConversationsStatus | null>(null)
const currentPage = ref(1)

const conversationsRead = useServerRead(
  () => listCrmConversations({ page: currentPage.value, status: statusFilter.value }),
  { isEmpty: (page) => page.data.length === 0 },
)

const selectedConversation = ref<CrmConversation | null>(null)
const handoffs = ref<ConversationHandoff[]>([])
const assistantRuns = ref<AssistantRun[]>([])
const detailLoading = ref(false)
const detailError = ref<string | null>(null)

function changeStatusFilter(next: string | null): void {
  statusFilter.value = (next as CrmConversationsStatus | null) ?? null
  currentPage.value = 1
  void conversationsRead.reload()
}

function goPage(page: number): void {
  currentPage.value = page
  void conversationsRead.reload()
}

async function loadConversationDetails(conversation: CrmConversation): Promise<void> {
  selectedConversation.value = conversation
  detailLoading.value = true
  detailError.value = null
  try {
    const [detailOutcome, handoffsOutcome, runsOutcome] = await Promise.all([
      getCrmConversation(conversation.id),
      listConversationHandoffs(conversation.id),
      listAssistantRuns(conversation.id),
    ])
    selectedConversation.value = detailOutcome.data
    handoffs.value = handoffsOutcome.data
    assistantRuns.value = runsOutcome.data
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      detailError.value = 'Serveur injoignable : historique de conversation non chargé.'
    } else if (failure instanceof ApiError) {
      detailError.value = failure.message
    } else {
      throw failure
    }
  } finally {
    detailLoading.value = false
  }
}

async function selectConversation(conversation: CrmConversation): Promise<void> {
  turnResult.value = null
  turnError.value = null
  handoffError.value = null
  handoffSuccess.value = null
  await loadConversationDetails(conversation)
}

async function refreshSelectedConversation(): Promise<void> {
  await conversationsRead.reload()
  if (selectedConversation.value) {
    await loadConversationDetails(selectedConversation.value)
  }
}

// --- Tour borné d'assistant ---

const turnForm = reactive({
  message: '',
  serviceId: '',
  preferredStartsAt: '',
})
const turnRunning = ref(false)
const turnError = ref<string | null>(null)
const turnResult = ref<AssistantTurnResult | null>(null)

async function submitAssistantTurn(): Promise<void> {
  if (!selectedConversation.value || turnRunning.value) return
  turnError.value = null
  turnResult.value = null
  if (turnForm.message.trim() === '') {
    turnError.value = 'Saisissez le message à soumettre à l’assistant.'
    return
  }

  turnRunning.value = true
  try {
    const result = await runAssistantTurn(
      selectedConversation.value.id,
      {
        message: turnForm.message.trim(),
        service_id: turnForm.serviceId.trim() !== '' ? turnForm.serviceId.trim() : null,
        preferred_starts_at:
          turnForm.preferredStartsAt.trim() !== '' ? turnForm.preferredStartsAt.trim() : null,
      },
      newIdempotencyKey(),
    )
    turnResult.value = result
    turnForm.message = ''
    await refreshSelectedConversation()
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      turnError.value = 'Serveur injoignable : tour d’assistant non exécuté.'
    } else if (failure instanceof ApiError) {
      turnError.value = failure.message
    } else {
      throw failure
    }
  } finally {
    turnRunning.value = false
  }
}

// --- Bascule humaine / reprise assistant ---

const handoffForm = reactive({
  reason: '',
  administrativeSummary: '',
  assignToSelf: true,
})
const resumeReason = ref('')
const handoffBusy = ref(false)
const handoffError = ref<string | null>(null)
const handoffSuccess = ref<string | null>(null)

async function submitTakeover(): Promise<void> {
  if (!selectedConversation.value || handoffBusy.value) return
  handoffError.value = null
  handoffSuccess.value = null
  if (handoffForm.reason.trim().length < 3) {
    handoffError.value = 'Saisissez un motif de bascule (3 caractères au moins).'
    return
  }

  handoffBusy.value = true
  try {
    const updated = await requestHumanHandoff(
      selectedConversation.value.id,
      {
        reason: handoffForm.reason.trim(),
        administrative_summary:
          handoffForm.administrativeSummary.trim() !== ''
            ? handoffForm.administrativeSummary.trim()
            : null,
        assign_to_self: handoffForm.assignToSelf,
      },
      newIdempotencyKey(),
    )
    selectedConversation.value = updated
    handoffForm.reason = ''
    handoffForm.administrativeSummary = ''
    handoffSuccess.value = 'Conversation basculée vers un conseiller humain.'
    await refreshSelectedConversation()
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      handoffError.value = 'Serveur injoignable : transfert humain non confirmé.'
    } else if (failure instanceof ApiError) {
      handoffError.value = failure.message
    } else {
      throw failure
    }
  } finally {
    handoffBusy.value = false
  }
}

async function submitResumeBot(): Promise<void> {
  if (!selectedConversation.value || handoffBusy.value) return
  handoffError.value = null
  handoffSuccess.value = null
  handoffBusy.value = true
  try {
    const updated = await resumeConversationBot(
      selectedConversation.value.id,
      { reason: resumeReason.value.trim() !== '' ? resumeReason.value.trim() : null },
      newIdempotencyKey(),
    )
    selectedConversation.value = updated
    resumeReason.value = ''
    handoffSuccess.value = 'La conversation est de nouveau suivie par l’assistant.'
    await refreshSelectedConversation()
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      handoffError.value = 'Serveur injoignable : reprise par l’assistant non confirmée.'
    } else if (failure instanceof ApiError) {
      handoffError.value = failure.message
    } else {
      throw failure
    }
  } finally {
    handoffBusy.value = false
  }
}
</script>

<template>
  <section aria-labelledby="titre-handoffs" class="page-stack max-w-6xl">
    <PageHeader
      title-id="titre-handoffs"
      title="Assistant borné et reprises humaines"
      subtitle="Simulation et supervision des réponses sourcées sur la base publiée, avec refus clinique automatique et transfert vers un conseiller."
      icon="communication"
      eyebrow="Assistant & relais humain"
    >
      <template #actions>
        <LinkButton :to="communicationHomeTarget" variant="secondary">
          Retour Communication
        </LinkButton>
      </template>
    </PageHeader>

    <SectionCard
      title="File des conversations CRM"
      title-id="titre-file-conversations"
      description="Sélectionnez une conversation pour exécuter un tour d’assistant ou gérer le passage à un conseiller."
      icon="list"
      flush
    >
      <template #actions>
        <div class="min-w-48">
          <SelectField
            label="Filtrer par statut"
            :model-value="statusFilter"
            :options="CONVERSATION_STATUS_OPTIONS"
            placeholder="Tous les statuts"
            @update:model-value="changeStatusFilter"
          />
        </div>
      </template>

      <div class="px-4 pt-2 sm:px-6">
        <ReadNotice
          :state="conversationsRead.state.value"
          :error="conversationsRead.error.value"
          subject="la file des conversations"
          @retry="conversationsRead.reload()"
        />
      </div>

      <div v-if="conversationsRead.state.value === 'empty'" class="p-4 sm:p-6">
        <EmptyState
          title="Aucune conversation pour ce statut"
          icon="communication"
          flat
          title-as="h3"
        >
          Les conversations entrantes apparaîtront ici pour suivi ou reprise humaine.
        </EmptyState>
      </div>

      <template v-else-if="conversationsRead.data.value">
        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Canal</th>
                <th scope="col">Identifiant externe</th>
                <th scope="col">Statut</th>
                <th scope="col">Motif / résumé</th>
                <th scope="col">Activité</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="conversation in conversationsRead.data.value.data" :key="conversation.id">
                <th scope="row">{{ CRM_CHANNEL_LABELS[conversation.channel] }}</th>
                <td>
                  <code>{{ conversation.external_conversation_id }}</code>
                </td>
                <td>
                  <StatusChip :tone="CONVERSATION_STATUS_BADGES[conversation.status].tone">
                    {{ CONVERSATION_STATUS_BADGES[conversation.status].label }}
                  </StatusChip>
                </td>
                <td>
                  {{ conversation.takeover_reason ?? conversation.administrative_summary ?? '—' }}
                </td>
                <td>{{ formatInstantFr(conversation.last_activity_at) }}</td>
                <td>
                  <AppButton
                    variant="secondary"
                    :pressed="selectedConversation?.id === conversation.id"
                    @click="selectConversation(conversation)"
                  >
                    Inspecter
                  </AppButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="p-4 sm:px-6">
          <PaginationControls
            :current-page="conversationsRead.data.value.meta.current_page"
            :last-page="conversationsRead.data.value.meta.last_page"
            :total="conversationsRead.data.value.meta.total"
            :busy="conversationsRead.state.value === 'loading'"
            unit="conversations"
            @page="goPage"
          />
        </div>
      </template>
    </SectionCard>

    <template v-if="selectedConversation">
      <StateMessage v-if="detailError" state="error" title="Détail indisponible">
        {{ detailError }}
      </StateMessage>

      <SectionCard
        :title="`Console conversation (${CRM_CHANNEL_LABELS[selectedConversation.channel]})`"
        title-id="titre-console-conversation"
        description="L’assistant répond uniquement depuis les fiches publiées et refuse toute demande à caractère clinique."
        icon="shield"
      >
        <div class="space-y-5">
          <div class="flex flex-wrap items-center gap-3">
            <StatusChip :tone="CONVERSATION_STATUS_BADGES[selectedConversation.status].tone">
              {{ CONVERSATION_STATUS_BADGES[selectedConversation.status].label }}
            </StatusChip>
            <span class="text-sm text-muted">
              Référence : <code>{{ selectedConversation.external_conversation_id }}</code>
            </span>
          </div>

          <StateMessage
            v-if="handoffSuccess"
            state="success"
            title="Statut de prise en charge mis à jour"
          >
            {{ handoffSuccess }}
          </StateMessage>
          <StateMessage v-if="handoffError" state="error" title="Action de transfert refusée">
            {{ handoffError }}
          </StateMessage>

          <form
            class="space-y-4 rounded-xl border border-line bg-canvas p-4"
            novalidate
            @submit.prevent="submitAssistantTurn"
          >
            <h3 class="text-base font-semibold text-ink">Exécuter un tour borné de l’assistant</h3>
            <StateMessage v-if="turnError" state="error" title="Exécution refusée">
              {{ turnError }}
            </StateMessage>
            <div class="form-grid">
              <TextAreaField
                v-model="turnForm.message"
                class="col-span-full"
                label="Message du contact"
                hint="ex. Quels sont vos horaires le samedi ?"
                :rows="3"
                required
              />
              <TextField
                v-model="turnForm.serviceId"
                label="ULID de prestation (facultatif)"
                placeholder="01J..."
              />
              <TextField
                v-model="turnForm.preferredStartsAt"
                label="Créneau souhaité ISO UTC (facultatif)"
                placeholder="2026-11-20T09:00:00.000Z"
              />
            </div>
            <div class="form-actions">
              <AppButton
                type="submit"
                variant="primary"
                :pending="turnRunning"
                pending-label="Exécution…"
              >
                Exécuter un tour d’assistant
              </AppButton>
            </div>

            <div v-if="turnResult" class="space-y-3 rounded-xl border border-line bg-surface p-4">
              <div class="flex flex-wrap items-center gap-2">
                <StatusChip :tone="CONVERSATION_STATUS_BADGES[turnResult.conversation_status].tone">
                  {{ CONVERSATION_STATUS_BADGES[turnResult.conversation_status].label }}
                </StatusChip>
                <StatusChip v-if="turnResult.clinical_refusal" tone="danger">
                  Refus clinique déclenché
                </StatusChip>
                <StatusChip v-if="turnResult.handoff_triggered" tone="warning">
                  Relais humain demandé
                </StatusChip>
                <StatusChip v-if="turnResult.booking_reference" tone="success">
                  Réservation {{ turnResult.booking_reference }}
                </StatusChip>
              </div>
              <StateMessage
                v-if="turnResult.clinical_refusal"
                state="error"
                title="Question à caractère clinique refusée par l’assistant"
              >
                Aucune recommandation médicale ni réponse clinique n’a été émise : la demande est
                orientée vers un conseiller ou un rendez-vous au cabinet.
              </StateMessage>
              <p class="whitespace-pre-line text-base text-ink">{{ turnResult.reply }}</p>
              <div v-if="turnResult.knowledge_citations.length > 0" class="text-sm text-muted">
                Sources citées : {{ turnResult.knowledge_citations.join(', ') }}
              </div>
            </div>
          </form>

          <div
            v-if="selectedConversation.status !== 'HUMAN_TAKEOVER'"
            class="space-y-4 rounded-xl border border-line bg-canvas p-4"
          >
            <h3 class="text-base font-semibold text-ink">Basculer vers un conseiller humain</h3>
            <div class="form-grid">
              <TextField
                v-model="handoffForm.reason"
                class="col-span-full"
                label="Motif du transfert humain"
                placeholder="ex. Demande nécessitant l’accueil téléphonique"
                required
              />
              <TextAreaField
                v-model="handoffForm.administrativeSummary"
                class="col-span-full"
                label="Résumé administratif transmis au conseiller"
                :rows="2"
              />
              <CheckboxField
                v-model="handoffForm.assignToSelf"
                label="M’attribuer cette conversation"
              />
            </div>
            <div class="form-actions">
              <AppButton variant="secondary" :pending="handoffBusy" @click="submitTakeover">
                Basculer vers un conseiller humain
              </AppButton>
            </div>
          </div>

          <div v-else class="space-y-4 rounded-xl border border-line bg-canvas p-4">
            <h3 class="text-base font-semibold text-ink">Rendre la conversation à l’assistant</h3>
            <TextField
              v-model="resumeReason"
              label="Motif de reprise par l’assistant (facultatif)"
              placeholder="ex. Informations administratives transmises"
            />
            <div class="form-actions">
              <AppButton variant="primary" :pending="handoffBusy" @click="submitResumeBot">
                Rendre la main à l’assistant
              </AppButton>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Journal audité des exécutions assistant"
        title-id="titre-assistant-runs"
        description="Trace chaque exécution bornée, les versions de connaissances utilisées et les retours d’outils assainis."
        icon="history"
        flush
      >
        <div v-if="detailLoading" class="p-4 text-sm text-muted">Chargement de l’audit…</div>
        <div v-else-if="assistantRuns.length === 0" class="p-4 sm:p-6">
          <EmptyState title="Aucune exécution enregistrée" icon="history" flat title-as="h3">
            Exécutez un tour ci-dessus pour observer la trace complète.
          </EmptyState>
        </div>
        <div v-else class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Moteur / Modèle</th>
                <th scope="col">Statut</th>
                <th scope="col">Sources & outils assainis</th>
                <th scope="col">Jetons</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="run in assistantRuns" :key="run.id">
                <td>{{ formatInstantFr(run.started_at) }}</td>
                <td>
                  {{ run.engine_name }} · <code>{{ run.model_name }}</code>
                  <span class="block text-xs text-muted">Règles {{ run.rules_version }}</span>
                </td>
                <td>
                  <StatusChip :tone="ASSISTANT_RUN_STATUS_BADGES[run.status].tone">
                    {{ ASSISTANT_RUN_STATUS_BADGES[run.status].label }}
                  </StatusChip>
                  <span v-if="run.error_code" class="block text-xs text-danger">
                    {{ run.error_code }}
                  </span>
                </td>
                <td>
                  <span class="block text-xs text-muted">
                    Connaissances :
                    {{
                      run.knowledge_version_ids.length > 0
                        ? run.knowledge_version_ids.join(', ')
                        : 'aucune'
                    }}
                  </span>
                  <code v-if="run.sanitized_tool_results.length > 0" class="block text-xs">
                    {{ JSON.stringify(run.sanitized_tool_results) }}
                  </code>
                </td>
                <td>{{ run.input_tokens ?? 0 }} / {{ run.output_tokens ?? 0 }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="Historique des transferts humain / assistant"
        title-id="titre-handoffs-log"
        icon="merge"
        flush
      >
        <div v-if="handoffs.length === 0" class="p-4 sm:p-6">
          <EmptyState title="Aucun transfert enregistré" icon="merge" flat title-as="h3">
            Les passages entre l’assistant et l’équipe humaine apparaîtront ici.
          </EmptyState>
        </div>
        <div v-else class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Événement</th>
                <th scope="col">Motif</th>
                <th scope="col">Résumé administratif</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="event in handoffs" :key="event.id">
                <td>{{ formatInstantFr(event.occurred_at) }}</td>
                <td>
                  <StatusChip :tone="HANDOFF_EVENT_BADGES[event.event_type].tone">
                    {{ HANDOFF_EVENT_BADGES[event.event_type].label }}
                  </StatusChip>
                </td>
                <td>{{ event.reason ?? '—' }}</td>
                <td>{{ event.administrative_summary ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
    </template>
  </section>
</template>
