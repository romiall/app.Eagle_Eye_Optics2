import { computed, ref, shallowRef, watch } from 'vue'

import { getConsultation, getVisualAcuityScales } from '@/app/services/consultations'
import type { MutationOutcome } from '@/app/services/mutations'
import { useMutation } from '@/app/services/useMutation'
import { canOnScreen, revalidateSession } from '@/app/session'
import type { FieldErrorItem } from '@/components/feedback/ErrorSummary.vue'
import {
  completionReasonError,
  type CompletionSummary,
  completionSummary,
} from '@/domain/clinical/completion'
import { CONTROL_IDS } from '@/domain/clinical/controls'
import { cleanText } from '@/domain/clinical/fields'
import {
  DELIVERED_STEPS,
  type DeliveredStep,
  STEP_TITLES,
  workStatusLabel,
} from '@/domain/clinical/labels'
import {
  buildAmendPayload,
  buildCompletePayload,
  buildSaveStepPayload,
  consultationFromResult,
} from '@/domain/clinical/payload'
import { type RebaseConflict, rebaseConsultation } from '@/domain/clinical/rebase'
import { serverErrorTarget, serverFieldErrors } from '@/domain/clinical/serverErrors'
import { canonicalHash, stepsDigest } from '@/domain/clinical/snapshot'
import {
  blankDrafts,
  draftFromData,
  isStepDirty,
  type StepDataByName,
  type StepDrafts,
  type StepError,
  validateStep,
} from '@/domain/clinical/steps'
import type { Consultation, VisualAcuityScale } from '@/domain/contracts/generated'
import { newUlid } from '@/domain/values/ulid'

import { failureView } from './failureView'
import { useClinicalRead } from './useClinicalRead'

/** Conflit signalé après « Recharger la consultation » : valeur modifiée des deux côtés. */
export interface RebaseNotice {
  version: number
  conflicts: (RebaseConflict & { step: DeliveredStep })[]
}

/** Identifiant du champ « motif de la correction » et de celui de la justification d'absence. */
export const AMEND_REASON_ID = 'correction-motif'
export const FINISH_REASON_ID = 'terminer-justification'

/** Opération en cours autre que l'enregistrement d'une étape. */
type Operation = 'complete' | 'amend'

const MIN_REASON = 3

function setDraft<S extends DeliveredStep>(
  target: StepDrafts,
  step: S,
  value: StepDrafts[S],
): void {
  target[step] = value
}

function draftsFrom(consultation: Consultation): StepDrafts {
  const next = blankDrafts()
  const steps = consultation.steps as unknown as { [S in DeliveredStep]: StepDataByName[S] }
  const assign = <S extends DeliveredStep>(step: S): void => {
    setDraft(next, step, draftFromData(step, steps[step]))
  }
  for (const step of DELIVERED_STEPS) assign(step)
  return next
}

/**
 * Saisie d'une consultation par étapes (C01 à C04), EN LIGNE : lecture de la consultation, brouillons des
 * sept rubriques, enregistrement étape par étape, conflit de version, finalisation et correction.
 *
 * - Une étape n'est dite enregistrée qu'après la RÉPONSE du serveur (`synced`) : le brouillon repart
 *   alors de ce que le serveur a renvoyé. Rien n'est conservé dans le navigateur.
 * - « Suivant » valide et enregistre l'étape avant d'avancer ; « Précédent » et le choix d'une étape
 *   ne perdent aucune saisie (les brouillons restent en mémoire).
 * - L'étape est REMPLACÉE en entier par le serveur : la version attendue est celle de la
 *   consultation lue (une version pour tout l'agrégat). Un conflit (409) garde la saisie ; « Recharger
 *   la consultation » la rebase valeur par valeur sur la version actuelle (voir `domain/clinical/rebase`)
 *   et signale ce qui a changé des deux côtés.
 * - Un refus 422 par champ (`step.data.complaints.0.other_text`) s'affiche sous le champ et dans le
 *   résumé d'erreurs.
 * - « Terminer l'examen » (C03) fige la révision 1 : confirmation, récapitulatif des rubriques non
 *   renseignées (jamais transformées en « Aucun »), justification d'absence si le motif/les plaintes ou la
 *   conclusion manquent. Une consultation terminée est en LECTURE SEULE.
 * - « Corriger » (C03, `clinical.amend`) rouvre la saisie avec un motif obligatoire ; « Enregistrer la
 *   correction » envoie les rubriques modifiées en UNE révision immuable, les révisions antérieures restent
 *   lisibles.
 */
export function useConsultationEditor(consultationId: string) {
  const read = useClinicalRead<Consultation>(() => getConsultation(consultationId))
  const scalesRead = useClinicalRead<VisualAcuityScale[]>(() => getVisualAcuityScales())
  const mutation = useMutation()

  /** Consultation telle que le serveur l'a donnée (à l'ouverture, puis à chaque réponse). */
  const baseline = shallowRef<Consultation | null>(null)
  const drafts = ref<StepDrafts>(blankDrafts())
  const current = ref<DeliveredStep>('ANAMNESIS')
  const errors = ref<StepError[]>([])
  const notice = ref<string | null>(null)
  const announcement = ref('')
  const needsReload = ref(false)
  const reloading = ref(false)
  const rebased = ref<RebaseNotice | null>(null)
  /** Étape en cours d'enregistrement (ou en attente d'une reprise), et si « Suivant » l'a demandée. */
  const pending = ref<{ step: DeliveredStep; advance: boolean } | null>(null)
  /** Résumé d'erreurs (composant `ErrorSummary`, exposé par l'écran pour le focaliser). */
  const summaryBox = ref<{ focus: () => Promise<void> } | null>(null)

  /** Finalisation : boîte de confirmation, justification d'absence, erreur. */
  const finishOpen = ref(false)
  const finishReason = ref('')
  const finishError = ref<string | null>(null)
  /** Correction : mode actif, motif, erreur du motif. */
  const amending = ref(false)
  const amendReason = ref('')
  const amendReasonError = ref<string | null>(null)
  const operation = ref<Operation | null>(null)

  watch(
    read.data,
    (consultation) => {
      if (consultation === null || baseline.value !== null || consultation.id !== consultationId) {
        return
      }
      baseline.value = consultation
      drafts.value = draftsFrom(consultation)
    },
    { immediate: true },
  )

  const completed = computed(() => baseline.value?.status === 'COMPLETED')
  const canWrite = computed(() => canOnScreen('clinical.write'))
  const canComplete = computed(() => canOnScreen('clinical.complete'))
  const canAmend = computed(() => canOnScreen('clinical.amend'))
  const readOnly = computed(() => (completed.value ? !amending.value : !canWrite.value))
  const busy = computed(() => mutation.state.value === 'saving' || reloading.value)

  const scales = computed<readonly VisualAcuityScale[]>(() => scalesRead.data.value ?? [])
  const scalesReady = computed(() => scalesRead.state.value === 'ready')

  function dirtyOf(step: DeliveredStep): boolean {
    const saved = baseline.value
    if (saved === null) return false
    const data = saved.steps as unknown as { [S in DeliveredStep]: StepDataByName[S] }
    return isStepDirty(step, drafts.value[step], data[step] as never)
  }

  /**
   * Vrai quand SEUL l'écart pupillaire total du centrage a changé depuis la dernière lecture : il se saisit
   * dans le bloc de l'autoréfracteur (étape « Réfraction ») et s'enregistre alors avec elle, sans repasser par
   * le centrage. Toute autre saisie du centrage reste à enregistrer depuis son étape.
   */
  function pdOnlyDirty(): boolean {
    const saved = baseline.value
    if (saved === null || !dirtyOf('CENTERING')) return false
    const data = (saved.steps as unknown as { CENTERING: StepDataByName['CENTERING'] }).CENTERING
    const total = draftFromData('CENTERING', data).pdTotal
    return !isStepDirty('CENTERING', { ...drafts.value.CENTERING, pdTotal: total }, data)
  }

  const dirtySteps = computed(() => DELIVERED_STEPS.filter((step) => dirtyOf(step)))
  const currentDirty = computed(() => !readOnly.value && dirtyOf(current.value))
  const anyDirty = computed(() => !readOnly.value && dirtySteps.value.length > 0)

  const stepIndex = computed(() => DELIVERED_STEPS.indexOf(current.value))
  const isFirst = computed(() => stepIndex.value === 0)
  const isLast = computed(() => stepIndex.value === DELIVERED_STEPS.length - 1)

  // --- Finalisation : récapitulatif -----------------------------------------------------------------

  const summary_ = computed<CompletionSummary | null>(() =>
    baseline.value === null
      ? null
      : completionSummary(
          baseline.value.steps as unknown as Parameters<typeof completionSummary>[0],
        ),
  )
  /** Pourquoi « Terminer l'examen » n'est pas proposé tout de suite (null : il l'est). */
  const finishBlocked = computed<string | null>(() => {
    if (baseline.value === null || baseline.value.status !== 'IN_PROGRESS') {
      return baseline.value?.status === 'DRAFT'
        ? 'Enregistrez au moins une étape avant de terminer l’examen.'
        : null
    }
    if (dirtySteps.value.length > 0) {
      return 'Enregistrez d’abord les étapes modifiées : seul ce qui est enregistré est figé.'
    }
    return null
  })
  const canFinish = computed(
    () =>
      canComplete.value &&
      baseline.value?.status === 'IN_PROGRESS' &&
      !amending.value &&
      !needsReload.value,
  )

  // --- Erreurs ------------------------------------------------------------------------------------

  /** Message par contrôle, pour les champs de l'étape affichée. */
  const errorMap = computed<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const error of errors.value) {
      map[error.controlId] =
        map[error.controlId] === undefined
          ? error.message
          : `${map[error.controlId]} ${error.message}`
    }
    return map
  })
  const summary = computed<FieldErrorItem[]>(() =>
    errors.value.map((error) => ({ fieldId: error.controlId, message: error.message })),
  )

  // Une erreur affichée se met à jour à mesure que la saisie change ; sans erreur, rien n'est évalué.
  watch(
    () => drafts.value[current.value],
    () => {
      notice.value = null
      if (errors.value.length === 0) return
      const result = validateStep(current.value, drafts.value[current.value] as never)
      errors.value = result.ok ? [] : result.errors
    },
    { deep: true },
  )

  async function showErrors(items: StepError[]): Promise<void> {
    errors.value = items
    await summaryBox.value?.focus()
  }

  // --- Navigation ---------------------------------------------------------------------------------

  function goTo(step: DeliveredStep): void {
    if (busy.value || step === current.value) return
    current.value = step
    errors.value = []
    notice.value = null
    announcement.value = `Étape ${DELIVERED_STEPS.indexOf(step) + 1} sur ${DELIVERED_STEPS.length} : ${STEP_TITLES[step]}`
  }

  function previous(): void {
    const target = DELIVERED_STEPS[stepIndex.value - 1]
    if (target !== undefined) goTo(target)
  }

  function advance(): void {
    const target = DELIVERED_STEPS[stepIndex.value + 1]
    if (target !== undefined) goTo(target)
  }

  // --- Enregistrement -----------------------------------------------------------------------------

  /** Reprend ce que le serveur a renvoyé : l'étape enregistrée repart de sa réponse, les autres gardent leur saisie. */
  function adopt(next: Consultation, savedStep: DeliveredStep | null): void {
    const before = baseline.value
    const fresh = draftsFrom(next)
    const merged = blankDrafts()
    const assign = <S extends DeliveredStep>(step: S): void => {
      const beforeData =
        before === null
          ? null
          : (before.steps as unknown as { [T in DeliveredStep]: StepDataByName[T] })[step]
      const take =
        step === savedStep ||
        before === null ||
        beforeData === null ||
        !isStepDirty(step, drafts.value[step], beforeData as never)
      setDraft(merged, step, take ? fresh[step] : drafts.value[step])
    }
    for (const step of DELIVERED_STEPS) assign(step)
    baseline.value = next
    drafts.value = merged
  }

  /** Relit la consultation sur le serveur quand la réponse d'une commande n'a pas la forme attendue. */
  async function reconcile(savedStep: DeliveredStep | null): Promise<void> {
    await read.reload()
    const latest = read.data.value
    if (read.state.value === 'ready' && latest !== null && latest.id === consultationId) {
      adopt(latest, savedStep)
    }
  }

  /** Donnée envoyée par la dernière commande : les erreurs 422 du serveur s'y rapportent (indices de lignes). */
  let lastSent: { step: DeliveredStep; data: StepDataByName[DeliveredStep] } | null = null
  /** Rubriques de la dernière correction envoyée (les erreurs `steps.N.data.…` s'y rapportent). */
  let lastAmended: { step: DeliveredStep; data: StepDataByName[DeliveredStep] }[] = []

  /** Erreurs 422 d'une finalisation ou d'une correction : le message est rendu près du bouton concerné. */
  async function showOperationErrors(
    kind: Operation,
    fields: Readonly<Record<string, readonly string[]>>,
  ): Promise<void> {
    const items: StepError[] = []
    const messages: string[] = []
    for (const [key, list] of Object.entries(fields)) {
      const stepMatch = /^steps\.([0-9]+)\.data\.(.*)$/.exec(key)
      const complete = /^steps\.([A-Z_]+)/.exec(key)
      for (const message of list) {
        if (kind === 'amend' && stepMatch !== null) {
          const sent = lastAmended[Number(stepMatch[1])]
          if (sent !== undefined) {
            items.push({
              path: key,
              controlId: serverErrorTarget(
                sent.step,
                sent.data as never,
                `step.data.${stepMatch[2] ?? ''}`,
              ),
              message: `${STEP_TITLES[sent.step]} : ${message}`,
            })
            continue
          }
        }
        if (kind === 'complete' && complete !== null) {
          messages.push(
            `${STEP_TITLES[(complete[1] ?? 'ANAMNESIS') as DeliveredStep] ?? 'Rubrique'} : ${message}`,
          )
          continue
        }
        messages.push(message)
      }
    }
    if (kind === 'amend') {
      if ('reason' in fields) amendReasonError.value = (fields['reason'] ?? []).join(' ')
      const first = items[0]
      if (first !== undefined) {
        const owner = lastAmended.find((sent) =>
          first.message.startsWith(`${STEP_TITLES[sent.step]} :`),
        )
        if (owner !== undefined) goTo(owner.step)
        await showErrors(items)
      } else if (messages.length > 0) {
        notice.value = messages.join(' ')
      }
      return
    }
    finishError.value = messages.join(' ')
  }

  async function afterOutcome(outcome: MutationOutcome): Promise<void> {
    const step = pending.value
    const kind = operation.value
    switch (outcome.kind) {
      case 'synced': {
        const next = consultationFromResult(outcome.result)
        if (kind !== null) {
          if (next !== null && next.id === consultationId) adopt(next, null)
          else await reconcile(null)
          if (kind === 'complete') {
            finishOpen.value = false
            finishReason.value = ''
            finishError.value = null
          } else {
            amending.value = false
            amendReason.value = ''
            amendReasonError.value = null
            lastAmended = []
          }
          operation.value = null
          errors.value = []
          rebased.value = null
          return
        }
        if (step !== null) {
          if (next !== null && next.id === consultationId) adopt(next, step.step)
          else await reconcile(step.step)
        }
        errors.value = []
        rebased.value = null
        pending.value = null
        if (step?.advance === true) advance()
        return
      }
      case 'conflict':
        needsReload.value = true
        if (kind === 'complete') finishOpen.value = false
        return
      case 'refused': {
        if (outcome.error.status === 422 && kind !== null) {
          await showOperationErrors(kind, outcome.error.fields)
          return
        }
        if (outcome.error.status === 422 && lastSent !== null) {
          const items = serverFieldErrors(
            lastSent.step,
            lastSent.data as never,
            outcome.error.fields,
          )
          if (items.length > 0) {
            await showErrors(
              items.map((item) => ({ path: '', controlId: item.controlId, message: item.message })),
            )
          }
        }
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

  async function run(step: DeliveredStep, advanceAfter: boolean): Promise<void> {
    const saved = baseline.value
    if (busy.value || saved === null || readOnly.value || needsReload.value) return
    notice.value = null
    const validation = validateStep(step, drafts.value[step] as never)
    if (!validation.ok) {
      await showErrors(validation.errors)
      return
    }
    // L'écart pupillaire saisi dans le bloc de l'autoréfracteur est enregistré avec la réfraction (deux
    // commandes, l'une après la réponse de l'autre) : il est vérifié AVANT d'envoyer quoi que ce soit.
    const withCentering = step === 'REFRACTION' && pdOnlyDirty()
    if (withCentering) {
      const centering = validateStep('CENTERING', drafts.value.CENTERING)
      if (!centering.ok) {
        // Une erreur sur le seul écart total se lit sous son champ ; toute autre mène à l'étape « Centrage ».
        if (centering.errors.some((error) => error.controlId !== CONTROL_IDS.pdTotal)) {
          goTo('CENTERING')
        }
        await showErrors(centering.errors)
        return
      }
    }
    errors.value = []
    if (!dirtyOf(step)) {
      if (withCentering) await run('CENTERING', advanceAfter)
      else if (advanceAfter) advance()
      else notice.value = 'Aucune modification à enregistrer sur cette étape.'
      return
    }
    operation.value = null
    pending.value = { step, advance: advanceAfter && !withCentering }
    lastSent = { step, data: validation.data as StepDataByName[DeliveredStep] }
    rebased.value = null
    await afterOutcome(
      await mutation.submit({
        name: 'SaveClinicalStep',
        path: { id: consultationId, step },
        payload: buildSaveStepPayload(consultationId, step, validation.data as never),
        expectedVersion: saved.version,
      }),
    )
    // Le centrage suit la réfraction une fois celle-ci enregistrée par le serveur (rien, sinon).
    if (withCentering && pending.value === null && !needsReload.value) {
      await run('CENTERING', advanceAfter)
    }
  }

  /** « Enregistrer » : valide et enregistre l'étape affichée. */
  function save(): Promise<void> {
    return run(current.value, false)
  }

  /** « Suivant » : valide et enregistre l'étape affichée, puis avance seulement si le serveur a répondu. */
  function saveAndAdvance(): Promise<void> {
    return run(current.value, true)
  }

  /** « Réessayer l'enregistrement » : même commande, même clé d'idempotence. */
  async function retry(): Promise<void> {
    if (busy.value || (pending.value === null && operation.value === null)) return
    await afterOutcome(await mutation.retry())
  }

  /** Relit la consultation et rebase la saisie sur la version actuelle (voir `rebaseConsultation`). */
  async function reloadFromServer(): Promise<void> {
    if (reloading.value) return
    reloading.value = true
    try {
      await read.reload()
      const latest = read.data.value
      const base = baseline.value
      if (read.state.value !== 'ready' || latest === null || latest.id !== consultationId) return
      if (base === null) return
      const result = rebaseConsultation(
        base.steps as unknown as Parameters<typeof rebaseConsultation>[0],
        latest.steps as unknown as Parameters<typeof rebaseConsultation>[1],
        drafts.value,
      )
      baseline.value = latest
      drafts.value = result.drafts
      needsReload.value = false
      pending.value = null
      operation.value = null
      errors.value = []
      if (latest.status === 'COMPLETED' && base.status !== 'COMPLETED') amending.value = false
      rebased.value = {
        version: latest.version,
        conflicts: DELIVERED_STEPS.flatMap((step) =>
          result.conflicts[step].map((conflict) => ({ ...conflict, step })),
        ),
      }
    } finally {
      reloading.value = false
    }
  }

  // --- Finalisation (C03) ---------------------------------------------------------------------------

  function openFinish(): void {
    if (busy.value || !canFinish.value || finishBlocked.value !== null) return
    finishError.value = null
    finishOpen.value = true
  }

  function closeFinish(): void {
    if (busy.value) return
    finishOpen.value = false
    finishError.value = null
  }

  async function confirmFinish(): Promise<void> {
    const saved = baseline.value
    const recap = summary_.value
    if (busy.value || saved === null || recap === null || !canFinish.value) return
    const reasonError = completionReasonError(recap, finishReason.value)
    if (reasonError !== null) {
      finishError.value = reasonError
      document.getElementById(FINISH_REASON_ID)?.focus()
      return
    }
    finishError.value = null
    let digest: string
    try {
      digest = await stepsDigest(saved.steps)
    } catch (error) {
      finishError.value =
        error instanceof Error ? error.message : 'L’empreinte du dossier n’a pas pu être calculée.'
      return
    }
    pending.value = null
    operation.value = 'complete'
    rebased.value = null
    await afterOutcome(
      await mutation.submit({
        name: 'CompleteConsultation',
        path: { id: consultationId },
        payload: buildCompletePayload(
          consultationId,
          newUlid(),
          digest,
          cleanText(finishReason.value),
        ),
        expectedVersion: saved.version,
      }),
    )
  }

  // --- Correction (C03) -----------------------------------------------------------------------------

  function startAmend(): void {
    if (busy.value || !completed.value || !canAmend.value) return
    amending.value = true
    amendReason.value = ''
    amendReasonError.value = null
    notice.value = null
  }

  /** Abandonne la correction : les saisies non envoyées sont perdues (confirmation demandée par l'écran). */
  function cancelAmend(): void {
    if (busy.value) return
    const saved = baseline.value
    amending.value = false
    amendReason.value = ''
    amendReasonError.value = null
    errors.value = []
    notice.value = null
    if (saved !== null) drafts.value = draftsFrom(saved)
  }

  async function submitAmend(): Promise<void> {
    const saved = baseline.value
    if (busy.value || saved === null || !amending.value || needsReload.value) return
    notice.value = null
    amendReasonError.value = null
    const reason = cleanText(amendReason.value)
    const changed = DELIVERED_STEPS.filter((step) => dirtyOf(step))

    const sent: { step: DeliveredStep; data: StepDataByName[DeliveredStep] }[] = []
    for (const step of changed) {
      const validation = validateStep(step, drafts.value[step] as never)
      if (!validation.ok) {
        goTo(step)
        await showErrors(validation.errors)
        return
      }
      sent.push({ step, data: validation.data as StepDataByName[DeliveredStep] })
    }
    errors.value = []
    if (sent.length === 0) {
      notice.value = 'Aucune modification à enregistrer : modifiez au moins une étape.'
      return
    }
    if (reason === null || [...reason].length < MIN_REASON) {
      amendReasonError.value = `Le motif de la correction est obligatoire (${MIN_REASON} caractères au moins).`
      document.getElementById(AMEND_REASON_ID)?.focus()
      return
    }

    const steps = sent.map(({ step, data }) => ({ step, data: data as object }))
    let digest: string
    try {
      digest = await canonicalHash(steps)
    } catch (error) {
      notice.value =
        error instanceof Error
          ? error.message
          : 'L’empreinte de la correction n’a pas pu être calculée.'
      return
    }
    const payload = buildAmendPayload(saved, newUlid(), reason, steps, digest)
    if (payload === null) {
      notice.value = 'Cette consultation ne porte aucune révision : elle ne peut pas être corrigée.'
      return
    }
    lastAmended = sent
    pending.value = null
    operation.value = 'amend'
    rebased.value = null
    await afterOutcome(
      await mutation.submit({
        name: 'AmendConsultation',
        path: { id: consultationId },
        payload,
        expectedVersion: saved.version,
      }),
    )
  }

  // --- État affiché -------------------------------------------------------------------------------

  const failure = computed(() => failureView(mutation.state.value, mutation.error.value))
  /** Ce qu'on enregistre, pour les messages d'échec (« Étape … », « Finalisation », « Correction »). */
  const operationTitle = computed(() => {
    if (operation.value === 'complete') return 'Finalisation'
    if (operation.value === 'amend') return 'Correction'
    return pending.value === null ? '' : `Étape « ${STEP_TITLES[pending.value.step]} »`
  })

  /** « Enregistré sur le serveur » seulement après la réponse, et tant qu'aucune saisie n'a suivi. */
  const saveStatus = computed(() => {
    switch (mutation.state.value) {
      case 'saving':
        return 'saving' as const
      case 'synced':
        return currentDirty.value ? ('idle' as const) : ('saved-server' as const)
      case 'idle':
        return 'idle' as const
      case 'saved-local':
        return 'saved-local' as const
      case 'conflict':
        return needsReload.value ? ('failed' as const) : ('idle' as const)
      default:
        return 'failed' as const
    }
  })

  const statusLabel = computed(() =>
    baseline.value === null ? '' : workStatusLabel(baseline.value.status),
  )

  return {
    read,
    mutation,
    baseline,
    drafts,
    current,
    errors,
    errorMap,
    summary,
    summaryBox,
    notice,
    announcement,
    needsReload,
    reloading,
    rebased,
    pending,
    operation,
    operationTitle,
    completed,
    canWrite,
    canComplete,
    canAmend,
    readOnly,
    busy,
    scales,
    scalesReady,
    dirtySteps,
    currentDirty,
    anyDirty,
    stepIndex,
    isFirst,
    isLast,
    failure,
    saveStatus,
    statusLabel,
    completionRecap: summary_,
    finishBlocked,
    canFinish,
    finishOpen,
    finishReason,
    finishError,
    amending,
    amendReason,
    amendReasonError,
    goTo,
    previous,
    advance,
    save,
    saveAndAdvance,
    retry,
    reloadFromServer,
    openFinish,
    closeFinish,
    confirmFinish,
    startAmend,
    cancelAmend,
    submitAmend,
  }
}
