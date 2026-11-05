<script setup lang="ts">
/**
 * Lignes d'un devis (L1D07), EN LIGNE, sous deux formes :
 *  - BROUILLON (`mode="draft"`) : enregistrer (création ou modification, version attendue), puis émettre après
 *    confirmation (numéro de la série des devis, révision 1 figée) ;
 *  - RÉVISION d'un devis émis (`mode="revision"`) : nouvelles lignes, nouvelle validité et motif obligatoire
 *    donnent la révision suivante, figée ; les révisions précédentes restent réimprimables.
 *
 * Les lignes viennent du catalogue (recherche) ou sont libres pour la gérante ; les totaux viennent des règles
 * partagées avec le serveur (`draftTotals`), qui recalcule et refuse ce qui dépasse les droits du compte. Rien n'est
 * dit enregistré avant la réponse du serveur. Un devis n'est ni une facture ni un encaissement : aucun stock n'est
 * réservé, aucun règlement n'y est enregistré.
 */
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'

import { clinicTimeZone } from '@/app/clinicTime'
import { getQuote, quotePath } from '@/app/services/quotes'
import type { MutationOutcome } from '@/app/services/mutations'
import { useMutation } from '@/app/services/useMutation'
import { canOnScreen, knownAccountId, moduleOpenOnScreen, revalidateSession } from '@/app/session'
import { useUnsavedChangesGuard } from '@/app/unsavedChanges'
import ConfirmDialog from '@/components/feedback/ConfirmDialog.vue'
import ErrorSummary, { type FieldErrorItem } from '@/components/feedback/ErrorSummary.vue'
import SaveStatus from '@/components/feedback/SaveStatus.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import DateField from '@/components/form/DateField.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import {
  type DraftLineError,
  type DraftLineField,
  type DraftLineForm,
  draftTotals,
  freeLine,
  lineFromCatalogItem,
  MAX_DRAFT_LINES,
  sameDraftLines,
  serverLineError,
} from '@/domain/billing/draft'
import {
  buildCreateQuotePayload,
  buildIssueQuotePayload,
  buildReviseQuotePayload,
  buildUpdateQuotePayload,
  linesFromQuote,
  type QuoteRecipientInput,
  validateQuoteLines,
} from '@/domain/billing/quote'
import { canDeleteQuoteDraft } from '@/domain/clinical/draftDeletion'
import type { CatalogItem, Quote, QuoteResponse } from '@/domain/contracts/generated'
import { formatMoney } from '@/domain/values/money'
import { newUlid } from '@/domain/values/ulid'

import CatalogPicker from './CatalogPicker.vue'
import DeleteQuoteDraftDialog from './DeleteQuoteDraftDialog.vue'
import DraftLineCard from './DraftLineCard.vue'
import { salesFailureView } from './failureView'
import { setSalesFlash } from './flash'
import { useSalesSettings } from './useSalesSettings'

const props = withDefaults(
  defineProps<{
    mode?: 'draft' | 'revision'
    /** Devis relu sur le serveur ; null : nouveau brouillon (le destinataire est alors requis). */
    initial?: Quote | null
    recipient?: QuoteRecipientInput | null
  }>(),
  { mode: 'draft', initial: null, recipient: null },
)

const emit = defineEmits<{
  created: [quote: Quote]
  issued: [quote: Quote]
  revised: [quote: Quote]
  /** Le devis a changé d'état ailleurs : l'écran parent le relit. */
  stale: []
  /** Le brouillon a été supprimé sur le serveur : l'écran parent quitte le devis. */
  deleted: []
  cancel: []
}>()

const GENERAL_ID = 'devis-erreurs'
const CATALOG_ID = 'devis-catalogue'
const VALIDITY_ID = 'devis-validite'
const REASON_ID = 'devis-motif-revision'

const timeZone = clinicTimeZone()
const saveMutation = useMutation()
const issueMutation = useMutation()

const revising = computed(() => props.mode === 'revision')
const priceAuthority = computed(() => canOnScreen('catalog.manage'))
const salesSettings = useSalesSettings()
const discountCap = computed(() => salesSettings.value?.discount_cap_percent ?? null)
const showStock = computed(() => moduleOpenOnScreen('stock') && canOnScreen('stock.read'))

const baseline = shallowRef<Quote | null>(props.initial)
const lines = ref<DraftLineForm[]>(props.initial === null ? [] : linesFromQuote(props.initial))
const savedLines = shallowRef<DraftLineForm[]>(lines.value.map((line) => ({ ...line })))
const validUntil = ref<string | null>(props.initial?.valid_until ?? null)
const savedValidUntil = ref<string | null>(validUntil.value)
const reason = ref('')
const savedAt = ref<string | null>(null)
const nothingToSave = ref(false)

const lineErrors = ref<Record<string, Partial<Record<DraftLineField, string>>>>({})
const generalErrors = ref<string[]>([])
const fieldErrors = ref<{ validUntil: string | null; reason: string | null }>({
  validUntil: null,
  reason: null,
})
const summaryBox = ref<{ focus: () => Promise<void> } | null>(null)

const cards = new Map<string, { commit: () => boolean }>()
function setCard(lineId: string, element: unknown): void {
  if (element === null) cards.delete(lineId)
  else cards.set(lineId, element as { commit: () => boolean })
}
onBeforeUnmount(() => cards.clear())

const totals = computed(() => draftTotals(lines.value))
const dirty = computed(
  () =>
    !sameDraftLines(lines.value, savedLines.value) ||
    validUntil.value !== savedValidUntil.value ||
    (revising.value && reason.value.trim() !== ''),
)
// Après la suppression du brouillon, ce qui était saisi et non enregistré n'a plus d'objet : on quitte sans demander.
const leaving = ref(false)
useUnsavedChangesGuard(() => dirty.value && !leaving.value)

const saving = computed(() => saveMutation.state.value === 'saving')
const issuing = computed(() => issueMutation.state.value === 'saving')
const busy = computed(() => saving.value || issuing.value)

/**
 * « Supprimer le brouillon » : un brouillon jamais émis seulement, pour son créateur ou la gérante
 * (`domain/clinical/draftDeletion`) ; le serveur applique la règle et refuse tout autre cas. Après la suppression, le
 * devis n'existe plus : l'écran parent le quitte (liste des devis, avec le message du résultat).
 */
const deleteOpen = ref(false)
const deleteProblem = ref<string | null>(null)
const canDelete = computed(
  () =>
    !revising.value &&
    baseline.value !== null &&
    canDeleteQuoteDraft(
      { status: baseline.value.status, createdBy: baseline.value.created_by },
      { accountId: knownAccountId(), can: canOnScreen },
    ),
)

function onDeleted(message: string): void {
  leaving.value = true
  deleteOpen.value = false
  setSalesFlash(message)
  emit('deleted')
}

function onNotDeleted(message: string): void {
  deleteOpen.value = false
  deleteProblem.value = message
  emit('stale')
}
const saveFailure = computed(() =>
  saveMutation.state.value === 'conflict' ? null : salesFailureView(saveMutation.state.value),
)
const issueFailure = computed(() =>
  issueMutation.state.value === 'conflict' ? null : salesFailureView(issueMutation.state.value),
)
const conflict = computed(
  () => saveMutation.state.value === 'conflict' || issueMutation.state.value === 'conflict',
)

const summary = computed<FieldErrorItem[]>(() => {
  const items: FieldErrorItem[] = generalErrors.value.map((message) => ({
    fieldId: GENERAL_ID,
    message,
  }))
  if (fieldErrors.value.validUntil !== null) {
    items.push({ fieldId: VALIDITY_ID, message: fieldErrors.value.validUntil })
  }
  if (fieldErrors.value.reason !== null) {
    items.push({ fieldId: REASON_ID, message: fieldErrors.value.reason })
  }
  lines.value.forEach((line, index) => {
    const errors = lineErrors.value[line.lineId]
    if (errors === undefined) return
    for (const [field, message] of Object.entries(errors)) {
      if (message === undefined) continue
      items.push({
        fieldId: `ligne-${line.lineId}-${field}`,
        message: `Ligne ${index + 1} : ${message}`,
      })
    }
  })
  return items
})

function clearFeedback(): void {
  lineErrors.value = {}
  generalErrors.value = []
  fieldErrors.value = { validUntil: null, reason: null }
  nothingToSave.value = false
}

function showLineErrors(errors: readonly DraftLineError[]): void {
  const byLine: Record<string, Partial<Record<DraftLineField, string>>> = {}
  for (const error of errors) {
    const line = lines.value[error.index]
    if (line === undefined) continue
    byLine[line.lineId] = { ...(byLine[line.lineId] ?? {}), [error.field]: error.message }
  }
  lineErrors.value = byLine
}

function dropLineErrors(lineId: string): void {
  if (lineErrors.value[lineId] === undefined) return
  const rest = { ...lineErrors.value }
  delete rest[lineId]
  lineErrors.value = rest
}

function addItem(item: CatalogItem): void {
  if (lines.value.length >= MAX_DRAFT_LINES) {
    generalErrors.value = [`Un devis compte au plus ${MAX_DRAFT_LINES} lignes.`]
    return
  }
  lines.value = [...lines.value, lineFromCatalogItem(item, newUlid())]
  nothingToSave.value = false
}

function addFreeLine(): void {
  if (lines.value.length >= MAX_DRAFT_LINES) return
  lines.value = [...lines.value, freeLine(newUlid())]
  nothingToSave.value = false
}

function updateLine(index: number, line: DraftLineForm): void {
  const next = [...lines.value]
  next[index] = line
  lines.value = next
  dropLineErrors(line.lineId)
  nothingToSave.value = false
}

function removeLine(index: number): void {
  const removed = lines.value[index]
  lines.value = lines.value.filter((_line, position) => position !== index)
  if (removed !== undefined) dropLineErrors(removed.lineId)
  nothingToSave.value = false
}

function commitCards(): boolean {
  let ok = true
  for (const card of cards.values()) ok = card.commit() && ok
  return ok
}

/** Refus du serveur rattaché aux lignes, à la validité, au motif, ou général. */
function applyServerRefusal(
  fields: Readonly<Record<string, readonly string[]>>,
  message: string,
): void {
  const byLine: DraftLineError[] = []
  const general: string[] = []
  for (const [key, messages] of Object.entries(fields)) {
    const first = messages[0]
    if (first === undefined) continue
    if (key === 'valid_until') {
      fieldErrors.value = { ...fieldErrors.value, validUntil: first }
      continue
    }
    if (key === 'reason') {
      fieldErrors.value = { ...fieldErrors.value, reason: first }
      continue
    }
    const lineError = serverLineError(key, first)
    if (lineError === null) general.push(first)
    else byLine.push(lineError)
  }
  showLineErrors(byLine)
  const anyField = fieldErrors.value.validUntil !== null || fieldErrors.value.reason !== null
  generalErrors.value =
    general.length === 0 && byLine.length === 0 && !anyField ? [message] : general
}

function afterServerQuote(quote: Quote): void {
  baseline.value = quote
  lines.value = linesFromQuote(quote)
  savedLines.value = lines.value.map((line) => ({ ...line }))
  validUntil.value = quote.valid_until
  savedValidUntil.value = quote.valid_until
}

async function handleRefusalOrState(result: MutationOutcome): Promise<void> {
  switch (result.kind) {
    case 'refused': {
      if (result.error.code === 'STATE_TRANSITION_REFUSED') {
        emit('stale')
        return
      }
      applyServerRefusal(result.error.fields, result.error.message)
      const expectedTotal = result.error.details['expected_total']
      if (typeof expectedTotal === 'number') {
        generalErrors.value = [
          ...generalErrors.value,
          `Le serveur calcule un total de ${formatMoney(expectedTotal)} : relisez le devis.`,
        ]
      }
      await summaryBox.value?.focus()
      return
    }
    case 'session-expired':
    case 'reauthentication-required':
      void revalidateSession().catch(() => undefined)
      return
    default:
      return
  }
}

/** Contrôles locaux communs à l'enregistrement et à la révision ; vrai si l'envoi peut partir. */
async function checkLocally(forIssue: boolean): Promise<boolean> {
  const committed = commitCards()
  const check = validateQuoteLines(lines.value, { forIssue })
  let ok = committed && check.errors.length === 0 && check.general === null
  if (revising.value) {
    if (validUntil.value === null) {
      fieldErrors.value = {
        ...fieldErrors.value,
        validUntil: 'Indiquez la nouvelle date de validité.',
      }
      ok = false
    }
    if (reason.value.trim().length < 3) {
      fieldErrors.value = {
        ...fieldErrors.value,
        reason: 'Le motif de la révision est obligatoire (3 caractères au moins).',
      }
      ok = false
    }
  }
  if (!ok) {
    showLineErrors(check.errors)
    if (check.general !== null) generalErrors.value = [check.general]
    else if (!committed && check.errors.length === 0) {
      generalErrors.value = ['Certaines valeurs saisies sont refusées : corrigez-les.']
    }
    await summaryBox.value?.focus()
  }
  return ok
}

async function save(): Promise<void> {
  if (busy.value) return
  clearFeedback()
  if (revising.value) {
    await submitRevision()
    return
  }
  if (!(await checkLocally(false))) return
  const base = baseline.value
  if (base !== null && !dirty.value) {
    nothingToSave.value = true
    return
  }
  if (base === null) {
    if (props.recipient === null) {
      generalErrors.value = ['Choisissez d’abord le destinataire du devis.']
      await summaryBox.value?.focus()
      return
    }
    const result = await saveMutation.submit({
      name: 'CreateQuoteDraft',
      route: { method: 'POST', path: '/quotes', expectedVersion: 'none' },
      payload: buildCreateQuotePayload({
        quoteId: saveMutation.effectId('quote_id'),
        recipient: props.recipient,
        validUntil: validUntil.value,
        lines: lines.value,
      }),
    })
    if (result.kind === 'synced') {
      const quote = (result.result as QuoteResponse).data
      savedAt.value = result.at
      afterServerQuote(quote)
      setSalesFlash('Brouillon de devis enregistré sur le serveur.')
      emit('created', quote)
      return
    }
    await handleRefusalOrState(result)
    return
  }
  const result = await saveMutation.submit({
    name: 'UpdateQuoteDraft',
    route: { method: 'PATCH', path: quotePath(base.id, ''), expectedVersion: 'entity' },
    payload: buildUpdateQuotePayload({
      quoteId: base.id,
      validUntil: validUntil.value,
      lines: lines.value,
    }),
    expectedVersion: base.version,
  })
  if (result.kind === 'synced') {
    savedAt.value = result.at
    afterServerQuote((result.result as QuoteResponse).data)
    return
  }
  await handleRefusalOrState(result)
}

async function submitRevision(): Promise<void> {
  const base = baseline.value
  const total = totals.value.total
  if (base === null) return
  if (!(await checkLocally(true)) || total === null || validUntil.value === null) return
  const result = await saveMutation.submit({
    name: 'ReviseQuote',
    route: { method: 'POST', path: quotePath(base.id, 'revisions'), expectedVersion: 'entity' },
    payload: buildReviseQuotePayload({
      quoteId: base.id,
      reason: reason.value,
      validUntil: validUntil.value,
      lines: lines.value,
      totalGross: total,
    }),
    expectedVersion: base.version,
  })
  if (result.kind === 'synced') {
    const quote = (result.result as QuoteResponse).data
    savedAt.value = result.at
    afterServerQuote(quote)
    reason.value = ''
    setSalesFlash(
      `Révision ${quote.current_revision} enregistrée : les révisions précédentes restent réimprimables.`,
    )
    emit('revised', quote)
    return
  }
  await handleRefusalOrState(result)
}

async function retrySave(): Promise<void> {
  if (busy.value) return
  const result = await saveMutation.retry()
  if (result.kind === 'synced') {
    const quote = (result.result as QuoteResponse).data
    savedAt.value = result.at
    const creating = baseline.value === null
    afterServerQuote(quote)
    if (creating) emit('created', quote)
    else if (revising.value) emit('revised', quote)
    return
  }
  await handleRefusalOrState(result)
}

/** Conflit de version : relire le devis et reprendre sur la version actuelle (la saisie est conservée). */
const reloading = ref(false)
const reloadProblem = ref<string | null>(null)
async function reloadQuote(): Promise<void> {
  const base = baseline.value
  if (reloading.value || base === null) return
  reloading.value = true
  reloadProblem.value = null
  try {
    const current = (await getQuote(base.id)).data
    if (current.status !== base.status) {
      emit('stale')
      return
    }
    // Garder la saisie : elle partira sur la version actuelle au prochain envoi.
    baseline.value = current
    saveMutation.reset()
    issueMutation.reset()
  } catch {
    reloadProblem.value =
      'Le devis n’a pas pu être relu (serveur indisponible ou refus) : votre saisie est conservée, réessayez.'
  } finally {
    reloading.value = false
  }
}

// --- Émission du brouillon ----------------------------------------------------------------------

const confirmingIssue = ref(false)
const issueReady = computed(
  () =>
    !revising.value &&
    baseline.value !== null &&
    !dirty.value &&
    lines.value.length > 0 &&
    totals.value.total !== null &&
    validUntil.value !== null,
)

async function requestIssue(): Promise<void> {
  if (busy.value) return
  clearFeedback()
  if (baseline.value === null) return
  if (dirty.value) {
    generalErrors.value = [
      'Enregistrez le brouillon avant de l’émettre : le devis émis est celui enregistré.',
    ]
    await summaryBox.value?.focus()
    return
  }
  if (validUntil.value === null) {
    fieldErrors.value = {
      ...fieldErrors.value,
      validUntil: 'Indiquez jusqu’à quelle date le devis est valable, puis enregistrez.',
    }
    await summaryBox.value?.focus()
    return
  }
  if (!(await checkLocally(true))) return
  confirmingIssue.value = true
}

async function confirmIssue(): Promise<void> {
  const base = baseline.value
  const total = totals.value.total
  if (issuing.value || base === null || total === null) return
  const result = await issueMutation.submit({
    name: 'IssueQuote',
    route: { method: 'POST', path: quotePath(base.id, 'issue'), expectedVersion: 'entity' },
    payload: buildIssueQuotePayload(base.id, total),
    expectedVersion: base.version,
  })
  confirmingIssue.value = false
  if (result.kind === 'synced') {
    const quote = (result.result as QuoteResponse).data
    savedLines.value = lines.value.map((line) => ({ ...line }))
    setSalesFlash(quote.number === null ? 'Devis émis.' : `Devis émis : numéro ${quote.number}.`)
    emit('issued', quote)
    return
  }
  await handleRefusalOrState(result)
}

async function retryIssue(): Promise<void> {
  if (busy.value) return
  const result = await issueMutation.retry()
  if (result.kind === 'synced') {
    emit('issued', (result.result as QuoteResponse).data)
    return
  }
  await handleRefusalOrState(result)
}

const saveStatus = computed(() => {
  if (saveMutation.state.value !== 'synced') return saveMutation.saveState.value
  return dirty.value ? 'idle' : 'saved-server'
})
</script>

<template>
  <div class="space-y-6">
    <p class="text-base">
      <span aria-hidden="true">✎ </span>
      <template v-if="revising"
        >Révision du devis {{ baseline?.number }} : les lignes ci-dessous deviendront la révision
        {{ (baseline?.current_revision ?? 0) + 1 }}, figée ; la révision actuelle reste
        réimprimable.</template
      >
      <template v-else-if="baseline">Brouillon enregistré, sans numéro définitif.</template>
      <template v-else
        >Nouveau devis : rien n’est enregistré tant que vous n’avez pas cliqué sur « Enregistrer le
        brouillon ».</template
      >
    </p>

    <div :id="GENERAL_ID" tabindex="-1">
      <ErrorSummary ref="summaryBox" :errors="summary" />
    </div>

    <StateMessage v-if="conflict" state="conflict" title="Le devis a changé entre-temps">
      <p>
        Quelqu’un a modifié ce devis pendant votre saisie. Votre saisie est conservée : relisez la
        version actuelle, puis enregistrez de nouveau.
      </p>
      <p v-if="reloadProblem" class="mt-2 font-medium">{{ reloadProblem }}</p>
      <template #action>
        <AppButton
          variant="primary"
          :pending="reloading"
          pending-label="Lecture…"
          @click="reloadQuote"
          >Relire le devis</AppButton
        >
      </template>
    </StateMessage>

    <StateMessage v-if="deleteProblem" state="conflict" title="Brouillon non supprimé">
      {{ deleteProblem }}
    </StateMessage>

    <StateMessage v-if="saveFailure" :state="saveFailure.state" :title="saveFailure.title">
      {{ saveMutation.failureMessage.value }}
      <template v-if="saveFailure.retry" #action>
        <AppButton variant="secondary" :pending="saving" @click="retrySave"
          >Réessayer l’enregistrement</AppButton
        >
      </template>
    </StateMessage>

    <StateMessage v-if="issueFailure" :state="issueFailure.state" :title="issueFailure.title">
      {{ issueMutation.failureMessage.value }}
      <template v-if="issueFailure.retry" #action>
        <AppButton variant="secondary" :pending="issuing" @click="retryIssue"
          >Réessayer l’émission</AppButton
        >
      </template>
    </StateMessage>

    <form novalidate aria-labelledby="titre-lignes-devis" class="space-y-4" @submit.prevent="save">
      <DateField
        v-model="validUntil"
        label="Valable jusqu’au"
        field="valid_until"
        :hint="
          revising
            ? 'Nouvelle date de validité de la révision (au plus tôt aujourd’hui).'
            : 'Obligatoire pour émettre le devis ; au plus tôt aujourd’hui. Format JJ/MM/AAAA.'
        "
        :control-id="VALIDITY_ID"
        :error="fieldErrors.validUntil"
        :required="revising"
        :disabled="busy"
      />
      <TextAreaField
        v-if="revising"
        v-model="reason"
        label="Motif de la révision"
        hint="Obligatoire ; imprimé sur la révision et conservé dans l’historique."
        :control-id="REASON_ID"
        :error="fieldErrors.reason"
        :maxlength="1000"
        :rows="2"
        required
        :disabled="busy"
      />

      <h2 id="titre-lignes-devis" class="text-lg font-semibold">Lignes du devis</h2>
      <ul v-if="lines.length > 0" class="space-y-3">
        <DraftLineCard
          v-for="(line, index) in lines"
          :key="line.lineId"
          :ref="(element) => setCard(line.lineId, element)"
          :line="line"
          :index="index"
          :price-authority="priceAuthority"
          :discount-cap="discountCap"
          :errors="lineErrors[line.lineId] ?? {}"
          :show-stock="showStock"
          :disabled="busy"
          @update:line="updateLine(index, $event)"
          @remove="removeLine(index)"
        />
      </ul>
      <StateMessage v-else state="empty" title="Aucune ligne">
        Ajoutez un article du catalogue pour composer le devis.
      </StateMessage>

      <CatalogPicker :control-id="CATALOG_ID" :disabled="busy" @pick="addItem" />
      <AppButton v-if="priceAuthority" variant="secondary" :disabled="busy" @click="addFreeLine"
        >Ajouter une ligne hors catalogue</AppButton
      >

      <div
        class="rounded-xl border border-line bg-surface shadow-card p-4"
        role="group"
        aria-label="Total du devis"
      >
        <p class="text-base font-semibold" aria-live="polite">
          Total TTC du devis :
          <span class="text-2xl font-bold tabular-nums" data-montant="total-devis">{{
            totals.total === null ? 'à compléter' : formatMoney(totals.total)
          }}</span>
        </p>
        <p v-if="totals.totalError" class="text-sm font-medium text-danger">
          <span aria-hidden="true">⚠ </span>{{ totals.totalError }}
        </p>
        <p class="mt-1 text-sm text-muted">
          Proposition au client : ce montant n’est ni une créance ni un encaissement, et aucun
          article n’est réservé. Le serveur recalcule chaque total.
        </p>
      </div>

      <p v-if="nothingToSave" role="status" class="text-base">Aucune modification à enregistrer.</p>

      <div class="flex flex-wrap items-center gap-3">
        <AppButton
          type="submit"
          :pending="saving"
          :pending-label="revising ? 'Enregistrement de la révision…' : 'Enregistrement en cours…'"
          >{{ revising ? 'Enregistrer la révision' : 'Enregistrer le brouillon' }}</AppButton
        >
        <AppButton
          v-if="!revising && baseline"
          variant="secondary"
          :disabled="!issueReady || saving"
          :pending="issuing"
          pending-label="Émission en cours…"
          @click="requestIssue"
          >Émettre le devis</AppButton
        >
        <AppButton v-if="revising" variant="ghost" :disabled="busy" @click="emit('cancel')"
          >Annuler la révision</AppButton
        >
        <AppButton
          v-if="canDelete"
          variant="danger"
          :disabled="busy"
          accessible-name="Supprimer le brouillon de ce devis"
          @click="deleteOpen = true"
          >Supprimer le brouillon</AppButton
        >
        <SaveStatus :state="saveStatus" :at="savedAt" :time-zone="timeZone" />
      </div>
      <p v-if="!revising && baseline && dirty" class="text-sm text-muted">
        Enregistrez le brouillon avant de l’émettre.
      </p>
      <p v-else-if="!revising && baseline && validUntil === null" class="text-sm text-muted">
        Indiquez une date de validité et enregistrez pour pouvoir émettre le devis.
      </p>
    </form>

    <DeleteQuoteDraftDialog
      v-if="deleteOpen && baseline !== null"
      :quote-id="baseline.id"
      :version="baseline.version"
      :lines="baseline.lines.length"
      @deleted="onDeleted"
      @stale="onNotDeleted"
      @close="deleteOpen = false"
    />

    <ConfirmDialog
      :open="confirmingIssue"
      title="Émettre le devis ?"
      confirm-label="Émettre le devis"
      pending-label="Émission en cours…"
      :pending="issuing"
      @confirm="confirmIssue"
      @cancel="confirmingIssue = false"
    >
      <p>
        Total TTC proposé :
        <strong>{{ totals.total === null ? '—' : formatMoney(totals.total) }}</strong> ({{
          lines.length
        }}
        ligne{{ lines.length > 1 ? 's' : '' }}).
      </p>
      <p class="mt-2">
        Le serveur attribue un numéro de devis et fige cette première révision. Une correction
        ultérieure se fera par une nouvelle révision, avec un motif. Un devis ne vaut pas facture :
        il ne crée ni créance ni réservation de stock.
      </p>
    </ConfirmDialog>
  </div>
</template>
