<script setup lang="ts">
/**
 * Brouillon de facture (B02) et son émission (B03), EN LIGNE. Le patient arrive présélectionné (fiche,
 * visite de la file du jour ou choix explicite) : son identité est affichée, jamais ressaisie ; la
 * facture ne porte que son identifiant. Les lignes viennent du catalogue (recherche), ou sont libres
 * pour la gérante ; quantités exactes, remises dans la limite du droit (le serveur tranche et l'écran
 * dit l'erreur ligne par ligne). Les totaux viennent des règles partagées (`draftTotals`, mêmes
 * vecteurs que le serveur). L'enregistrement est explicite ; rien n'est dit enregistré avant la
 * réponse du serveur.
 *
 * Conflit de version (409, brouillon modifié ailleurs) : la saisie est conservée ; « Relire le
 * brouillon » montre la version actuelle et laisse choisir entre garder sa saisie (enregistrée sur la
 * version actuelle au prochain envoi) et reprendre la version actuelle.
 *
 * Émission : confirmation explicite (« La facture émise ne pourra plus être modifiée »), puis le numéro
 * définitif est affiché après la réponse du serveur seulement. Les identifiants des effets (usage du
 * numéro, document) et l'instant de la demande sont fixés pour l'intention : une reprise (coupure,
 * double clic) rejoue la même commande, jamais une seconde émission.
 *
 * Abandon (fichier 03 : « Une facture brouillon peut être abandonnée ») : un brouillon ENREGISTRÉ
 * s'abandonne après confirmation, avec un motif facultatif, par son créateur ou la gérante (le serveur
 * tranche). Rien d'autre ne change : pas de numéro, pas de stock, pas de pièce.
 *
 * Poste préparé (coffre ouvert, G1, AT37) : le brouillon, ses modifications et l'émission s'enregistrent SUR le poste
 * (« Enregistré sur ce poste », jamais « sur le serveur ») ; la facture est alors relue dans le coffre, avec le numéro de
 * la plage du poste, et l'abandon (qui demande le serveur) n'est pas offert pour un brouillon que le serveur ignore.
 */
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'

import { clinicTimeZone } from '@/app/clinicTime'
import { displayedLinesSha256, getInvoice } from '@/app/services/billing'
import type { MutationOutcome } from '@/app/services/mutations'
import { useMutation } from '@/app/services/useMutation'
import { canOnScreen, moduleOpenOnScreen, revalidateSession } from '@/app/session'
import { useUnsavedChangesGuard } from '@/app/unsavedChanges'
import ApprovalRequestDialog from '@/components/approvals/ApprovalRequestDialog.vue'
import ConfirmDialog from '@/components/feedback/ConfirmDialog.vue'
import ErrorSummary, { type FieldErrorItem } from '@/components/feedback/ErrorSummary.vue'
import SaveStatus from '@/components/feedback/SaveStatus.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import PatientIdentityHeader, {
  type HeaderPatient,
} from '@/components/patients/PatientIdentityHeader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import {
  buildCreateDraftPayload,
  buildUpdateDraftPayload,
  type DraftLineError,
  type DraftLineField,
  type DraftLineForm,
  draftTotals,
  freeLine,
  lineFromCatalogItem,
  linesFromInvoice,
  MAX_DRAFT_LINES,
  sameDraftLines,
  serverLineError,
  validateDraftLines,
} from '@/domain/billing/draft'
import { buildIssuePayload, heldByDevice, issueBlockers } from '@/domain/billing/issueInvoice'
import { draftLineRightsSubject } from '@/domain/approvals/approvals'
import type {
  Approval,
  CatalogItem,
  DraftLineRightsSubject,
  Invoice,
  InvoiceResponse,
} from '@/domain/contracts/generated'
import { currentInstant } from '@/domain/patients/visits'
import { formatMoney } from '@/domain/values/money'
import { newUlid } from '@/domain/values/ulid'

import CatalogPicker from './CatalogPicker.vue'
import DraftLineCard from './DraftLineCard.vue'
import { salesFailureView } from './failureView'
import { setSalesFlash } from './flash'
import { useSalesSettings } from './useSalesSettings'

const props = withDefaults(
  defineProps<{
    /** Identité du patient affichée (fiche lue), ou null si elle n'a pas pu être lue. */
    patient: HeaderPatient | null
    patientId: string
    visitId?: string | null
    /** Brouillon relu sur le serveur ; null : nouveau brouillon. */
    initial?: Invoice | null
    /** Brouillon lu sur la copie de ce poste (le serveur ne le connaît pas encore) : l'abandon n'est pas offert. */
    local?: boolean
  }>(),
  { visitId: null, initial: null, local: false },
)

const emit = defineEmits<{
  created: [invoice: Invoice]
  /** `onDevice` : émise sur CE poste (numéro de sa plage), le serveur ne la connaît pas encore. */
  issued: [invoice: Invoice, onDevice: boolean]
  /** Brouillon abandonné (réponse du serveur) : l'écran parent l'affiche abandonné. */
  abandoned: [invoice: Invoice]
  /** La facture n'est plus un brouillon (émise ailleurs) : l'écran parent la relit. */
  stale: []
}>()

const GENERAL_ID = 'facture-erreurs'
const CATALOG_ID = 'facture-catalogue'

const timeZone = clinicTimeZone()
const draftMutation = useMutation()
const issueMutation = useMutation()
const abandonMutation = useMutation()

const priceAuthority = computed(() => canOnScreen('catalog.manage'))
/** Plafond de remise EFFECTIF de ce compte (lu sur le serveur) : dit à côté de chaque remise. */
const salesSettings = useSalesSettings()
const discountCap = computed(() => salesSettings.value?.discount_cap_percent ?? null)
const canIssue = computed(() => canOnScreen('invoice.issue') || canOnScreen('exam_fee.collect'))
/** Mêmes droits que la modification du brouillon ; le serveur réserve l'abandon au créateur et à la gérante. */
const canAbandon = computed(() => canOnScreen('invoice.create') || canOnScreen('exam_fee.collect'))
const showStock = computed(() => moduleOpenOnScreen('stock') && canOnScreen('stock.read'))

const baseline = shallowRef<Invoice | null>(props.initial)
const lines = ref<DraftLineForm[]>(props.initial === null ? [] : linesFromInvoice(props.initial))
const savedLines = shallowRef<DraftLineForm[]>(lines.value.map((line) => ({ ...line })))
const savedAt = ref<string | null>(null)
const nothingToSave = ref(false)
/**
 * Prix ou remise au-delà des droits du compte (422 `APPROVAL_REQUIRED_OR_EXPIRED`) : contenu exact des lignes
 * envoyées, pour une demande d'autorisation à la gérante (B06). Une fois accordée, le brouillon s'enregistre
 * avec EXACTEMENT ces lignes : le serveur retrouve l'autorisation par son contenu et la consomme.
 */
const rightsSubject = ref<DraftLineRightsSubject | null>(null)
const askingRights = ref(false)
const rightsRequested = ref<string | null>(null)
const mayRequestRights = computed(
  () => canOnScreen('approval.request') && moduleOpenOnScreen('settings'),
)

const lineErrors = ref<Record<string, Partial<Record<DraftLineField, string>>>>({})
const generalErrors = ref<string[]>([])
const summaryBox = ref<{ focus: () => Promise<void> } | null>(null)

/** Cartes des lignes, par identifiant de ligne (lecture des champs avant l'envoi). */
const cards = new Map<string, { commit: () => boolean }>()

function setCard(lineId: string, element: unknown): void {
  if (element === null) cards.delete(lineId)
  else cards.set(lineId, element as { commit: () => boolean })
}

onBeforeUnmount(() => cards.clear())

const totals = computed(() => draftTotals(lines.value))
const dirty = computed(() => !sameDraftLines(lines.value, savedLines.value))
useUnsavedChangesGuard(dirty)

const saving = computed(() => draftMutation.state.value === 'saving')
const issuing = computed(() => issueMutation.state.value === 'saving')
const abandoning = computed(() => abandonMutation.state.value === 'saving')
/** Facture émise sur le poste mais non relisible ici : l'écran ne propose plus ni modification ni nouvelle émission. */
const lockedAfterLocalIssue = ref(false)
const busy = computed(
  () => saving.value || issuing.value || abandoning.value || lockedAfterLocalIssue.value,
)

const draftFailure = computed(() =>
  draftMutation.state.value === 'conflict' ? null : salesFailureView(draftMutation.state.value),
)
const issueFailure = computed(() =>
  issueMutation.state.value === 'conflict' ? null : salesFailureView(issueMutation.state.value),
)
const abandonFailure = computed(() =>
  abandonMutation.state.value === 'conflict' ? null : salesFailureView(abandonMutation.state.value),
)

const summary = computed<FieldErrorItem[]>(() => {
  const items: FieldErrorItem[] = generalErrors.value.map((message) => ({
    fieldId: GENERAL_ID,
    message,
  }))
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
  nothingToSave.value = false
  rightsSubject.value = null
}

/** Demande d'autorisation créée : elle attend la décision de la gérante. */
function rightsRequestSent(approval: Approval): void {
  askingRights.value = false
  rightsRequested.value = `Demande d’autorisation envoyée à la gérante (${approval.reason}). Une fois accordée, enregistrez de nouveau le brouillon sans modifier ses lignes.`
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

// --- Lignes ---------------------------------------------------------------------------------------

function addItem(item: CatalogItem): void {
  if (lines.value.length >= MAX_DRAFT_LINES) {
    generalErrors.value = [`Une facture compte au plus ${MAX_DRAFT_LINES} lignes.`]
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

/** Lignes relues du serveur, avec le mode de stock déjà connu de l'écran (non renvoyé par la facture). */
function withKnownStock(next: DraftLineForm[]): DraftLineForm[] {
  const known = new Map(lines.value.map((line) => [line.lineId, line]))
  return next.map((line) => {
    const previous = known.get(line.lineId)
    return previous === undefined
      ? line
      : { ...line, stockMode: previous.stockMode, catalogPrice: previous.catalogPrice }
  })
}

// --- Enregistrement du brouillon ------------------------------------------------------------------

/** Conflit de version : la version actuelle relue, à comparer avant de choisir. */
const needsReload = ref(false)
const latest = shallowRef<Invoice | null>(null)
const reloading = ref(false)
const reloadProblem = ref<string | null>(null)

function applyServerRefusal(
  fields: Readonly<Record<string, readonly string[]>>,
  message: string,
): void {
  const byLine: DraftLineError[] = []
  const general: string[] = []
  for (const [key, messages] of Object.entries(fields)) {
    const first = messages[0]
    if (first === undefined) continue
    const lineError = serverLineError(key, first)
    if (lineError === null) general.push(first)
    else byLine.push(lineError)
  }
  showLineErrors(byLine)
  generalErrors.value = general.length === 0 && byLine.length === 0 ? [message] : general
}

function afterServerInvoice(invoice: Invoice): void {
  baseline.value = invoice
  lines.value = withKnownStock(linesFromInvoice(invoice))
  savedLines.value = lines.value.map((line) => ({ ...line }))
}

/**
 * Facture que le poste vient d'enregistrer, relue dans le coffre (`getInvoice` rend la copie du poste tant que le serveur
 * ne l'a pas consolidée). Null si elle ne peut pas être reconstruite ici : la pièce reste dans le journal du poste.
 */
async function readDeviceInvoice(
  invoiceId: string,
  status: 'DRAFT' | 'ISSUED',
): Promise<Invoice | null> {
  try {
    const result = await getInvoice(invoiceId)
    // Une facture émise sur le poste que le poste ne sait pas reconstruire (patient du serveur seulement) se relit sur
    // le serveur comme son BROUILLON : ce n'est pas la facture émise, elle n'est jamais présentée comme telle.
    return result.data.id === invoiceId && result.data.status === status ? result.data : null
  } catch {
    return null
  }
}

const ISSUED_NOT_READ_ON_DEVICE =
  'La facture est émise sur ce poste mais n’a pas pu y être relue (identité du patient ou en-tête du cabinet inconnus du poste) : elle part à la synchronisation. Ne l’émettez pas de nouveau ; elle s’affichera au retour du serveur.'

const NOT_READ_ON_DEVICE =
  'La pièce est enregistrée sur ce poste mais n’a pas pu y être relue (identité du patient ou en-tête du cabinet inconnus du poste) : elle part à la synchronisation, ne la refaites pas.'

/** Lignes et facture de la dernière demande d'enregistrement : contenu exact d'une éventuelle autorisation. */
let lastSent: { invoiceId: string; lines: Parameters<typeof draftLineRightsSubject>[2] } | null =
  null

async function afterSave(result: MutationOutcome, creating: boolean): Promise<void> {
  switch (result.kind) {
    case 'synced': {
      const invoice = (result.result as InvoiceResponse).data
      savedAt.value = result.at
      afterServerInvoice(invoice)
      if (creating) {
        setSalesFlash('Brouillon de facture enregistré sur le serveur.')
        emit('created', invoice)
      }
      return
    }
    case 'saved-local': {
      // Enregistré sur ce poste (poste préparé) : rien n'est dit « sur le serveur », qui ne connaît pas encore le brouillon.
      savedAt.value = result.at
      const invoice =
        lastSent === null ? null : await readDeviceInvoice(lastSent.invoiceId, 'DRAFT')
      if (invoice === null) {
        generalErrors.value = [NOT_READ_ON_DEVICE]
        await summaryBox.value?.focus()
        return
      }
      afterServerInvoice(invoice)
      if (creating) {
        setSalesFlash(
          'Brouillon de facture enregistré sur ce poste, en attente de synchronisation.',
        )
        emit('created', invoice)
      }
      return
    }
    case 'conflict':
      needsReload.value = true
      return
    case 'refused':
      if (result.error.code === 'STATE_TRANSITION_REFUSED') {
        emit('stale')
        return
      }
      if (result.error.code === 'APPROVAL_REQUIRED_OR_EXPIRED' && lastSent !== null) {
        rightsSubject.value = draftLineRightsSubject(
          lastSent.invoiceId,
          props.patientId,
          lastSent.lines,
        )
      }
      applyServerRefusal(result.error.fields, result.error.message)
      await summaryBox.value?.focus()
      return
    case 'session-expired':
    case 'reauthentication-required':
      void revalidateSession().catch(() => undefined)
      return
    default:
      return
  }
}

function commitCards(): boolean {
  let ok = true
  for (const card of cards.values()) ok = card.commit() && ok
  return ok
}

async function save(): Promise<void> {
  if (busy.value) return
  clearFeedback()
  const committed = commitCards()
  const check = validateDraftLines(lines.value)
  if (!committed || check.errors.length > 0 || check.general !== null) {
    showLineErrors(check.errors)
    if (check.general !== null) generalErrors.value = [check.general]
    else if (!committed && check.errors.length === 0) {
      generalErrors.value = ['Certaines valeurs saisies sont refusées : corrigez-les.']
    }
    await summaryBox.value?.focus()
    return
  }
  const base = baseline.value
  if (base !== null && !dirty.value) {
    nothingToSave.value = true
    return
  }
  if (base === null) {
    const payload = buildCreateDraftPayload({
      invoiceId: draftMutation.effectId('invoice_id'),
      patientId: props.patientId,
      visitId: props.visitId,
      dueDate: null,
      lines: lines.value,
    })
    lastSent = { invoiceId: payload.invoice_id, lines: payload.lines }
    await afterSave(await draftMutation.submit({ name: 'CreateInvoiceDraft', payload }), true)
    return
  }
  const payload = buildUpdateDraftPayload({
    invoiceId: base.id,
    visitId: base.visit_id,
    dueDate: base.due_date,
    lines: lines.value,
  })
  lastSent = { invoiceId: base.id, lines: payload.lines }
  await afterSave(
    await draftMutation.submit({
      name: 'UpdateDraft',
      path: { id: base.id },
      payload,
      expectedVersion: base.draft_version,
    }),
    false,
  )
}

async function retrySave(): Promise<void> {
  if (busy.value) return
  await afterSave(await draftMutation.retry(), baseline.value === null)
}

async function reloadDraft(): Promise<void> {
  const base = baseline.value
  if (reloading.value || base === null) return
  reloading.value = true
  reloadProblem.value = null
  try {
    const result = await getInvoice(base.id)
    if (result.data.status !== 'DRAFT') {
      emit('stale')
      return
    }
    latest.value = result.data
  } catch {
    reloadProblem.value =
      'Le brouillon n’a pas pu être relu (serveur indisponible ou refus) : votre saisie est conservée, réessayez.'
  } finally {
    reloading.value = false
  }
}

/** Garder sa saisie : elle partira sur la version actuelle au prochain enregistrement. */
function keepMine(): void {
  const current = latest.value
  if (current === null) return
  baseline.value = current
  savedLines.value = withKnownStock(linesFromInvoice(current))
  latest.value = null
  needsReload.value = false
}

/** Reprendre la version actuelle : la saisie de cet écran est abandonnée. */
function takeLatest(): void {
  const current = latest.value
  if (current === null) return
  afterServerInvoice(current)
  clearFeedback()
  latest.value = null
  needsReload.value = false
}

// --- Émission -------------------------------------------------------------------------------------

const confirmingIssue = ref(false)
/** Instant de la demande d'émission : fixé pour l'intention (même charge à chaque reprise). */
let issueRequestedAt: string | null = null
const issueNotice = ref<string | null>(null)

const held = computed(() => baseline.value !== null && heldByDevice(baseline.value))
/** Raisons connues de ne pas émettre, dites sous le bouton (le serveur revérifie tout). */
const issueHints = computed(() => {
  const base = baseline.value
  return base === null || dirty.value ? [] : issueBlockers(base, totals.value.total)
})
const issueReady = computed(
  () => baseline.value !== null && !dirty.value && issueHints.value.length === 0,
)

async function requestIssue(): Promise<void> {
  if (busy.value) return
  clearFeedback()
  issueNotice.value = null
  const base = baseline.value
  if (base === null) return
  if (dirty.value) {
    generalErrors.value = [
      'Enregistrez le brouillon avant de l’émettre : la facture émise est celle enregistrée.',
    ]
    await summaryBox.value?.focus()
    return
  }
  const blockers = issueBlockers(base, totals.value.total)
  if (blockers.length > 0) {
    generalErrors.value = blockers
    await summaryBox.value?.focus()
    return
  }
  confirmingIssue.value = true
}

async function afterIssue(result: MutationOutcome): Promise<void> {
  confirmingIssue.value = false
  switch (result.kind) {
    case 'synced': {
      const invoice = (result.result as InvoiceResponse).data
      savedLines.value = lines.value.map((line) => ({ ...line }))
      setSalesFlash(
        invoice.number === null ? 'Facture émise.' : `Facture émise : numéro ${invoice.number}.`,
      )
      emit('issued', invoice, false)
      return
    }
    case 'saved-local': {
      // Émise sur ce poste : numéro de la plage du poste, définitif ; le serveur la reçoit à la synchronisation.
      const base = baseline.value
      const invoice = base === null ? null : await readDeviceInvoice(base.id, 'ISSUED')
      if (invoice === null) {
        // Émise sur le poste mais non relisible ici : plus rien ne s'édite ni ne s'émet depuis cet écran.
        lockedAfterLocalIssue.value = true
        generalErrors.value = [ISSUED_NOT_READ_ON_DEVICE]
        await summaryBox.value?.focus()
        return
      }
      savedLines.value = lines.value.map((line) => ({ ...line }))
      setSalesFlash(
        invoice.number === null
          ? 'Facture émise sur ce poste, en attente de synchronisation.'
          : `Facture émise sur ce poste : numéro ${invoice.number}, en attente de synchronisation.`,
      )
      emit('issued', invoice, true)
      return
    }
    case 'conflict':
      needsReload.value = true
      return
    case 'refused': {
      const error = result.error
      if (error.code === 'STATE_TRANSITION_REFUSED') {
        emit('stale')
        return
      }
      if ('number_usage_id' in error.fields || 'document_id' in error.fields) {
        // Les identifiants de cette émission sont déjà pris : elle a probablement abouti.
        issueNotice.value =
          'Cette émission a peut-être déjà été enregistrée : la facture est relue, ne recommencez pas.'
        emit('stale')
        return
      }
      applyServerRefusal(error.fields, error.message)
      const available = error.details['available']
      if (error.code === 'STOCK_UNAVAILABLE' && available !== undefined && available !== null) {
        generalErrors.value = [
          ...generalErrors.value,
          `Stock insuffisant : disponible ${String(available)} selon le serveur.`,
        ]
      }
      const expectedTotal = error.details['expected_total']
      if (typeof expectedTotal === 'number') {
        generalErrors.value = [
          ...generalErrors.value,
          `Le serveur calcule un total de ${formatMoney(expectedTotal)} : relisez le brouillon.`,
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

async function confirmIssue(): Promise<void> {
  const base = baseline.value
  const total = totals.value.total
  if (issuing.value || base === null || total === null) return
  issueRequestedAt ??= currentInstant()
  let fingerprint: string
  try {
    fingerprint = await displayedLinesSha256(base)
  } catch {
    confirmingIssue.value = false
    generalErrors.value = [
      'Empreinte des lignes impossible à calculer sur ce navigateur (contexte non sécurisé) : rien n’a été envoyé.',
    ]
    await summaryBox.value?.focus()
    return
  }
  await afterIssue(
    await issueMutation.submit({
      name: 'IssueInvoice',
      path: { id: base.id },
      payload: buildIssuePayload({
        invoiceId: base.id,
        numberUsageId: issueMutation.effectId('number_usage_id'),
        documentId: issueMutation.effectId('document_id'),
        issuedAt: issueRequestedAt,
        totalGross: total,
        catalogSnapshotSha256: fingerprint,
      }),
      expectedVersion: base.draft_version,
    }),
  )
}

async function retryIssue(): Promise<void> {
  if (busy.value) return
  await afterIssue(await issueMutation.retry())
}

// --- Abandon du brouillon ----------------------------------------------------------------------

const ABANDON_REASON_ID = 'facture-abandon-motif'
const confirmingAbandon = ref(false)
const abandonReason = ref('')

function requestAbandon(): void {
  if (busy.value || baseline.value === null) return
  clearFeedback()
  confirmingAbandon.value = true
}

async function afterAbandon(result: MutationOutcome): Promise<void> {
  confirmingAbandon.value = false
  switch (result.kind) {
    case 'synced': {
      const invoice = (result.result as InvoiceResponse).data
      // Le formulaire n'a plus de saisie à protéger : la facture n'est plus modifiable.
      savedLines.value = lines.value.map((line) => ({ ...line }))
      setSalesFlash('Brouillon abandonné : il n’a ni numéro ni effet financier.')
      emit('abandoned', invoice)
      return
    }
    case 'conflict':
      needsReload.value = true
      return
    case 'refused':
      if (result.error.code === 'STATE_TRANSITION_REFUSED') {
        emit('stale')
        return
      }
      generalErrors.value = [result.error.message]
      await summaryBox.value?.focus()
      return
    case 'session-expired':
    case 'reauthentication-required':
      void revalidateSession().catch(() => undefined)
      return
    default:
      return
  }
}

async function confirmAbandon(): Promise<void> {
  const base = baseline.value
  if (abandoning.value || base === null) return
  const reason = abandonReason.value.trim()
  await afterAbandon(
    await abandonMutation.submit({
      name: 'AbandonInvoiceDraft',
      route: {
        method: 'POST',
        path: `/invoices/${encodeURIComponent(base.id)}/abandon`,
        expectedVersion: 'entity',
      },
      payload: { invoice_id: base.id, reason: reason === '' ? null : reason },
      expectedVersion: base.draft_version,
    }),
  )
}

async function retryAbandon(): Promise<void> {
  if (busy.value) return
  await afterAbandon(await abandonMutation.retry())
}

/** « Enregistré sur le serveur à… » tant que rien n'a changé depuis ; une nouvelle saisie l'efface. */
const saveStatus = computed(() => {
  const state = draftMutation.state.value
  if (state !== 'synced' && state !== 'saved-local') return draftMutation.saveState.value
  if (dirty.value) return 'idle'
  return state === 'synced' ? 'saved-server' : draftMutation.saveState.value
})
</script>

<template>
  <div class="space-y-6">
    <PatientIdentityHeader v-if="props.patient" :patient="props.patient" />
    <StateMessage v-else state="offline" title="Identité du patient non lue">
      La fiche du patient n’a pas pu être lue : la facture reste rattachée à son dossier, sans
      ressaisie.
    </StateMessage>

    <p class="text-base">
      <span aria-hidden="true">✎ </span>
      <template v-if="baseline">Brouillon enregistré, sans numéro définitif.</template>
      <template v-else
        >Nouveau brouillon : rien n’est enregistré tant que vous n’avez pas cliqué sur « Enregistrer
        le brouillon ».</template
      >
    </p>

    <StateMessage v-if="held" state="conflict" title="Facture détenue par un poste préparé">
      Un poste préparé détient cette facture : elle ne se modifie ni ne s’émet depuis cet écran.
    </StateMessage>

    <div :id="GENERAL_ID" tabindex="-1">
      <ErrorSummary ref="summaryBox" :errors="summary" />
    </div>

    <StateMessage
      v-if="rightsSubject && mayRequestRights"
      state="conflict"
      title="Prix ou remise au-delà de vos droits"
    >
      Ces lignes dépassent ce que votre compte peut accorder. Demandez une autorisation à la gérante
      pour exactement ces lignes ; une fois accordée, enregistrez de nouveau le brouillon sans les
      modifier.
      <template #action>
        <AppButton variant="secondary" @click="askingRights = true"
          >Demander une autorisation</AppButton
        >
      </template>
    </StateMessage>
    <StateMessage v-if="rightsRequested" state="empty" title="Autorisation demandée">{{
      rightsRequested
    }}</StateMessage>
    <ApprovalRequestDialog
      :open="askingRights"
      :subject="rightsSubject"
      summary="Prix ou remises du brouillon de facture, pour exactement les lignes affichées."
      @requested="rightsRequestSent"
      @cancel="askingRights = false"
    />

    <StateMessage v-if="needsReload" state="conflict" title="Le brouillon a changé entre-temps">
      <p>
        Quelqu’un a modifié ce brouillon pendant votre saisie. Votre saisie est conservée. Relisez
        la version actuelle avant de choisir.
      </p>
      <p v-if="reloadProblem" class="mt-2 font-medium">{{ reloadProblem }}</p>
      <template v-if="latest">
        <p class="mt-2">
          Version actuelle : {{ latest.lines.length }} ligne{{
            latest.lines.length > 1 ? 's' : ''
          }}, total {{ formatMoney(latest.total_gross) }}.
        </p>
      </template>
      <template #action>
        <div class="flex flex-wrap gap-3">
          <AppButton
            v-if="latest === null"
            variant="primary"
            :pending="reloading"
            pending-label="Lecture…"
            @click="reloadDraft"
            >Relire le brouillon</AppButton
          >
          <template v-else>
            <AppButton variant="primary" @click="keepMine">Garder ma saisie</AppButton>
            <AppButton variant="secondary" @click="takeLatest"
              >Reprendre la version actuelle</AppButton
            >
          </template>
        </div>
      </template>
    </StateMessage>

    <StateMessage v-if="draftFailure" :state="draftFailure.state" :title="draftFailure.title">
      {{ draftMutation.failureMessage.value }}
      <template v-if="draftFailure.retry" #action>
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

    <StateMessage v-if="issueNotice" state="offline" title="Émission peut-être déjà faite">
      {{ issueNotice }}
    </StateMessage>

    <StateMessage v-if="abandonFailure" :state="abandonFailure.state" :title="abandonFailure.title">
      {{ abandonMutation.failureMessage.value }}
      <template v-if="abandonFailure.retry" #action>
        <AppButton variant="secondary" :pending="abandoning" @click="retryAbandon"
          >Réessayer l’abandon</AppButton
        >
      </template>
    </StateMessage>

    <form novalidate aria-labelledby="titre-lignes" class="space-y-4" @submit.prevent="save">
      <h2 id="titre-lignes" class="text-lg font-semibold">Lignes de la facture</h2>

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
        Ajoutez un article du catalogue pour commencer la facture.
      </StateMessage>

      <CatalogPicker :control-id="CATALOG_ID" :disabled="busy" @pick="addItem" />
      <AppButton v-if="priceAuthority" variant="secondary" :disabled="busy" @click="addFreeLine"
        >Ajouter une ligne hors catalogue</AppButton
      >

      <div
        class="rounded-xl border border-line bg-surface shadow-card p-4"
        role="group"
        aria-label="Total du brouillon"
      >
        <p class="text-base font-semibold" aria-live="polite">
          Total TTC :
          <span class="text-2xl font-bold tabular-nums" data-montant="total">{{
            totals.total === null ? 'à compléter' : formatMoney(totals.total)
          }}</span>
        </p>
        <p v-if="totals.totalError" class="text-sm font-medium text-danger">
          <span aria-hidden="true">⚠ </span>{{ totals.totalError }}
        </p>
        <p class="mt-1 text-sm text-muted">
          Montants toutes taxes comprises, calculés par les règles partagées avec le serveur, qui
          les recalcule. La taxe comprise est ventilée par le serveur selon les règles fiscales
          validées.
        </p>
      </div>

      <p v-if="nothingToSave" role="status" class="text-base">Aucune modification à enregistrer.</p>

      <div class="flex flex-wrap items-center gap-3">
        <AppButton type="submit" :pending="saving" pending-label="Enregistrement en cours…"
          >Enregistrer le brouillon</AppButton
        >
        <AppButton
          v-if="canIssue && baseline"
          variant="secondary"
          :disabled="!issueReady || saving || lockedAfterLocalIssue"
          :pending="issuing"
          pending-label="Émission en cours…"
          @click="requestIssue"
          >Émettre la facture</AppButton
        >
        <AppButton
          v-if="canAbandon && baseline && !props.local"
          variant="ghost"
          :disabled="busy"
          :pending="abandoning"
          pending-label="Abandon en cours…"
          @click="requestAbandon"
          >Abandonner le brouillon</AppButton
        >
        <SaveStatus :state="saveStatus" :at="savedAt" :time-zone="timeZone" />
      </div>
      <p v-if="canIssue && baseline && dirty" class="text-sm text-muted">
        Enregistrez le brouillon avant de l’émettre.
      </p>
      <ul
        v-else-if="canIssue && issueHints.length > 0"
        class="list-disc space-y-1 pl-5 text-sm text-muted"
      >
        <li v-for="hint in issueHints" :key="hint">{{ hint }}</li>
      </ul>
    </form>

    <ConfirmDialog
      :open="confirmingIssue"
      title="Émettre la facture ?"
      confirm-label="Émettre la facture"
      pending-label="Émission en cours…"
      :pending="issuing"
      tone="danger"
      @confirm="confirmIssue"
      @cancel="confirmingIssue = false"
    >
      <p>
        Total TTC :
        <strong>{{ totals.total === null ? '—' : formatMoney(totals.total) }}</strong> ({{
          lines.length
        }}
        ligne{{ lines.length > 1 ? 's' : '' }}).
      </p>
      <p class="mt-2">
        <strong>La facture émise ne pourra plus être modifiée.</strong> Elle reçoit un numéro
        définitif (attribué par le serveur ; sur un poste préparé sans connexion, pris dans la plage
        de ce poste et jamais renuméroté) et le stock des articles stockés est réservé ; une erreur
        se corrigera par un avoir.
      </p>
    </ConfirmDialog>

    <ConfirmDialog
      :open="confirmingAbandon"
      title="Abandonner ce brouillon ?"
      confirm-label="Abandonner le brouillon"
      pending-label="Abandon en cours…"
      :pending="abandoning"
      tone="danger"
      :initial-focus="`#${ABANDON_REASON_ID}`"
      @confirm="confirmAbandon"
      @cancel="confirmingAbandon = false"
    >
      <p>
        Le brouillon ne pourra plus être modifié ni émis. Il n’a pas de numéro : rien d’autre ne
        change (ni stock, ni pièce). Il reste visible dans la liste des factures.
      </p>
      <div class="mt-3">
        <TextAreaField
          v-model="abandonReason"
          label="Motif (facultatif)"
          hint="Conservé dans le journal d’audit."
          :control-id="ABANDON_REASON_ID"
          :maxlength="1000"
          :rows="3"
        />
      </div>
    </ConfirmDialog>
  </div>
</template>
