<script setup lang="ts">
/**
 * Rapprochements par canal de paiement (L1D06 : Mobile Money, banque, chèque, espèces).
 * Réservé à la gérante (`finance.reconcile`), module « sales », EN LIGNE.
 *
 * - L'attendu serveur (`vw_collection_events`) n'est jamais estimé par le poste : on charge d'abord les
 *   écritures éligibles de la période avec la fraîcheur des postes hors ligne.
 * - Un encaissement ou remboursement ne peut être pointé que dans un seul rapprochement.
 * - Le relevé justificatif (PDF, JPEG ou PNG) et la validation définitive exigent le mot de passe (423).
 * - Une fois VALIDATED, le rapprochement est figé et immuable.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'

import { ApiError, NetworkUnavailable } from '@/app/api'
import { clinicTimeZone, clinicToday, formatInstantFr } from '@/app/clinicTime'
import type { MutationOutcome } from '@/app/services/mutations'
import {
  getPaymentReconciliation,
  getPaymentReconciliationCandidates,
  listPaymentReconciliations,
  statementFileUrl,
  uploadStatementEvidence,
} from '@/app/services/reconciliations'
import { useMutation } from '@/app/services/useMutation'
import { canOnScreen, revalidateSession } from '@/app/session'
import StateMessage from '@/components/feedback/StateMessage.vue'
import DateField from '@/components/form/DateField.vue'
import MoneyField from '@/components/form/MoneyField.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import TextField from '@/components/form/TextField.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import PasswordConfirmDialog from '@/components/session/PasswordConfirmDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import PaginationControls from '@/components/ui/PaginationControls.vue'
import { paymentMethodLabel } from '@/documents/data/labels'
import { deviceStateLabel, freshnessHeadline } from '@/domain/billing/financialReport'
import { periodError } from '@/domain/reports/statistics'
import {
  candidateKey,
  civilRangeToUtcWindow,
  computeVariance,
  draftLineFromCandidate,
  draftLinesFromSaved,
  isEditableReconciliation,
  linesTotalAmount,
  manualDraftLine,
  RECONCILIATION_LINE_STATUS_LABELS,
  RECONCILIATION_METHODS,
  type ReconciliationDraftLine,
  RECONCILIATION_STATUS_LABELS,
  serializeLinesForRequest,
  validationProblem,
} from '@/domain/cash/reconciliation'
import type {
  PaymentReconciliation,
  PaymentReconciliationCandidate,
  PaymentReconciliationCandidates,
  PaymentReconciliationSummary,
  PaymentReconciliationsMethod,
  PaymentReconciliationsStatus,
  StatementEvidence,
} from '@/domain/contracts/generated'
import { CivilDate } from '@/domain/values/civilDate'
import { formatMoney } from '@/domain/values/money'
import { newUlid } from '@/domain/values/ulid'

const methodOptions = RECONCILIATION_METHODS.map((method) => ({
  value: method,
  label: paymentMethodLabel(method),
}))

const filterMethodOptions = [{ value: '', label: 'Tous les canaux' }, ...methodOptions]
const filterStatusOptions = [
  { value: '', label: 'Tous les statuts' },
  { value: 'DRAFT', label: RECONCILIATION_STATUS_LABELS.DRAFT },
  { value: 'VALIDATED', label: RECONCILIATION_STATUS_LABELS.VALIDATED },
]
const manualStatusOptions = [
  { value: 'UNMATCHED', label: RECONCILIATION_LINE_STATUS_LABELS.UNMATCHED },
  { value: 'DISPUTED', label: RECONCILIATION_LINE_STATUS_LABELS.DISPUTED },
]
const manualDirectionOptions = [
  { value: 'DEDUCT', label: 'Déduction / frais (−)' },
  { value: 'ADD', label: 'Crédit / entrée (+)' },
]

// --- Sélection période & canal ----------------------------------------------------------------------
const today = clinicToday()
const method = ref<PaymentReconciliationsMethod>('MTN_MOMO')
const fromDate = ref<string | null>(today.toString())
const toDate = ref<string | null>(today.toString())
const periodProblem = ref<string | null>(null)
const periodWindow = ref<{ startsAt: string; endsAt: string }>(
  civilRangeToUtcWindow(today, today, clinicTimeZone()),
)

// --- Brouillon ou rapprochement ouvert --------------------------------------------------------------
const activeId = ref<string | null>(null)
const loaded = shallowRef<PaymentReconciliation | null>(null)
const candidatesData = shallowRef<PaymentReconciliationCandidates | null>(null)
const candidatesLoading = ref(false)
const candidatesError = ref<string | null>(null)

const draftLines = ref<ReconciliationDraftLine[]>([])
const statementAmount = ref<number | null>(null)
const statementFile = shallowRef<StatementEvidence | null>(null)
const varianceReason = ref('')

// Ajout manuel d'écriture sans pièce interne (frais opérateur, litige)
const manualStatus = ref<string | null>('UNMATCHED')
const manualDirection = ref<string | null>('DEDUCT')
const manualAmount = ref<number | null>(null)
const manualReference = ref('')
const manualNote = ref('')
const manualError = ref<string | null>(null)

// Téléversement relevé & réauthentification (423)
const uploading = ref(false)
const uploadError = ref<string | null>(null)
const askingPassword = ref(false)
const passwordContext = ref<'mutation' | 'upload'>('mutation')

// Mutations (Save / Validate)
const mutation = useMutation()
const actionError = ref<string | null>(null)
const actionSuccess = ref<string | null>(null)
const saving = computed(() => mutation.state.value === 'saving')

const editable = computed(() => isEditableReconciliation(loaded.value))
const expectedAmount = computed<number | null>(() => {
  if (loaded.value !== null && loaded.value.status === 'VALIDATED') {
    return loaded.value.expected_amount
  }
  return candidatesData.value?.expected_amount ?? loaded.value?.expected_amount ?? null
})
const currentVariance = computed<number | null>(() => {
  if (expectedAmount.value === null) return null
  return computeVariance(expectedAmount.value, statementAmount.value)
})
const matchedLinesSum = computed(() => linesTotalAmount(draftLines.value))
const selectedKeys = computed(() => {
  const keys = new Set<string>()
  for (const line of draftLines.value) {
    if (line.paymentId !== null) keys.add(`P:${line.paymentId}`)
    else if (line.refundId !== null) keys.add(`R:${line.refundId}`)
  }
  return keys
})
const freshnessHeadlineView = computed(() =>
  candidatesData.value ? freshnessHeadline(candidatesData.value.freshness) : null,
)
const deviceNotices = computed(() => {
  const fresh = candidatesData.value?.freshness
  if (!fresh) return []
  return fresh.devices
})

// --- Historique -------------------------------------------------------------------------------------
const listLoading = ref(false)
const listError = ref<string | null>(null)
const listItems = shallowRef<PaymentReconciliationSummary[]>([])
const listMeta = ref({ current_page: 1, last_page: 1, per_page: 25, total: 0 })
const filterMethod = ref<string | null>(null)
const filterStatus = ref<string | null>(null)

const passwordAction = computed(() =>
  passwordContext.value === 'upload'
    ? 'Le dépôt du justificatif de relevé'
    : 'La validation définitive du rapprochement',
)

function parseDateSafe(raw: string | null): CivilDate | 'invalid' | null {
  try {
    return CivilDate.parse(raw)
  } catch {
    return 'invalid'
  }
}

async function loadCandidates(forReconciliationId?: string): Promise<void> {
  periodProblem.value = null
  const from = parseDateSafe(fromDate.value)
  const to = parseDateSafe(toDate.value)
  if (from === 'invalid' || to === 'invalid') {
    periodProblem.value = 'Date invalide : JJ/MM/AAAA ou AAAA-MM-JJ.'
    return
  }
  const err = periodError(from, to)
  if (err !== null || from === null || to === null) {
    periodProblem.value = err ?? 'La période est obligatoire.'
    return
  }
  const window = civilRangeToUtcWindow(from, to, clinicTimeZone())
  periodWindow.value = window
  candidatesLoading.value = true
  candidatesError.value = null
  try {
    candidatesData.value = await getPaymentReconciliationCandidates({
      method: method.value,
      periodStartsAt: window.startsAt,
      periodEndsAt: window.endsAt,
      ...(forReconciliationId ? { reconciliationId: forReconciliationId } : {}),
    })
  } catch (failure) {
    candidatesError.value =
      failure instanceof NetworkUnavailable
        ? 'Serveur indisponible : les écritures attendues n’ont pas pu être lues.'
        : failure instanceof ApiError
          ? failure.message
          : 'Impossible de charger les écritures du canal.'
  } finally {
    candidatesLoading.value = false
  }
}

async function loadList(page = 1): Promise<void> {
  listLoading.value = true
  listError.value = null
  try {
    const response = await listPaymentReconciliations({
      page,
      ...(filterMethod.value ? { method: filterMethod.value as PaymentReconciliationsMethod } : {}),
      ...(filterStatus.value ? { status: filterStatus.value as PaymentReconciliationsStatus } : {}),
    })
    listItems.value = response.data
    listMeta.value = response.meta
  } catch (failure) {
    listError.value =
      failure instanceof NetworkUnavailable
        ? 'Serveur indisponible : historique non lu.'
        : failure instanceof ApiError
          ? failure.message
          : 'Lecture de l’historique impossible.'
  } finally {
    listLoading.value = false
  }
}

async function openReconciliation(id: string): Promise<void> {
  actionError.value = null
  actionSuccess.value = null
  candidatesLoading.value = true
  candidatesError.value = null
  try {
    const rec = await getPaymentReconciliation(id)
    loaded.value = rec
    activeId.value = rec.id
    method.value = rec.method
    const tz = clinicTimeZone()
    const startCivil = CivilDate.fromEpochMilliseconds(Date.parse(rec.period_starts_at), tz)
    // Borne haute exclusive : on retire 1 ms pour obtenir le dernier jour inclus au fuseau du cabinet.
    const endCivil = CivilDate.fromEpochMilliseconds(
      Math.max(Date.parse(rec.period_starts_at), Date.parse(rec.period_ends_at) - 1),
      tz,
    )
    fromDate.value = startCivil.toString()
    toDate.value = endCivil.toString()
    periodWindow.value = { startsAt: rec.period_starts_at, endsAt: rec.period_ends_at }
    draftLines.value = draftLinesFromSaved(rec.lines)
    statementAmount.value = rec.statement_amount
    statementFile.value = rec.statement_file
    varianceReason.value = rec.variance_reason ?? ''
    if (rec.status === 'DRAFT') {
      candidatesData.value = await getPaymentReconciliationCandidates({
        method: rec.method,
        periodStartsAt: rec.period_starts_at,
        periodEndsAt: rec.period_ends_at,
        reconciliationId: rec.id,
      })
    } else {
      candidatesData.value = null
    }
  } catch (failure) {
    actionError.value =
      failure instanceof NetworkUnavailable
        ? 'Serveur indisponible.'
        : failure instanceof ApiError
          ? failure.message
          : 'Impossible d’ouvrir ce rapprochement.'
  } finally {
    candidatesLoading.value = false
  }
}

function startNew(): void {
  loaded.value = null
  activeId.value = null
  draftLines.value = []
  statementAmount.value = null
  statementFile.value = null
  varianceReason.value = ''
  actionError.value = null
  actionSuccess.value = null
  manualError.value = null
  void loadCandidates()
}

function toggleCandidate(candidate: PaymentReconciliationCandidate): void {
  if (!editable.value) return
  const key = candidateKey(candidate)
  if (selectedKeys.value.has(key)) {
    draftLines.value = draftLines.value.filter(
      (line) =>
        !(
          (candidate.payment_id !== null && line.paymentId === candidate.payment_id) ||
          (candidate.refund_id !== null && line.refundId === candidate.refund_id)
        ),
    )
    return
  }
  draftLines.value = [...draftLines.value, draftLineFromCandidate(candidate)]
}

function updateLineAmount(lineId: string, value: string): void {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === '-') return
  const parsed = Number(trimmed)
  if (!Number.isSafeInteger(parsed)) return
  draftLines.value = draftLines.value.map((line) =>
    line.lineId === lineId ? { ...line, statementAmount: parsed } : line,
  )
}

function updateLineReference(lineId: string, value: string): void {
  draftLines.value = draftLines.value.map((line) =>
    line.lineId === lineId ? { ...line, externalReference: value } : line,
  )
}

function removeLine(lineId: string): void {
  if (!editable.value) return
  draftLines.value = draftLines.value.filter((line) => line.lineId !== lineId)
}

function addManualLine(): void {
  manualError.value = null
  if (manualAmount.value === null) {
    manualError.value = 'Saisissez un montant en FCFA.'
    return
  }
  if (manualNote.value.trim().length < 2 && manualReference.value.trim() === '') {
    manualError.value = 'Précisez une référence ou une observation pour cette écriture.'
    return
  }
  const signed = manualDirection.value === 'ADD' ? manualAmount.value : -manualAmount.value
  const status = manualStatus.value === 'DISPUTED' ? 'DISPUTED' : 'UNMATCHED'
  draftLines.value = [
    ...draftLines.value,
    manualDraftLine({
      externalReference: manualReference.value,
      statementAmount: signed,
      status,
      note: manualNote.value,
    }),
  ]
  manualAmount.value = null
  manualReference.value = ''
  manualNote.value = ''
}

async function chooseStatementFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  uploadError.value = null
  if (file === null) return
  uploading.value = true
  try {
    statementFile.value = await uploadStatementEvidence(file)
  } catch (failure) {
    if (failure instanceof ApiError && failure.status === 423) {
      uploadError.value =
        'Confirmez votre mot de passe, puis choisissez de nouveau le justificatif du relevé.'
      passwordContext.value = 'upload'
      askingPassword.value = true
    } else if (failure instanceof ApiError) {
      uploadError.value = Object.values(failure.fields).flat()[0] ?? failure.message
    } else if (failure instanceof Error) {
      uploadError.value = failure.message
    } else {
      uploadError.value = 'Le relevé n’a pas pu être déposé.'
    }
  } finally {
    uploading.value = false
    input.value = ''
  }
}

function applyMutationResult(outcome: MutationOutcome): boolean {
  switch (outcome.kind) {
    case 'synced': {
      const saved = (outcome.result as { data?: PaymentReconciliation } | undefined)?.data
      if (saved) {
        loaded.value = saved
        activeId.value = saved.id
        draftLines.value = draftLinesFromSaved(saved.lines)
        statementAmount.value = saved.statement_amount
        statementFile.value = saved.statement_file
        varianceReason.value = saved.variance_reason ?? ''
      }
      return true
    }
    case 'reauthentication-required':
      passwordContext.value = 'mutation'
      askingPassword.value = true
      return false
    case 'refused':
    case 'conflict':
      actionError.value = Object.values(outcome.error.fields).flat()[0] ?? outcome.error.message
      return false
    case 'session-expired':
      void revalidateSession().catch(() => undefined)
      actionError.value = mutation.failureMessage.value
      return false
    default:
      actionError.value = mutation.failureMessage.value
      return false
  }
}

async function saveDraft(): Promise<boolean> {
  if (!editable.value || saving.value) return false
  actionError.value = null
  actionSuccess.value = null

  const id = activeId.value ?? newUlid()
  const isUpdate = activeId.value !== null
  const outcome = await mutation.submit({
    name: isUpdate ? 'UpdatePaymentReconciliation' : 'CreatePaymentReconciliation',
    route: {
      method: isUpdate ? 'PATCH' : 'POST',
      path: isUpdate
        ? `/payment-reconciliations/${encodeURIComponent(id)}`
        : '/payment-reconciliations',
      expectedVersion: 'none',
    },
    payload: {
      reconciliation_id: id,
      method: method.value,
      period_starts_at: periodWindow.value.startsAt,
      period_ends_at: periodWindow.value.endsAt,
      statement_amount: statementAmount.value,
      statement_file_id: statementFile.value?.file_id ?? null,
      variance_reason: varianceReason.value.trim() === '' ? null : varianceReason.value.trim(),
      lines: serializeLinesForRequest(draftLines.value),
    },
  })
  const ok = applyMutationResult(outcome)
  if (ok) {
    actionSuccess.value = 'Brouillon de rapprochement enregistré.'
    await loadList(listMeta.value.current_page)
  }
  return ok
}

async function validateDraft(): Promise<void> {
  if (!editable.value || saving.value) return
  actionError.value = null
  actionSuccess.value = null

  const currentExpected = expectedAmount.value ?? 0
  const problem = validationProblem({
    statementAmount: statementAmount.value,
    expectedAmount: currentExpected,
    varianceReason: varianceReason.value,
  })
  if (problem !== null) {
    actionError.value = problem
    return
  }

  // Enregistre ou met à jour le brouillon d'abord afin que le serveur ait toutes les lignes à jour avant la validation.
  const draftOk = await saveDraft()
  if (!draftOk || activeId.value === null) return

  actionSuccess.value = null
  const outcome = await mutation.submit({
    name: 'ValidatePaymentReconciliation',
    route: {
      method: 'POST',
      path: `/payment-reconciliations/${encodeURIComponent(activeId.value)}/validate`,
      expectedVersion: 'none',
    },
    payload: {
      reconciliation_id: activeId.value,
      statement_amount: statementAmount.value,
      statement_file_id: statementFile.value?.file_id ?? null,
      variance_reason: varianceReason.value.trim() === '' ? null : varianceReason.value.trim(),
    },
  })
  const ok = applyMutationResult(outcome)
  if (ok) {
    actionSuccess.value = 'Rapprochement validé et figé définitivement.'
    candidatesData.value = null
    await loadList(listMeta.value.current_page)
  }
}

async function onPasswordConfirmed(): Promise<void> {
  askingPassword.value = false
  if (passwordContext.value === 'upload') {
    uploadError.value = 'Mot de passe confirmé : sélectionnez le fichier du relevé.'
    return
  }
  const outcome = await mutation.retry()
  const ok = applyMutationResult(outcome)
  if (ok) {
    actionSuccess.value = 'Rapprochement validé et figé définitivement.'
    candidatesData.value = null
    await loadList(listMeta.value.current_page)
  }
}

onMounted(() => {
  void loadCandidates()
  void loadList(1)
})
</script>

<template>
  <section aria-labelledby="titre-rapprochement" class="page-stack max-w-5xl">
    <PageHeader
      title-id="titre-rapprochement"
      title="Rapprochements par canal"
      icon="cash"
      subtitle="Pointez les encaissements et remboursements enregistrés par mode de règlement avec le relevé opérateur ou bancaire, déposez le relevé et validez avec motif en cas d’écart."
    >
      <template #actions>
        <div class="flex flex-wrap gap-3">
          <LinkButton
            v-if="canOnScreen('finance.global.read')"
            :to="{ name: 'finance' }"
            variant="secondary"
            >Finance et export Q13</LinkButton
          >
          <LinkButton :to="{ name: 'caisse-du-jour' }" variant="secondary"
            >Voir la caisse du jour</LinkButton
          >
        </div>
      </template>
    </PageHeader>

    <section aria-labelledby="titre-rec-periode" class="card space-y-4 p-4 sm:p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 id="titre-rec-periode" class="text-lg font-semibold">
          1. Canal de paiement et période
        </h2>
        <AppButton v-if="activeId !== null" variant="secondary" @click="startNew"
          >Nouveau rapprochement</AppButton
        >
      </div>
      <div class="grid gap-4 sm:grid-cols-4">
        <SelectField
          control-id="rec-canal"
          label="Canal de paiement"
          :model-value="method"
          :options="methodOptions"
          :disabled="!editable || activeId !== null"
          @update:model-value="
            (v) => {
              if (v) method = v as PaymentReconciliationsMethod
            }
          "
        />
        <DateField
          v-model="fromDate"
          control-id="rec-debut"
          label="Du"
          :disabled="!editable || activeId !== null"
        />
        <DateField
          v-model="toDate"
          control-id="rec-fin"
          label="Au"
          :error="periodProblem"
          :disabled="!editable || activeId !== null"
        />
        <div class="flex items-end">
          <AppButton
            variant="secondary"
            :disabled="!editable || candidatesLoading"
            :pending="candidatesLoading"
            pending-label="Lecture…"
            @click="loadCandidates(activeId ?? undefined)"
            >Charger les écritures attendues</AppButton
          >
        </div>
      </div>

      <StateMessage v-if="candidatesError" state="error" title="Écritures non chargées">{{
        candidatesError
      }}</StateMessage>

      <div
        v-if="freshnessHeadlineView"
        class="rounded-xl border p-3 text-sm"
        :class="
          freshnessHeadlineView.tone === 'warn'
            ? 'border-danger bg-surface'
            : 'border-line bg-canvas'
        "
      >
        <p :class="freshnessHeadlineView.tone === 'warn' ? 'font-semibold' : ''">
          {{ freshnessHeadlineView.text }}
        </p>
        <ul v-if="deviceNotices.length > 0" class="mt-2 space-y-1 text-xs text-muted">
          <li v-for="entry in deviceNotices" :key="entry.device_id">
            {{ entry.name }} : {{ deviceStateLabel(entry.state) }}
          </li>
        </ul>
      </div>
    </section>

    <section aria-labelledby="titre-rec-atelier" class="card space-y-5 p-4 sm:p-5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="titre-rec-atelier" class="text-lg font-semibold">2. Pointage et justification</h2>
        <span
          class="rounded-full border border-line px-3 py-1 text-sm font-medium"
          data-statut="rapprochement"
        >
          {{ loaded ? RECONCILIATION_STATUS_LABELS[loaded.status] : 'Nouveau brouillon' }}
        </span>
      </div>

      <StateMessage
        v-if="loaded && loaded.status === 'VALIDATED'"
        state="success"
        title="Rapprochement validé et figé"
      >
        Validé par {{ loaded.validated_by_name ?? 'la gérante' }} le
        {{ loaded.validated_at ? formatInstantFr(loaded.validated_at) : '—' }}. Aucune modification
        n’est plus possible.
      </StateMessage>

      <dl class="grid gap-3 rounded-xl border border-line bg-canvas p-4 sm:grid-cols-4">
        <div>
          <dt class="text-sm text-muted">Attendu serveur</dt>
          <dd class="text-lg font-bold tabular-nums" data-montant="rec-attendu">
            {{ expectedAmount !== null ? formatMoney(expectedAmount) : '—' }}
          </dd>
        </div>
        <div>
          <dt class="text-sm text-muted">Total net du relevé</dt>
          <dd class="text-lg font-semibold tabular-nums">
            {{ statementAmount !== null ? formatMoney(statementAmount) : '—' }}
          </dd>
        </div>
        <div>
          <dt class="text-sm text-muted">Écart (relevé − attendu)</dt>
          <dd
            class="text-lg font-bold tabular-nums"
            :class="currentVariance !== null && currentVariance !== 0 ? 'text-danger' : ''"
            data-montant="rec-ecart"
          >
            {{
              currentVariance !== null
                ? `${currentVariance > 0 ? '+' : ''}${formatMoney(currentVariance)}`
                : '—'
            }}
          </dd>
        </div>
        <div>
          <dt class="text-sm text-muted">Somme des lignes saisies</dt>
          <dd class="font-semibold tabular-nums">{{ formatMoney(matchedLinesSum) }}</dd>
        </div>
      </dl>

      <section
        v-if="editable && candidatesData"
        aria-labelledby="titre-rec-candidats"
        class="space-y-3"
      >
        <h3 id="titre-rec-candidats" class="text-base font-semibold">
          Écritures éligibles du cabinet ({{ candidatesData.candidates.length }})
        </h3>
        <StateMessage
          v-if="candidatesData.candidates.length === 0"
          state="empty"
          title="Aucune écriture disponible à pointer"
        >
          Aucun encaissement ou remboursement libre n’a été trouvé pour ce canal sur la période.
        </StateMessage>
        <ul v-else class="space-y-2">
          <li
            v-for="cand in candidatesData.candidates"
            :key="candidateKey(cand)"
            class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-canvas p-3"
          >
            <div class="min-w-0 space-y-0.5 text-sm">
              <p class="font-semibold">
                {{ cand.kind === 'REFUND' ? 'Remboursement' : 'Encaissement' }}
                {{ cand.piece_number ?? cand.invoice_number ?? '' }}
                <span v-if="cand.patient_name" class="font-normal text-muted">
                  · {{ cand.patient_name }}</span
                >
              </p>
              <p class="text-xs text-muted">
                {{ formatInstantFr(cand.effective_at) }}
                <template v-if="cand.reference"> · Réf. {{ cand.reference }}</template>
                <template v-if="cand.reversed_amount > 0">
                  · Contre-écriture −{{ formatMoney(cand.reversed_amount) }}</template
                >
              </p>
            </div>
            <div class="flex items-center gap-3">
              <span class="font-semibold tabular-nums">{{ formatMoney(cand.amount) }}</span>
              <AppButton
                variant="secondary"
                :pressed="selectedKeys.has(candidateKey(cand))"
                @click="toggleCandidate(cand)"
              >
                {{ selectedKeys.has(candidateKey(cand)) ? 'Retirer' : 'Pointer' }}
              </AppButton>
            </div>
          </li>
        </ul>
      </section>

      <section aria-labelledby="titre-rec-lignes" class="space-y-3">
        <h3 id="titre-rec-lignes" class="text-base font-semibold">
          Lignes du rapprochement ({{ draftLines.length }})
        </h3>
        <p v-if="draftLines.length === 0" class="text-sm text-muted">
          Pointez des écritures ci-dessus ou ajoutez une ligne de frais / litige figurant sur le
          relevé.
        </p>
        <ul v-else class="space-y-2">
          <li
            v-for="line in draftLines"
            :key="line.lineId"
            class="grid gap-3 rounded-lg border border-line bg-canvas p-3 sm:grid-cols-12 sm:items-end"
          >
            <div class="space-y-0.5 sm:col-span-4">
              <p class="text-sm font-semibold">{{ line.label }}</p>
              <p class="text-xs text-muted">
                {{ RECONCILIATION_LINE_STATUS_LABELS[line.status] }}
                <template v-if="line.note"> · {{ line.note }}</template>
              </p>
            </div>
            <div class="sm:col-span-3">
              <TextField
                :control-id="`rec-ref-${line.lineId}`"
                label="Référence relevé"
                :model-value="line.externalReference"
                :disabled="!editable"
                @update:model-value="(v) => updateLineReference(line.lineId, v)"
              />
            </div>
            <div class="sm:col-span-3">
              <TextField
                :control-id="`rec-amt-${line.lineId}`"
                label="Montant relevé (FCFA)"
                inputmode="numeric"
                :model-value="String(line.statementAmount)"
                :disabled="!editable"
                @update:model-value="(v) => updateLineAmount(line.lineId, v)"
              />
            </div>
            <div class="flex justify-end sm:col-span-2">
              <AppButton v-if="editable" variant="ghost" @click="removeLine(line.lineId)"
                >Supprimer</AppButton
              >
            </div>
          </li>
        </ul>

        <div
          v-if="editable"
          class="space-y-3 rounded-xl border border-dashed border-line bg-canvas p-3"
        >
          <p class="text-sm font-semibold">Ajouter une écriture du relevé (frais ou litige)</p>
          <div class="grid gap-3 sm:grid-cols-5">
            <SelectField
              v-model="manualStatus"
              control-id="rec-man-statut"
              label="Nature"
              :options="manualStatusOptions"
            />
            <SelectField
              v-model="manualDirection"
              control-id="rec-man-sens"
              label="Sens"
              :options="manualDirectionOptions"
            />
            <MoneyField
              v-model="manualAmount"
              control-id="rec-man-montant"
              label="Montant (FCFA)"
            />
            <TextField
              v-model="manualReference"
              control-id="rec-man-ref"
              label="Référence relevé"
            />
            <TextField v-model="manualNote" control-id="rec-man-note" label="Observation" />
          </div>
          <p v-if="manualError" role="alert" class="text-sm font-medium text-danger">
            {{ manualError }}
          </p>
          <AppButton variant="secondary" @click="addManualLine">Ajouter cette écriture</AppButton>
        </div>
      </section>

      <div class="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
        <MoneyField
          v-model="statementAmount"
          control-id="rec-total-releve"
          label="Total net du relevé (FCFA)"
          :disabled="!editable"
          hint="Montant net figurant sur le relevé opérateur ou bancaire de la période."
        />
        <div class="space-y-2">
          <label for="rec-justificatif" class="field-label block"
            >Justificatif du relevé (PDF, JPEG ou PNG)</label
          >
          <input
            v-if="editable"
            id="rec-justificatif"
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            class="block min-h-11 w-full max-w-full text-base"
            :disabled="uploading || saving"
            @change="chooseStatementFile"
          />
          <p v-if="uploading" role="status" class="text-sm">Dépôt du relevé en cours…</p>
          <p v-else-if="statementFile" class="text-sm">
            Relevé conservé ({{ statementFile.mime_type }}, {{ statementFile.size_bytes }} o) ·
            <a
              :href="statementFileUrl(statementFile.file_id)"
              target="_blank"
              rel="noopener noreferrer"
              class="underline"
              >Consulter le justificatif</a
            >
          </p>
          <p v-else class="text-sm text-muted">Aucun relevé déposé pour le moment.</p>
          <p v-if="uploadError" role="alert" class="text-sm font-medium text-danger">
            {{ uploadError }}
          </p>
        </div>
      </div>

      <TextAreaField
        v-model="varianceReason"
        control-id="rec-motif"
        label="Motif de l’écart (obligatoire à la validation si écart ≠ 0)"
        :rows="2"
        :maxlength="500"
        :disabled="!editable"
      />

      <StateMessage v-if="actionError" state="error" title="Enregistrement impossible">{{
        actionError
      }}</StateMessage>
      <StateMessage v-if="actionSuccess" state="success" title="Opération enregistrée">{{
        actionSuccess
      }}</StateMessage>

      <div v-if="editable" class="flex flex-wrap gap-3">
        <AppButton
          variant="secondary"
          :pending="saving"
          pending-label="Enregistrement…"
          @click="saveDraft"
          >Enregistrer le brouillon</AppButton
        >
        <AppButton :pending="saving" pending-label="Validation…" @click="validateDraft"
          >Valider définitivement</AppButton
        >
      </div>
    </section>

    <section aria-labelledby="titre-rec-historique" class="card space-y-4 p-4 sm:p-5">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <h2 id="titre-rec-historique" class="text-lg font-semibold">Rapprochements enregistrés</h2>
        <div class="flex flex-wrap items-end gap-3">
          <SelectField
            v-model="filterMethod"
            control-id="rec-filtre-canal"
            label="Canal"
            :options="filterMethodOptions"
          />
          <SelectField
            v-model="filterStatus"
            control-id="rec-filtre-statut"
            label="Statut"
            :options="filterStatusOptions"
          />
          <AppButton variant="secondary" :pending="listLoading" @click="loadList(1)"
            >Filtrer</AppButton
          >
        </div>
      </div>

      <StateMessage v-if="listLoading" state="loading" title="Chargement de l’historique…" />
      <StateMessage v-else-if="listError" state="offline" title="Historique non lu">{{
        listError
      }}</StateMessage>
      <StateMessage
        v-else-if="listItems.length === 0"
        state="empty"
        title="Aucun rapprochement enregistré"
      >
        Enregistrez un premier rapprochement ci-dessus.
      </StateMessage>
      <ul v-else class="space-y-2">
        <li
          v-for="item in listItems"
          :key="item.id"
          class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-canvas p-3"
        >
          <div class="min-w-0 space-y-0.5 text-sm">
            <p class="font-semibold">
              {{ paymentMethodLabel(item.method) }} ·
              {{ RECONCILIATION_STATUS_LABELS[item.status] }}
            </p>
            <p class="text-xs text-muted">
              {{ formatInstantFr(item.period_starts_at) }} →
              {{ formatInstantFr(item.period_ends_at) }} · {{ item.lines_count }} ligne(s)
              <template v-if="item.disputed_lines_count > 0">
                · {{ item.disputed_lines_count }} litige(s)</template
              >
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-4 text-sm tabular-nums">
            <span>Attendu : {{ formatMoney(item.expected_amount) }}</span>
            <span>
              Relevé :
              {{ item.statement_amount !== null ? formatMoney(item.statement_amount) : '—' }}
            </span>
            <AppButton variant="secondary" @click="openReconciliation(item.id)">Ouvrir</AppButton>
          </div>
        </li>
      </ul>

      <PaginationControls
        :current-page="listMeta.current_page"
        :last-page="listMeta.last_page"
        :total="listMeta.total"
        :busy="listLoading"
        unit="rapprochements"
        @page="loadList"
      />
    </section>

    <PasswordConfirmDialog
      :open="askingPassword"
      :action="passwordAction"
      @confirmed="onPasswordConfirmed"
      @cancel="askingPassword = false"
    />
  </section>
</template>
