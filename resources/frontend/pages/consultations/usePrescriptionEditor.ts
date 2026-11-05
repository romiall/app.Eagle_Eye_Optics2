import { computed, ref, shallowRef, watch } from 'vue'

import { clinicToday } from '@/app/clinicTime'
import {
  getConsultation,
  getConsultationPrescriptions,
  getPatientPrescriptions,
  getPrescription,
} from '@/app/services/consultations'
import type { MutationOutcome } from '@/app/services/mutations'
import { useMutation } from '@/app/services/useMutation'
import { canOnScreen, knownAccountId, revalidateSession } from '@/app/session'
import type { FieldErrorItem } from '@/components/feedback/ErrorSummary.vue'
import { canDeletePrescriptionDraft } from '@/domain/clinical/draftDeletion'
import type { StepError } from '@/domain/clinical/fields'
import type { MeasurementData, RefractionStage } from '@/domain/clinical/refraction'
import {
  blankPrescription,
  buildCreatePayload,
  buildDraftChanges,
  buildValidatePayload,
  copyCentering,
  copyRefraction,
  isPrescriptionDirty,
  type PrescriptionDifference,
  prescriptionDifferences,
  type PrescriptionDraft,
  prescriptionDraft,
  prescriptionErrors,
  prescriptionErrorTarget,
  type RuleLevel,
  todayIso,
  withNewIds,
} from '@/domain/clinical/prescriptions'
import type { Consultation, Prescription } from '@/domain/contracts/generated'

import { useClinicalRead } from './useClinicalRead'

/** Ce que l'écran édite : une première prescription, un brouillon enregistré, ou une nouvelle version. */
export type PrescriptionMode = 'idle' | 'new' | 'edit' | 'revise'

/**
 * Prescriptions éditées : celles d'une consultation (internes), ou les ordonnances EXTERNES transcrites d'un
 * patient (sans consultation : prescripteur et date d'origine obligatoires). Une chaîne désigne une consultation.
 */
export type PrescriptionSource =
  | string
  | { readonly kind: 'consultation'; readonly consultationId: string }
  | { readonly kind: 'external'; readonly patientId: string }

function prescriptionFromResult(result: unknown): Prescription | null {
  const data =
    typeof result === 'object' && result !== null && 'data' in result
      ? (result as { data: unknown }).data
      : null
  return typeof data === 'object' && data !== null && Array.isArray((data as Prescription).eyes)
    ? (data as Prescription)
    : null
}

/**
 * Prescription optique d'une consultation (C04), EN LIGNE : liste des versions, brouillon, nouvelle version,
 * validation. Une prescription n'est dite enregistrée qu'après la RÉPONSE du serveur ; rien n'est conservé dans le
 * navigateur.
 *
 * - La première prescription d'une consultation crée un brouillon (version 1 d'une nouvelle série) ; la
 *   correction d'une version VALIDÉE est une NOUVELLE version (les anciennes restent lisibles et inchangées).
 * - Un brouillon se modifie avec le jeton `updated_at` : un conflit garde la saisie et montre les champs modifiés
 *   par une autre personne avant tout nouvel enregistrement.
 * - « Valider » exige un brouillon enregistré sans modification en attente ; la prescription validée est
 *   immuable ; le PDF est préparé (en attente) et généré par le moteur de documents, jamais ici.
 * - Copier la réfraction ou le centrage dans la prescription est un geste explicite (confirmation de l'écran).
 */
export function usePrescriptionEditor(source: PrescriptionSource) {
  const scope =
    typeof source === 'string'
      ? ({ kind: 'consultation', consultationId: source } as const)
      : source
  const consultationId = scope.kind === 'consultation' ? scope.consultationId : null
  const external = scope.kind === 'external'
  // Une ordonnance externe n'a pas de consultation : rien à lire (et rien à recopier de la réfraction).
  const consultationRead = useClinicalRead<Consultation | null>(() =>
    consultationId === null
      ? Promise.resolve({
          data: null,
          freshness: { serverAsOf: new Date().toISOString(), complete: true },
          live: true,
        })
      : getConsultation(consultationId),
  )
  const listRead = useClinicalRead<Prescription[]>(async () => {
    if (scope.kind === 'consultation') return getConsultationPrescriptions(scope.consultationId)
    const read = await getPatientPrescriptions(scope.patientId)
    return { ...read, data: read.data.filter((prescription) => prescription.origin === 'EXTERNAL') }
  })
  const mutation = useMutation()

  const mode = ref<PrescriptionMode>('idle')
  const draft = ref<PrescriptionDraft | null>(null)
  /** Prescription enregistrée en cours d'édition (brouillon) ; null pour une création. */
  const saved = shallowRef<Prescription | null>(null)
  const errors = ref<StepError[]>([])
  const notice = ref<string | null>(null)
  const summaryBox = ref<{ focus: () => Promise<void> } | null>(null)
  const conflict = ref<PrescriptionDifference[] | null>(null)
  const pendingKind = ref<'save' | 'validate' | null>(null)

  const consultation = computed(() => consultationRead.data.value)
  const list = computed(() => listRead.data.value ?? [])
  const latest = computed(() => list.value[0] ?? null)
  const canWrite = computed(() => canOnScreen('clinical.write'))
  const canAmend = computed(() => canOnScreen('clinical.amend'))
  const canValidate = computed(() => canOnScreen('clinical.complete'))
  const busy = computed(() => mutation.state.value === 'saving')

  // Ouverture : un brouillon enregistré s'ouvre pour édition.
  watch(
    list,
    (versions) => {
      if (mode.value !== 'idle') return
      const first = versions[0]
      if (first !== undefined && first.status === 'DRAFT') {
        mode.value = 'edit'
        saved.value = first
        draft.value = prescriptionDraft(first)
      }
    },
    { immediate: true },
  )

  const dirty = computed(() => {
    if (draft.value === null) return false
    if (mode.value === 'edit' && saved.value !== null)
      return isPrescriptionDirty(draft.value, saved.value)
    return mode.value === 'new' || mode.value === 'revise'
  })

  const today = (): string => todayIso(clinicToday())

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

  async function showErrors(items: StepError[]): Promise<void> {
    errors.value = items
    await summaryBox.value?.focus()
  }

  function check(level: RuleLevel): StepError[] {
    return draft.value === null ? [] : prescriptionErrors(draft.value, level, today())
  }

  // Une erreur affichée se met à jour à mesure que la saisie change.
  watch(
    draft,
    () => {
      notice.value = null
      if (errors.value.length === 0) return
      errors.value = check(pendingKind.value === 'validate' ? 'validate' : 'draft')
    },
    { deep: true },
  )

  function startNew(): void {
    if (busy.value || !canWrite.value) return
    mutation.reset()
    mode.value = 'new'
    saved.value = null
    draft.value = blankPrescription(external ? 'EXTERNAL' : 'INTERNAL')
    errors.value = []
    conflict.value = null
  }

  function startRevision(): void {
    const source = latest.value
    if (busy.value || !canAmend.value || source === null || source.status !== 'VALIDATED') return
    mutation.reset()
    mode.value = 'revise'
    saved.value = null
    draft.value = withNewIds(prescriptionDraft(source))
    errors.value = []
    conflict.value = null
  }

  function cancelEdit(): void {
    if (busy.value) return
    mutation.reset()
    errors.value = []
    conflict.value = null
    notice.value = null
    const first = list.value[0]
    if (mode.value === 'edit' && saved.value !== null) {
      draft.value = prescriptionDraft(saved.value)
      return
    }
    mode.value = 'idle'
    draft.value = null
    saved.value = null
    if (first !== undefined && first.status === 'DRAFT') {
      mode.value = 'edit'
      saved.value = first
      draft.value = prescriptionDraft(first)
    }
  }

  /** Copie explicite d'un stade de la réfraction, choisi par le professionnel (jamais d'office). */
  function copyFromRefraction(stage: RefractionStage): string[] {
    const current = draft.value
    const exam = consultation.value
    if (current === null || exam === null) return []
    const result = copyRefraction(
      current,
      exam.steps.REFRACTION.measurements as MeasurementData[],
      stage,
    )
    draft.value = result.draft
    return result.copied
  }

  function copyFromCentering(): boolean {
    const current = draft.value
    const exam = consultation.value
    if (current === null || exam === null || exam.steps.CENTERING.centering_id === null)
      return false
    draft.value = copyCentering(current, exam.steps.CENTERING)
    return true
  }

  async function adopt(next: Prescription): Promise<void> {
    saved.value = next
    draft.value = prescriptionDraft(next)
    mode.value = 'edit'
    errors.value = []
    conflict.value = null
    await listRead.reload()
  }

  async function afterOutcome(outcome: MutationOutcome, kind: 'save' | 'validate'): Promise<void> {
    switch (outcome.kind) {
      case 'synced': {
        const next = prescriptionFromResult(outcome.result)
        pendingKind.value = null
        if (kind === 'validate' || next === null) {
          // Validée (immuable) ou réponse illisible : la liste est relue, rien n'est supposé.
          await listRead.reload()
          mode.value = 'idle'
          saved.value = null
          draft.value = null
          errors.value = []
          conflict.value = null
          return
        }
        await adopt(next)
        return
      }
      case 'conflict': {
        // Jeton périmé (brouillon modifié ailleurs) : la version actuelle est relue, la saisie est conservée.
        if (saved.value !== null && outcome.error.code === 'VERSION_CONFLICT') {
          try {
            const latestRead = await getPrescription(saved.value.id)
            if (draft.value !== null) {
              conflict.value = prescriptionDifferences(
                draft.value,
                prescriptionDraft(latestRead.data),
              )
            }
            saved.value = latestRead.data
          } catch {
            conflict.value = []
          }
        }
        return
      }
      case 'refused': {
        if (outcome.error.status === 422) {
          const items: StepError[] = []
          for (const [key, messages] of Object.entries(outcome.error.fields)) {
            for (const message of messages) {
              items.push({ path: key, controlId: prescriptionErrorTarget(key), message })
            }
          }
          if (items.length > 0) await showErrors(items)
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

  /** Identifiants d'effets de la création, stables jusqu'à `startNew` / `startRevision` (une reprise ne les change pas). */
  function ids() {
    return {
      prescriptionId: mutation.effectId('prescription'),
      seriesId: mutation.effectId('series'),
    }
  }

  async function saveDraft(): Promise<void> {
    const current = draft.value
    const exam = consultation.value
    const patientId = scope.kind === 'external' ? scope.patientId : (exam?.patient_id ?? null)
    if (busy.value || current === null || patientId === null || !canWrite.value) return
    notice.value = null
    pendingKind.value = 'save'
    const found = check('draft')
    if (found.length > 0) {
      await showErrors(found)
      return
    }
    errors.value = []

    if (mode.value === 'edit' && saved.value !== null) {
      const changes = buildDraftChanges(current, saved.value)
      if (Object.keys(changes).length === 0) {
        notice.value = 'Aucune modification à enregistrer.'
        return
      }
      await afterOutcome(
        await mutation.submit({
          name: 'UpdatePrescriptionDraft',
          route: { method: 'PATCH', path: `/prescriptions/${saved.value.id}` },
          payload: { expected_updated_at: saved.value.updated_at, changes },
          expectedVersion: null,
        }),
        'save',
      )
      return
    }

    const revising = mode.value === 'revise' ? latest.value : null
    const { prescriptionId, seriesId } = ids()
    const firstPath =
      consultationId === null
        ? '/prescriptions/external'
        : `/consultations/${consultationId}/prescriptions`
    const route =
      revising === null
        ? { method: 'POST' as const, path: firstPath }
        : { method: 'POST' as const, path: `/prescriptions/${revising.id}/revisions` }
    await afterOutcome(
      await mutation.submit({
        name: 'CreatePrescription',
        route,
        payload: buildCreatePayload(
          {
            prescriptionId,
            seriesId: revising === null ? seriesId : revising.series_id,
            versionNo: revising === null ? 1 : revising.version_no + 1,
            supersedesId: revising === null ? null : revising.id,
            patientId,
            consultationId,
          },
          current,
        ),
        expectedVersion: null,
      }),
      'save',
    )
  }

  async function validate(): Promise<void> {
    const current = draft.value
    const target = saved.value
    if (
      busy.value ||
      current === null ||
      target === null ||
      mode.value !== 'edit' ||
      !canValidate.value
    )
      return
    notice.value = null
    if (dirty.value) {
      notice.value = 'Enregistrez d’abord le brouillon : seule la version enregistrée est validée.'
      return
    }
    pendingKind.value = 'validate'
    const found = check('validate')
    if (found.length > 0) {
      await showErrors(found)
      return
    }
    errors.value = []
    await afterOutcome(
      await mutation.submit({
        name: 'ValidatePrescription',
        path: { id: target.id },
        payload: buildValidatePayload(target.id, mutation.effectId('document')),
        expectedVersion: null,
      }),
      'validate',
    )
  }

  async function retry(): Promise<void> {
    if (busy.value) return
    await afterOutcome(await mutation.retry(), pendingKind.value ?? 'save')
  }

  /** Le brouillon enregistré peut être supprimé : écriture clinique, brouillon ouvert en édition (jamais une validée). */
  const canDeleteDraft = computed(
    () =>
      mode.value === 'edit' &&
      saved.value !== null &&
      canDeletePrescriptionDraft(saved.value, { accountId: knownAccountId(), can: canOnScreen }),
  )

  /**
   * Après la suppression du brouillon (ou son refus par le serveur) : l'édition est fermée et la liste relue, rien n'est
   * supposé. La saisie non enregistrée de ce brouillon est abandonnée avec lui.
   */
  async function forgetDraft(): Promise<void> {
    mutation.reset()
    mode.value = 'idle'
    saved.value = null
    draft.value = null
    errors.value = []
    conflict.value = null
    notice.value = null
    await listRead.reload()
  }

  return {
    consultationRead,
    listRead,
    mutation,
    consultation,
    list,
    latest,
    mode,
    draft,
    saved,
    dirty,
    errors,
    errorMap,
    summary,
    summaryBox,
    notice,
    conflict,
    busy,
    canWrite,
    canAmend,
    canValidate,
    startNew,
    startRevision,
    cancelEdit,
    copyFromRefraction,
    copyFromCentering,
    saveDraft,
    validate,
    retry,
    canDeleteDraft,
    forgetDraft,
  }
}
