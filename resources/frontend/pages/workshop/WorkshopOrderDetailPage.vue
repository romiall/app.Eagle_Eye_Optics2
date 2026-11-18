<script setup lang="ts">
/**
 * Fiche détaillée d'une commande atelier (L1D04) : spécifications OD/OG figées depuis la version
 * de prescription utilisée à la création, production du bon laboratoire anonymisé (PDF), actions du
 * cycle de vie (réception labo, montage, contrôle qualité conforme/non conforme, reprise, remise
 * liée à une ligne de livraison confirmée, annulation) et journal append-only.
 */
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'

import { clinicTimeZone, formatInstantFr } from '@/app/clinicTime'
import type { RenderedDocument } from '@/app/services/documents'
import type { MutationOutcome } from '@/app/services/mutations'
import { getWorkshopOrder, workshopOrderAdvancePath } from '@/app/services/workshop'
import { workshopOrderDocument } from '@/app/services/workshopDocuments'
import { canOnScreen, moduleOpenOnScreen, revalidateSession } from '@/app/session'
import DocumentPreview from '@/components/documents/DocumentPreview.vue'
import ConfirmDialog from '@/components/feedback/ConfirmDialog.vue'
import ErrorSummary, { type FieldErrorItem } from '@/components/feedback/ErrorSummary.vue'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import TextField from '@/components/form/TextField.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import SectionCard from '@/components/layout/SectionCard.vue'
import StatusChip from '@/components/layout/StatusChip.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import { formatQuantity, MISSING } from '@/documents/engine/format'
import type {
  WorkshopEventsEventType,
  WorkshopEventsQualityResult,
  WorkshopOrder,
  WorkshopOrderResponse,
  WorkshopOrdersStatus,
} from '@/domain/contracts/generated'
import { patientDisplayName } from '@/domain/patients/identity'
import {
  buildAdvanceWorkshopPayload,
  canDeliverWorkshopOrder,
  canReworkWorkshopOrder,
  isTerminalWorkshopStatus,
  nextForwardAction,
  WORKSHOP_EVENT_LABELS,
  WORKSHOP_QUALITY_LABELS,
  WORKSHOP_STATUS_LABELS,
} from '@/domain/workshop/orders'
import CommandFailure from '@/pages/purchasing/CommandFailure.vue'
import { takeSalesFlash } from '@/pages/sales/flash'
import SalesReadMessage from '@/pages/sales/SalesReadMessage.vue'
import { useStockCommand } from '@/pages/stock/useStockCommand'
import { useServerRead } from '@/pages/today/useServerRead'

import { WORKSHOP_STATUS_TONES, workshopEyeDisplayRows } from './presentation'

const route = useRoute()
const timeZone = clinicTimeZone()
const command = useStockCommand('')
const { mutation } = command
const saving = computed(() => mutation.state.value === 'saving')

const orderId = computed(() => String(route.params['id'] ?? ''))
const read = useServerRead(() => getWorkshopOrder(orderId.value))
const order = shallowRef<WorkshopOrder | null>(null)
const notice = ref<string | null>(takeSalesFlash())

watch(
  () => read.data.value,
  (next) => {
    if (next !== null && next.id === orderId.value) {
      order.value = next
      labReferenceInput.value = next.lab_reference ?? ''
      if (next.eligible_delivery_lines.length === 1) {
        selectedDeliveryLineId.value = next.eligible_delivery_lines[0]?.delivery_line_id ?? null
      } else if (
        selectedDeliveryLineId.value !== null &&
        !next.eligible_delivery_lines.some(
          (line) => line.delivery_line_id === selectedDeliveryLineId.value,
        )
      ) {
        selectedDeliveryLineId.value = null
      }
    }
  },
  { immediate: true },
)

watch(orderId, () => {
  order.value = null
  renderedDoc.value = null
  docNotice.value = null
  docError.value = null
  actionErrors.value = {}
  void read.reload()
})

const summaryBox = ref<{ focus: () => Promise<void> } | null>(null)
const actionErrors = ref<Record<string, string>>({})
const ACTION_FIELD_IDS = {
  observations: 'atelier-action-observations',
  quality_fail_observations: 'atelier-qc-observations',
  rework_target: 'atelier-reprise-cible',
  rework_observations: 'atelier-reprise-observations',
  delivery_line_id: 'atelier-remise-ligne',
  lab_reference: 'atelier-action-ref-labo',
  general: 'atelier-action-observations',
} as const

const qcObservations = ref('')
const reworkTarget = ref<'ORDERED' | 'MOUNTING'>('MOUNTING')
const reworkObservations = ref('')
const selectedDeliveryLineId = ref<string | null>(null)
const deliveryObservations = ref('')
const labReferenceInput = ref('')
const noteObservations = ref('')
const cancelObservations = ref('')
const askingCancel = ref(false)

const renderedDoc = shallowRef<RenderedDocument | null>(null)
const docBusy = ref(false)
const docError = ref<string | null>(null)
const docNotice = ref<string | null>(null)

const errorList = computed<FieldErrorItem[]>(() =>
  Object.entries(actionErrors.value).map(([field, message]) => ({
    fieldId: ACTION_FIELD_IDS[field as keyof typeof ACTION_FIELD_IDS] ?? 'atelier-action-ref-labo',
    message,
  })),
)

const orderedEvents = computed(() =>
  order.value === null ? [] : [...order.value.events].sort((a, b) => a.sequence_no - b.sequence_no),
)

const deliveryOptions = computed(() =>
  (order.value?.eligible_delivery_lines ?? []).map((candidate) => {
    const lot = candidate.batch_number ? ` · lot ${candidate.batch_number}` : ''
    return {
      value: candidate.delivery_line_id,
      label: `${candidate.item_name} · ${formatQuantity(candidate.quantity)}${lot} · remise du ${formatInstantFr(candidate.delivered_at)}`,
    }
  }),
)

const REWORK_OPTIONS = [
  { value: 'MOUNTING', label: 'Reprise en montage atelier' },
  { value: 'ORDERED', label: 'Retour au laboratoire (nouvelle attente de réception)' },
] as const

const nextAction = computed(() =>
  order.value === null ? null : nextForwardAction(order.value.status),
)
const prescriptionTarget = computed(() => {
  const current = order.value
  if (current === null) return null
  if (current.prescription.origin === 'EXTERNAL') {
    return canOnScreen('clinical.read') && moduleOpenOnScreen('consultations')
      ? { name: 'patient-prescriptions' as const, params: { id: current.patient_id } }
      : null
  }
  return canOnScreen('patient.read') && moduleOpenOnScreen('patients')
    ? {
        name: 'patient-activite' as const,
        params: { id: current.patient_id },
        query: { section: 'PRESCRIPTIONS' },
      }
    : null
})

function reload(): void {
  void read.reload()
}

function clearActionErrors(): void {
  actionErrors.value = {}
}

async function generatePdf(): Promise<void> {
  const current = order.value
  if (current === null || docBusy.value) return
  docBusy.value = true
  docError.value = null
  docNotice.value = null
  try {
    const outcome = await workshopOrderDocument(current)
    renderedDoc.value = outcome.document
    docNotice.value = outcome.deposited
      ? 'Bon laboratoire anonymisé généré et archivé sur le serveur.'
      : 'Aperçu du bon laboratoire anonymisé prêt.'
    if (outcome.deposited && current.document?.document_status !== 'READY') {
      void read.reload()
    }
  } catch (error) {
    docError.value =
      error instanceof Error
        ? `Le bon laboratoire n’a pas pu être généré : ${error.message}`
        : 'Le bon laboratoire n’a pas pu être généré.'
  } finally {
    docBusy.value = false
  }
}

function mapServerErrors(): void {
  const mapped: Record<string, string> = {}
  for (const [field, message] of Object.entries(command.fields.value)) {
    mapped[field] = message
  }
  if (Object.keys(mapped).length === 0 && command.message.value !== null) {
    mapped['general'] = command.message.value
  }
  actionErrors.value = mapped
}

async function handleOutcome(outcome: MutationOutcome, successLabel: string): Promise<void> {
  switch (outcome.kind) {
    case 'synced': {
      const updated = (outcome.result as WorkshopOrderResponse).data
      order.value = updated
      actionErrors.value = {}
      notice.value = successLabel
      qcObservations.value = ''
      reworkObservations.value = ''
      deliveryObservations.value = ''
      noteObservations.value = ''
      cancelObservations.value = ''
      askingCancel.value = false
      if (updated.eligible_delivery_lines.length === 1) {
        selectedDeliveryLineId.value = updated.eligible_delivery_lines[0]?.delivery_line_id ?? null
      }
      return
    }
    case 'refused':
    case 'conflict':
      mapServerErrors()
      askingCancel.value = false
      await summaryBox.value?.focus()
      return
    case 'session-expired':
      askingCancel.value = false
      void revalidateSession().catch(() => undefined)
      return
    default:
      askingCancel.value = false
      return
  }
}

async function sendAdvance(
  input: {
    eventType: WorkshopEventsEventType
    newStatus?: WorkshopOrdersStatus | null
    qualityResult?: WorkshopEventsQualityResult | null
    observations?: string | null
    deliveryLineId?: string | null
    labReference?: string | null
  },
  successLabel: string,
): Promise<void> {
  const current = order.value
  if (current === null || saving.value) return
  notice.value = null
  clearActionErrors()
  const payload = buildAdvanceWorkshopPayload({
    orderId: current.id,
    ...input,
  })
  await handleOutcome(
    await command.send({
      name: 'AdvanceWorkshopOrder',
      route: {
        method: 'POST',
        path: workshopOrderAdvancePath(current.id),
        expectedVersion: 'entity',
      },
      payload: payload as unknown as Record<string, unknown>,
      expectedVersion: current.version,
    }),
    successLabel,
  )
}

async function runNextForward(): Promise<void> {
  const action = nextAction.value
  if (action === null) return
  await sendAdvance(
    { eventType: 'STATUS_CHANGE', newStatus: action.target, qualityResult: 'NOT_APPLICABLE' },
    `Étape mise à jour : ${WORKSHOP_STATUS_LABELS[action.target]}.`,
  )
}

async function passQualityCheck(): Promise<void> {
  await sendAdvance(
    {
      eventType: 'QUALITY_CHECK',
      newStatus: 'READY',
      qualityResult: 'PASSED',
      observations: qcObservations.value,
    },
    'Contrôle qualité validé : la monture est prête à remettre au patient.',
  )
}

async function failQualityCheck(): Promise<void> {
  if (qcObservations.value.trim() === '') {
    actionErrors.value = {
      quality_fail_observations:
        'Indiquez le motif de non-conformité avant de renvoyer en montage.',
    }
    await summaryBox.value?.focus()
    return
  }
  await sendAdvance(
    {
      eventType: 'QUALITY_CHECK',
      newStatus: 'MOUNTING',
      qualityResult: 'FAILED',
      observations: qcObservations.value,
    },
    'Non-conformité enregistrée : commande retournée en montage.',
  )
}

async function submitRework(): Promise<void> {
  if (reworkObservations.value.trim() === '') {
    actionErrors.value = {
      rework_observations: 'Précisez le motif de la reprise atelier ou laboratoire.',
    }
    await summaryBox.value?.focus()
    return
  }
  await sendAdvance(
    {
      eventType: 'REWORK',
      newStatus: reworkTarget.value,
      qualityResult: 'NOT_APPLICABLE',
      observations: reworkObservations.value,
    },
    `Reprise enregistrée : retour vers « ${WORKSHOP_STATUS_LABELS[reworkTarget.value]} ».`,
  )
}

async function confirmDelivery(): Promise<void> {
  if (selectedDeliveryLineId.value === null) {
    actionErrors.value = {
      delivery_line_id: 'Sélectionnez la ligne de remise physique confirmée à rattacher.',
    }
    await summaryBox.value?.focus()
    return
  }
  await sendAdvance(
    {
      eventType: 'STATUS_CHANGE',
      newStatus: 'DELIVERED',
      qualityResult: 'NOT_APPLICABLE',
      deliveryLineId: selectedDeliveryLineId.value,
      observations: deliveryObservations.value,
    },
    'Remise au patient enregistrée et reliée à la livraison.',
  )
}

async function submitAdjustment(): Promise<void> {
  const current = order.value
  if (current === null) return
  const trimmedRef = labReferenceInput.value.trim()
  const refChanged = (trimmedRef === '' ? null : trimmedRef) !== current.lab_reference
  if (!refChanged && noteObservations.value.trim() === '') {
    actionErrors.value = {
      observations: 'Saisissez une observation ou modifiez la référence laboratoire.',
    }
    await summaryBox.value?.focus()
    return
  }
  await sendAdvance(
    {
      eventType: 'ADJUSTMENT',
      newStatus: null,
      qualityResult: 'NOT_APPLICABLE',
      observations: noteObservations.value,
      labReference: trimmedRef === '' ? null : trimmedRef,
    },
    'Note / référence laboratoire enregistrée.',
  )
}

async function confirmCancel(): Promise<void> {
  await sendAdvance(
    {
      eventType: 'CANCEL',
      newStatus: 'CANCELLED',
      qualityResult: 'NOT_APPLICABLE',
      observations: cancelObservations.value,
    },
    'Commande atelier annulée.',
  )
}

async function retryAction(): Promise<void> {
  await handleOutcome(await command.retry(), 'Commande atelier mise à jour.')
}
</script>

<template>
  <section aria-labelledby="titre-detail-atelier" class="space-y-6">
    <template v-if="order !== null">
      <PageHeader
        title-id="titre-detail-atelier"
        eyebrow="Atelier optique"
        :title="`Commande ${order.reference}`"
        :subtitle="`Facture ${order.invoice_number} · ${order.invoice_line_description}`"
        icon="workshop"
        :back="{ to: { name: 'workshop' }, label: 'Retour à l’atelier' }"
      >
        <div class="flex flex-wrap items-center gap-2 pt-1">
          <StatusChip :tone="WORKSHOP_STATUS_TONES[order.status]">
            {{ WORKSHOP_STATUS_LABELS[order.status] }}
          </StatusChip>
          <StatusChip v-if="order.is_overdue" tone="danger" icon="warning">En retard</StatusChip>
          <StatusChip v-if="order.ready_revision > 1" tone="gold">
            Prête révision {{ order.ready_revision }}
          </StatusChip>
        </div>
        <template #actions>
          <AppButton
            variant="secondary"
            :pending="docBusy"
            pending-label="Préparation du PDF…"
            @click="generatePdf"
          >
            Bon laboratoire (PDF)
          </AppButton>
        </template>
      </PageHeader>

      <StateMessage v-if="notice" state="success" title="Mise à jour enregistrée">
        {{ notice }}
      </StateMessage>

      <ErrorSummary ref="summaryBox" :errors="errorList" />

      <CommandFailure
        :state="mutation.state.value"
        :message="command.message.value"
        :failure-message="mutation.failureMessage.value"
        :saving="saving"
        @retry="retryAction"
      />

      <SectionCard
        title="Informations de suivi"
        title-id="titre-atelier-resume"
        description="Données rattachées à la commande (aucun prix affiché ; le bon laboratoire n'exporte que le code dossier)."
      >
        <dl class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt class="text-sm text-muted">Patient</dt>
            <dd class="font-semibold text-ink">
              <RouterLink
                :to="{ name: 'patient', params: { id: order.patient_id } }"
                class="text-primary hover:underline"
              >
                {{ patientDisplayName(order.patient.last_name, order.patient.first_names) }}
              </RouterLink>
              <span class="block text-sm font-normal text-muted">
                Dossier {{ order.patient.record_number }}
              </span>
            </dd>
          </div>

          <div>
            <dt class="text-sm text-muted">Laboratoire</dt>
            <dd class="font-semibold text-ink">
              {{ order.supplier.name }}
              <span class="block text-sm font-normal text-muted">
                {{ order.supplier.reference }}
                <template v-if="order.supplier.phone"> · {{ order.supplier.phone }}</template>
              </span>
            </dd>
          </div>

          <div>
            <dt class="text-sm text-muted">Pièce facturée &amp; quantité</dt>
            <dd class="font-semibold text-ink">
              <RouterLink
                :to="{ name: 'facture', params: { id: order.invoice_id } }"
                class="text-primary hover:underline"
              >
                Facture {{ order.invoice_number }}
              </RouterLink>
              <span class="block text-sm font-normal text-muted">
                Quantité : {{ formatQuantity(order.quantity) }}
              </span>
            </dd>
          </div>

          <div>
            <dt class="text-sm text-muted">Monture</dt>
            <dd class="text-ink">
              <template v-if="order.frame">
                <strong>{{ order.frame.name }}</strong> ({{ order.frame.reference }})
              </template>
              <template v-if="order.frame_reference">
                <span class="block text-sm text-muted">Mention : {{ order.frame_reference }}</span>
              </template>
              <span v-if="!order.frame && !order.frame_reference" class="text-muted">
                {{ MISSING }}
              </span>
            </dd>
          </div>

          <div>
            <dt class="text-sm text-muted">Dates</dt>
            <dd class="text-sm text-ink">
              Commandée : {{ formatInstantFr(order.ordered_at) }}
              <span class="block text-muted">
                Échéance :
                {{ order.expected_at ? formatInstantFr(order.expected_at) : MISSING }}
              </span>
              <span v-if="order.received_at" class="block text-muted">
                Reçue : {{ formatInstantFr(order.received_at) }}
              </span>
            </dd>
          </div>

          <div>
            <dt class="text-sm text-muted">Référence laboratoire &amp; version</dt>
            <dd class="text-sm text-ink">
              Réf. labo : {{ order.lab_reference ?? MISSING }}
              <span class="block text-muted">Version serveur : v{{ order.version }}</span>
            </dd>
          </div>
        </dl>
        <p v-if="order.notes" class="mt-4 rounded-lg bg-canvas p-3 text-sm text-ink">
          <strong>Instructions techniques :</strong> {{ order.notes }}
        </p>
      </SectionCard>

      <SectionCard
        title="Paramètres optiques figés"
        title-id="titre-atelier-mesures"
        :description="`Issus de la version v${order.prescription_version_no} de l’ordonnance (validée le ${formatInstantFr(order.prescription.validated_at)}).`"
        flush
      >
        <template v-if="prescriptionTarget" #actions>
          <LinkButton :to="prescriptionTarget" variant="secondary">
            Voir les ordonnances du patient
          </LinkButton>
        </template>
        <div class="overflow-x-auto px-4 py-3 sm:px-6">
          <table class="min-w-full border-collapse text-sm">
            <thead>
              <tr class="border-b border-line text-left text-muted">
                <th class="py-2 pr-3 font-medium">Œil</th>
                <th class="py-2 pr-3 font-medium">Sphère</th>
                <th class="py-2 pr-3 font-medium">Cylindre</th>
                <th class="py-2 pr-3 font-medium">Axe</th>
                <th class="py-2 pr-3 font-medium">Add.</th>
                <th class="py-2 pr-3 font-medium">DP</th>
                <th class="py-2 pr-3 font-medium">Hauteur</th>
                <th class="py-2 font-medium">Verres &amp; traitements</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in workshopEyeDisplayRows(order.eyes)"
                :key="row.eye"
                class="border-b border-line/60 last:border-b-0"
              >
                <td class="py-2 pr-3 font-semibold text-ink">{{ row.eye }}</td>
                <td class="py-2 pr-3 tabular-nums">{{ row.sphere }}</td>
                <td class="py-2 pr-3 tabular-nums">{{ row.cylinder }}</td>
                <td class="py-2 pr-3 tabular-nums">{{ row.axis }}</td>
                <td class="py-2 pr-3 tabular-nums">{{ row.addition }}</td>
                <td class="py-2 pr-3 tabular-nums">{{ row.pd }}</td>
                <td class="py-2 pr-3 tabular-nums">{{ row.fittingHeight }}</td>
                <td class="py-2 text-ink">{{ row.extra }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="Bon laboratoire anonymisé (PDF)"
        title-id="titre-atelier-bon-labo"
        description="Document destiné au sous-traitant optique : identifié uniquement par le code dossier patient, sans nom ni prix."
      >
        <div class="space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <StatusChip v-if="order.document?.document_status === 'READY'" tone="success">
              Original archivé sur le serveur
            </StatusChip>
            <StatusChip v-else tone="gold">Original en attente de génération / dépôt</StatusChip>

            <AppButton
              variant="primary"
              :pending="docBusy"
              pending-label="Génération du PDF…"
              @click="generatePdf"
            >
              Générer et afficher le bon laboratoire
            </AppButton>
          </div>

          <StateMessage v-if="docNotice" state="success" title="Bon laboratoire prêt">
            {{ docNotice }}
          </StateMessage>
          <StateMessage v-if="docError" state="error" title="Génération impossible">
            {{ docError }}
          </StateMessage>
          <DocumentPreview
            v-if="renderedDoc"
            :document="renderedDoc"
            heading="Aperçu du bon laboratoire"
          />
        </div>
      </SectionCard>

      <SectionCard
        v-if="!isTerminalWorkshopStatus(order.status)"
        title="Actions sur la commande"
        title-id="titre-atelier-actions"
      >
        <div class="space-y-6">
          <div v-if="nextAction" class="rounded-xl border border-line bg-canvas p-4">
            <p class="mb-3 text-base font-semibold text-ink">Étape suivante</p>
            <AppButton
              variant="primary"
              :pending="saving"
              pending-label="Enregistrement…"
              @click="runNextForward"
            >
              {{ nextAction.label }}
            </AppButton>
          </div>

          <div
            v-if="order.status === 'QUALITY_CHECK'"
            class="space-y-4 rounded-xl border border-line bg-canvas p-4"
          >
            <p class="text-base font-semibold text-ink">Verdict du contrôle qualité</p>
            <TextAreaField
              v-model="qcObservations"
              :control-id="ACTION_FIELD_IDS.quality_fail_observations"
              label="Observations du contrôle qualité (obligatoires si non conforme)"
              :rows="2"
              :error="actionErrors.quality_fail_observations ?? actionErrors.observations ?? null"
            />
            <div class="flex flex-wrap gap-3">
              <AppButton
                variant="primary"
                :pending="saving"
                pending-label="Validation…"
                @click="passQualityCheck"
              >
                Valider : conforme (prête)
              </AppButton>
              <AppButton
                variant="secondary"
                :pending="saving"
                pending-label="Renvoi en montage…"
                @click="failQualityCheck"
              >
                Non conforme : renvoyer en montage
              </AppButton>
            </div>
          </div>

          <div
            v-if="order.status === 'READY'"
            class="space-y-4 rounded-xl border border-line bg-canvas p-4"
          >
            <p class="text-base font-semibold text-ink">Clôture : remise au patient</p>
            <template v-if="canDeliverWorkshopOrder(order)">
              <SelectField
                v-model="selectedDeliveryLineId"
                :control-id="ACTION_FIELD_IDS.delivery_line_id"
                label="Ligne de remise physique confirmée (sur la facture)"
                placeholder="Choisir la remise physique correspondante…"
                required
                :options="deliveryOptions"
                :error="actionErrors.delivery_line_id ?? null"
                @update:model-value="clearActionErrors()"
              />
              <TextAreaField
                v-model="deliveryObservations"
                control-id="atelier-remise-observations"
                label="Commentaire de remise (optionnel)"
                :rows="2"
              />
              <AppButton
                variant="primary"
                :pending="saving"
                pending-label="Clôture…"
                @click="confirmDelivery"
              >
                Confirmer la remise au patient
              </AppButton>
            </template>
            <StateMessage v-else state="offline" title="Remise physique attendue avant clôture">
              Aucune remise confirmée sur cette ligne de facture. Confirmez d’abord la remise au
              patient depuis la fiche facture avant de clôturer la commande atelier.
              <template #action>
                <LinkButton
                  :to="{ name: 'facture', params: { id: order.invoice_id } }"
                  variant="secondary"
                >
                  Ouvrir la facture {{ order.invoice_number }}
                </LinkButton>
              </template>
            </StateMessage>
          </div>

          <div
            v-if="canReworkWorkshopOrder(order.status)"
            class="space-y-4 rounded-xl border border-line bg-canvas p-4"
          >
            <p class="text-base font-semibold text-ink">
              Déclarer une reprise atelier / laboratoire
            </p>
            <div class="grid gap-4 sm:grid-cols-2">
              <SelectField
                :control-id="ACTION_FIELD_IDS.rework_target"
                label="Étape de reprise"
                required
                :model-value="reworkTarget"
                :options="REWORK_OPTIONS"
                @update:model-value="
                  reworkTarget = ($event as 'ORDERED' | 'MOUNTING') ?? 'MOUNTING'
                "
              />
            </div>
            <TextAreaField
              v-model="reworkObservations"
              :control-id="ACTION_FIELD_IDS.rework_observations"
              label="Motif de la reprise"
              required
              :rows="2"
              :error="actionErrors.rework_observations ?? null"
            />
            <AppButton
              variant="secondary"
              :pending="saving"
              pending-label="Enregistrement…"
              @click="submitRework"
            >
              Enregistrer la reprise
            </AppButton>
          </div>

          <div class="space-y-4 rounded-xl border border-line bg-canvas p-4">
            <p class="text-base font-semibold text-ink">Note ou référence laboratoire</p>
            <div class="grid gap-4 sm:grid-cols-2">
              <TextField
                v-model="labReferenceInput"
                :control-id="ACTION_FIELD_IDS.lab_reference"
                label="Référence dossier chez le laboratoire"
                :maxlength="100"
                :error="actionErrors.lab_reference ?? null"
              />
            </div>
            <TextAreaField
              v-model="noteObservations"
              :control-id="ACTION_FIELD_IDS.observations"
              label="Observation à consigner au journal"
              :rows="2"
              :error="actionErrors.observations ?? null"
            />
            <AppButton
              variant="secondary"
              :pending="saving"
              pending-label="Enregistrement…"
              @click="submitAdjustment"
            >
              Consigner au journal
            </AppButton>
          </div>

          <div class="space-y-3 rounded-xl border border-danger/40 bg-danger-soft/40 p-4">
            <p class="text-base font-semibold text-danger">Annuler la commande atelier</p>
            <TextAreaField
              v-model="cancelObservations"
              control-id="atelier-annulation-motif"
              label="Motif d’annulation (optionnel)"
              :rows="2"
            />
            <AppButton variant="danger" @click="askingCancel = true">
              Annuler cette commande
            </AppButton>
          </div>
        </div>
      </SectionCard>

      <StateMessage v-else state="empty" :title="WORKSHOP_STATUS_LABELS[order.status]">
        Cette commande est dans un état final ({{ WORKSHOP_STATUS_LABELS[order.status] }}) et ne
        peut plus avancer.
      </StateMessage>

      <SectionCard
        title="Journal d’exécution (immuable)"
        title-id="titre-atelier-journal"
        description="Historique chronologique append-only de chaque action effectuée sur cette commande."
      >
        <ol class="space-y-3" aria-label="Historique de la commande atelier">
          <li
            v-for="event in orderedEvents"
            :key="event.id"
            class="rounded-xl border border-line bg-canvas p-3.5 text-sm"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="font-semibold text-ink">
                #{{ event.sequence_no }} · {{ WORKSHOP_EVENT_LABELS[event.event_type] }}
                <template v-if="event.new_status">
                  → {{ WORKSHOP_STATUS_LABELS[event.new_status] }}
                </template>
              </span>
              <span class="text-muted">{{ formatInstantFr(event.occurred_at) }}</span>
            </div>
            <p v-if="event.quality_result !== 'NOT_APPLICABLE'" class="mt-1 font-medium text-ink">
              Contrôle : {{ WORKSHOP_QUALITY_LABELS[event.quality_result] }}
            </p>
            <p v-if="event.observations" class="mt-1 text-ink">{{ event.observations }}</p>
            <p class="mt-1 text-muted">Par {{ event.actor_name ?? event.actor_id }}</p>
          </li>
        </ol>
      </SectionCard>

      <ConfirmDialog
        :open="askingCancel"
        tone="danger"
        title="Annuler cette commande atelier ?"
        confirm-label="Confirmer l’annulation"
        pending-label="Annulation en cours…"
        :pending="saving"
        @confirm="confirmCancel"
        @cancel="askingCancel = false"
      >
        L’annulation est définitive dans le journal de la commande {{ order.reference }}. La ligne
        de facture retrouvera son reliquat disponible si une nouvelle commande reste nécessaire.
      </ConfirmDialog>

      <FreshnessNote
        v-if="read.freshness.value"
        :freshness="read.freshness.value"
        :time-zone="timeZone"
      />
    </template>

    <template v-else>
      <PageHeader
        title-id="titre-detail-atelier"
        eyebrow="Atelier optique"
        title="Commande atelier"
        icon="workshop"
        :back="{ to: { name: 'workshop' }, label: 'Retour à l’atelier' }"
      />
      <SalesReadMessage
        :state="read.state.value"
        subject="la commande atelier"
        :error="read.error.value"
        not-found-title="Commande atelier introuvable"
        @retry="reload"
      />
    </template>
  </section>
</template>
