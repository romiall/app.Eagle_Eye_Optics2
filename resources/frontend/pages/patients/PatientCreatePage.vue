<script setup lang="ts">
/**
 * Nouveau patient (P01 ; fichier 02, EE001 ; AT03, AT04). Identité durable : nom obligatoire,
 * naissance non future ou raison d'absence, téléphone ou raison d'absence. Avant d'enregistrer, les
 * fiches qui ressemblent (nom + prénom, même téléphone) sont cherchées sur le serveur et montrées
 * sans aucune action de fusion : la personne confirme « Créer quand même » ou revient au formulaire.
 * Un téléphone partagé est permis.
 *
 * Enregistrement EN LIGNE : la fiche n'est dite enregistrée qu'après la réponse du serveur
 * (« Synchronisé avec le serveur »), qui attribue le numéro de dossier. Sans réponse, la saisie
 * reste à l'écran et « Réessayer l'enregistrement » reprend la même commande avec la même clé
 * d'idempotence : jamais deux fiches pour une seule saisie. Sur un poste préparé dont le serveur ne
 * répond pas, la fiche est enregistrée dans le coffre local (« Enregistré sur ce poste », jamais
 * « Synchronisé ») et « Ouvrir la fiche » l'ouvre sur le poste, sans le serveur. La recherche des
 * fiches proches exige toujours le serveur : sans lui, la création sans vérification est confirmée.
 */
import { computed, nextTick, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import { ApiError, NetworkUnavailable } from '@/app/api'
import { clinicTimeZone } from '@/app/clinicTime'
import type { MutationOutcome } from '@/app/services/mutations'
import { searchPatients } from '@/app/services/patients'
import { useMutation } from '@/app/services/useMutation'
import { can, revalidateSession } from '@/app/session'
import { useUnsavedChangesGuard } from '@/app/unsavedChanges'
import ConfirmDialog from '@/components/feedback/ConfirmDialog.vue'
import ErrorSummary from '@/components/feedback/ErrorSummary.vue'
import SaveStatus from '@/components/feedback/SaveStatus.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import DuplicateSuggestions from '@/components/patients/DuplicateSuggestions.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import {
  type DuplicateReport,
  duplicateQueries,
  mergeSuggestions,
} from '@/domain/patients/duplicates'
import { blankPatientForm, isBlankForm, type PatientIdentity } from '@/domain/patients/form'
import { buildCreatePatientPayload } from '@/domain/patients/payload'
import { isUlid } from '@/domain/values/ulid'

import { failureView } from './failureView'
import { setFlash } from './flash'
import PatientFormFields from './PatientFormFields.vue'
import { usePatientForm } from './usePatientForm'

/** Fiches proches montrées dans la confirmation (le reste est dit « d'autres fiches existent »). */
const MAX_SUGGESTIONS = 10

type Confirmation =
  | { kind: 'found'; report: DuplicateReport; values: PatientIdentity }
  | { kind: 'unavailable'; values: PatientIdentity; offline: boolean }

const router = useRouter()
const mutation = useMutation()
const { state, saveState, recordedAt, failureMessage } = mutation
/** Champs du formulaire (ref du gabarit) : la date de naissance est lue avant l'envoi. */
const fields = ref<{ commit: () => boolean } | null>(null)
const { form, summary, summaryBox, errors, validate, applyServerFailure } = usePatientForm(
  blankPatientForm(),
  fields,
)

const checking = ref(false)
const saved = ref(false)
/** Fiche enregistrée SUR ce poste (poste préparé, serveur non joint) : son identifiant ouvre la fiche sans le serveur. */
const localPatientId = ref<string | null>(null)
const confirmation = ref<Confirmation | null>(null)
/** Ressemblance déjà confirmée pour cette identité : pas de seconde confirmation à l'envoi suivant. */
let acknowledged: string | null = null

const busy = computed(() => checking.value || state.value === 'saving')
const dirty = computed(() => !saved.value && !isBlankForm(form.value))
useUnsavedChangesGuard(dirty)

const failure = computed(() => failureView(state.value, 'create'))
const timeZone = clinicTimeZone()
const canSearch = computed(() => can('patient.read'))

function similarityKey(values: PatientIdentity): string {
  return JSON.stringify([
    values.last_name,
    values.first_names,
    values.phone_primary,
    values.birth_date,
  ])
}

/** Cherche les fiches proches ; une recherche impossible est dite telle, jamais « aucune fiche ». */
async function findSimilar(values: PatientIdentity): Promise<Confirmation | null> {
  const queries = duplicateQueries(values)
  try {
    const [byName, byPhone] = await Promise.all([
      queries.name === null ? null : searchPatients(queries.name),
      queries.phone === null ? null : searchPatients(queries.phone),
    ])
    const report = mergeSuggestions({
      byName: byName?.data ?? null,
      byPhone: byPhone?.data ?? null,
      birthDate: values.birth_date,
    })
    if (report.suggestions.length === 0) return null
    return {
      kind: 'found',
      values,
      report: {
        suggestions: report.suggestions.slice(0, MAX_SUGGESTIONS),
        more: report.more || report.suggestions.length > MAX_SUGGESTIONS,
      },
    }
  } catch (error) {
    if (!(error instanceof ApiError || error instanceof NetworkUnavailable)) throw error
    if (error instanceof ApiError && (error.status === 401 || error.status === 419)) {
      void revalidateSession().catch(() => undefined)
    }
    return { kind: 'unavailable', values, offline: error instanceof NetworkUnavailable }
  }
}

/** Identifiant et numéro de la fiche créée, lus dans la réponse 201 du serveur. */
function created(result: unknown): { id: string; number: string | null } {
  const data =
    typeof result === 'object' && result !== null && 'data' in result
      ? (result as { data: unknown }).data
      : null
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
  // La réponse du serveur est la fiche complète (`id`) ; `patient_id` est le résultat idempotent d'un poste.
  const id = record['id'] ?? record['patient_id']
  const number = record['record_number']
  return {
    id: typeof id === 'string' && isUlid(id) ? id : mutation.effectId('patient_id'),
    number: typeof number === 'string' && number !== '' ? number : null,
  }
}

async function afterOutcome(result: MutationOutcome): Promise<void> {
  switch (result.kind) {
    case 'synced': {
      saved.value = true
      const patient = created(result.result)
      setFlash(
        patient.number === null
          ? 'Patient enregistré.'
          : `Patient enregistré : dossier ${patient.number}.`,
      )
      await router.push({ name: 'patient', params: { id: patient.id } })
      return
    }
    case 'saved-local':
      // Commit local durable (poste préparé, O04) : rien n'est dit « synchronisé ».
      saved.value = true
      localPatientId.value = mutation.effectId('patient_id')
      return
    case 'refused':
      applyServerFailure(result.error)
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

async function save(values: PatientIdentity): Promise<void> {
  const payload = buildCreatePatientPayload(values, {
    patientId: mutation.effectId('patient_id'),
    recordNumberUsageId: mutation.effectId('record_number_usage_id'),
  })
  await afterOutcome(await mutation.submit({ name: 'CreatePatient', payload }))
}

async function submit(): Promise<void> {
  if (busy.value) return
  const values = validate()
  if (values === null) return
  if (acknowledged !== similarityKey(values)) {
    checking.value = true
    try {
      const similar = await findSimilar(values)
      if (similar !== null) {
        confirmation.value = similar
        return
      }
    } finally {
      checking.value = false
    }
  }
  await save(values)
}

/** Retour au formulaire : le focus revient au bouton d'enregistrement s'il n'est pas déjà dans le formulaire. */
async function cancelConfirmation(): Promise<void> {
  confirmation.value = null
  await nextTick()
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || active.closest('form') === null) {
    document.querySelector<HTMLElement>('main form button[type="submit"]')?.focus()
  }
}

async function createAnyway(): Promise<void> {
  const current = confirmation.value
  confirmation.value = null
  if (current === null) return
  acknowledged = similarityKey(current.values)
  await save(current.values)
}

async function retry(): Promise<void> {
  if (busy.value) return
  await afterOutcome(await mutation.retry())
}
</script>

<template>
  <section aria-labelledby="titre-nouveau-patient" class="page-stack max-w-4xl">
    <PageHeader title-id="titre-nouveau-patient" title="Nouveau patient" icon="user-plus">
      <p class="max-w-prose text-base text-muted">
        Ne créez une fiche que si le patient n’existe pas déjà<template v-if="canSearch">
          (<RouterLink to="/patients" class="text-link py-2.5 font-semibold"
            >chercher dans la liste</RouterLink
          >)</template
        >. Le numéro de dossier est attribué à l’enregistrement : par le serveur, ou, sur un poste
        préparé sans connexion, pris dans la plage de ce poste.
      </p>
    </PageHeader>

    <ErrorSummary ref="summaryBox" :errors="summary" />

    <StateMessage v-if="failure" :state="failure.state" :title="failure.title">
      {{ failureMessage }}
      <template v-if="failure.retry" #action>
        <AppButton variant="secondary" :pending="busy" @click="retry"
          >Réessayer l’enregistrement</AppButton
        >
      </template>
    </StateMessage>

    <form class="space-y-6" novalidate @submit.prevent="submit">
      <PatientFormFields ref="fields" v-model="form" :errors="errors" :disabled="busy" />

      <div class="form-actions">
        <AppButton
          type="submit"
          :pending="busy"
          :pending-label="checking ? 'Vérification en cours…' : 'Enregistrement en cours…'"
          ><AppIcon name="check" :size="18" />Enregistrer le patient</AppButton
        >
        <LinkButton
          v-if="localPatientId !== null"
          :to="{ name: 'patient', params: { id: localPatientId } }"
          variant="secondary"
          >Ouvrir la fiche</LinkButton
        >
        <LinkButton v-else to="/patients" variant="secondary">Annuler</LinkButton>
        <SaveStatus :state="saveState" :at="recordedAt" :time-zone="timeZone" />
      </div>
    </form>

    <ConfirmDialog
      :open="confirmation !== null"
      :title="
        confirmation?.kind === 'unavailable'
          ? 'Vérification des doublons impossible'
          : 'Des fiches ressemblent à ce patient'
      "
      :confirm-label="
        confirmation?.kind === 'unavailable' ? 'Créer sans vérification' : 'Créer quand même'
      "
      cancel-label="Revenir au formulaire"
      tone="danger"
      @confirm="createAnyway"
      @cancel="cancelConfirmation"
    >
      <template v-if="confirmation?.kind === 'found'">
        <p class="mb-3">
          Vérifiez qu’il ne s’agit pas d’un patient déjà enregistré. Aucune fiche n’est fusionnée.
        </p>
        <DuplicateSuggestions
          :suggestions="confirmation.report.suggestions"
          :more="confirmation.report.more"
        />
      </template>
      <p v-else-if="confirmation?.offline">
        La recherche de fiches proches n’a pas pu être faite : le serveur n’est pas joignable (pas
        de connexion). Créer le patient sans cette vérification peut produire un doublon ; vérifiez
        la liste des patients au retour de la connexion.
      </p>
      <p v-else>
        La recherche de fiches proches n’a pas pu être faite : le serveur n’a pas répondu comme
        attendu. Créer le patient sans cette vérification peut produire un doublon.
      </p>
    </ConfirmDialog>
  </section>
</template>
