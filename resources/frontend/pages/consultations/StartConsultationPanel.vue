<script setup lang="ts">
/**
 * Contenu de la boîte « Nouvelle consultation » (C01 ; écran « Consultations », droit clinical.write) :
 * démarrer un examen sans repasser par la file du jour. Deux chemins, un geste chacun :
 *
 * - « Dans la file du jour » : les visites d'examen ou de suivi déjà arrivées, avec leur bouton « Démarrer
 *   l'examen » (`ExamAction` : mêmes règles et mêmes refus que la file du jour, y compris l'attente du
 *   paiement de l'examen quand le contrôle est actif) ;
 * - « Un autre patient » : recherche par nom, téléphone ou numéro de dossier (2 caractères au moins). Une
 *   visite d'examen déjà ouverte aujourd'hui est proposée telle quelle ; sinon, avec le droit visit.register,
 *   « Enregistrer l'arrivée et démarrer l'examen » enregistre l'arrivée (RegisterVisit, motif « Examen de
 *   vue ») PUIS démarre l'examen (StartConsultation) : deux commandes, deux clés d'idempotence, jamais un
 *   succès supposé. Si le démarrage échoue, l'arrivée reste enregistrée (la file du jour la montre) et le
 *   bouton propose de réessayer.
 *
 * Une file du jour illisible ou tronquée n'autorise pas à enregistrer une arrivée : l'absence d'une visite
 * n'est alors pas établie (doublon possible). Le contenu est monté à l'ouverture de la boîte : la file est
 * relue à chaque ouverture. Identité administrative seulement : aucune donnée clinique.
 */
import { computed, nextTick, ref, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'

import { ApiError } from '@/app/api'
import { clinicToday, formatTimeFr } from '@/app/clinicTime'
import type { MutationOutcome } from '@/app/services/mutations'
import { searchPatients } from '@/app/services/patients'
import { useMutation } from '@/app/services/useMutation'
import { type DayVisits, listDayVisits } from '@/app/services/visits'
import { can, enabledModules, revalidateSession } from '@/app/session'
import StateMessage from '@/components/feedback/StateMessage.vue'
import ComboboxField, {
  type ComboboxOption,
  type ComboboxSearchResult,
} from '@/components/form/ComboboxField.vue'
import StatusChip from '@/components/layout/StatusChip.vue'
import PatientIdentityHeader from '@/components/patients/PatientIdentityHeader.vue'
import PatientInitials from '@/components/patients/PatientInitials.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { visitStatusView } from '@/components/visits/visitPresentation'
import type { PatientSummary, Visit, VisitsStatus } from '@/domain/contracts/generated'
import { formatAge, patientAge, patientDisplayName } from '@/domain/patients/identity'
import {
  buildRegisterVisitPayload,
  currentInstant,
  existingVisits,
  isExamReason,
  reasonLabel,
  statusLabel,
} from '@/domain/patients/visits'
import ExamAction from '@/pages/today/ExamAction.vue'
import QueueStateMessage from '@/pages/today/QueueStateMessage.vue'
import StartExamButton from '@/pages/today/StartExamButton.vue'
import { useServerRead } from '@/pages/today/useServerRead'

const props = defineProps<{ titleId: string }>()

const emit = defineEmits<{ close: [] }>()

const today = clinicToday()

/** Statuts d'une visite qui attend son examen, puis ceux d'une visite d'examen encore ouverte. */
const WAITING: readonly VisitsStatus[] = ['ARRIVED', 'AWAITING_EXAM_FEE', 'READY_FOR_EXAM']
const OPEN: readonly VisitsStatus[] = [...WAITING, 'IN_CONSULTATION']

/** Issues où la commande a pu être appliquée ou n'est pas partie : la même saisie se rejoue à l'identique. */
const REPLAYABLE = new Set([
  'uncertain',
  'unavailable',
  'retryable',
  'session-expired',
  'reauthentication-required',
])

// --- File du jour --------------------------------------------------------------------------------

const dayRead = useServerRead<DayVisits>(() => listDayVisits(today.toString()), {
  isEmpty: (result) => result.visits.length === 0,
})

const dayReady = computed(() => dayRead.state.value === 'ready' || dayRead.state.value === 'empty')
/** Vrai quand toute la file du jour a été lue : seule une lecture complète établit l'absence d'une visite. */
const dayComplete = computed(() => dayReady.value && dayRead.data.value?.truncated !== true)

const waiting = computed(() =>
  (dayRead.data.value?.visits ?? []).filter(
    (visit) =>
      isExamReason(visit.reason) &&
      WAITING.includes(visit.status) &&
      (visit.consultation_id ?? null) === null,
  ),
)
const anyAwaitingFee = computed(() =>
  waiting.value.some((visit) => visit.status === 'AWAITING_EXAM_FEE'),
)

/** Refus d'état au démarrage (409) : dit au-dessus des listes, qui sont relues. */
const staleNotice = ref<string | null>(null)

function onStale(message: string): void {
  staleNotice.value = message
  void dayRead.reload()
}

function nameOf(visit: Visit): string {
  return patientDisplayName(visit.patient.last_name, visit.patient.first_names)
}

// --- Choix d'un autre patient --------------------------------------------------------------------

const patientId = ref<string | null>(null)
const selected = shallowRef<PatientSummary | null>(null)
/** Résultats connus par identifiant : le composant de choix ne rend que la valeur de l'option. */
const known = new Map<string, PatientSummary>()
const searchForbidden = ref(false)
const resultCard = ref<HTMLElement | null>(null)

function optionOf(patient: PatientSummary): ComboboxOption {
  const parts = [
    `Dossier ${patient.record_number}`,
    formatAge(patientAge(patient.birth_date, today)),
    patient.phone_primary ?? 'téléphone non renseigné',
  ]
  if (patient.archived) parts.push('Fiche archivée')
  if (patient.merged_into_patient_id !== null) parts.push('Fiche fusionnée')
  return {
    value: patient.id,
    label: patientDisplayName(patient.last_name, patient.first_names),
    description: parts.join(' · '),
  }
}

/** Recherche serveur : indisponible = dit tel quel, jamais « aucun résultat ». */
async function searchForPatients(query: string): Promise<ComboboxSearchResult> {
  try {
    const { data } = await searchPatients(query)
    searchForbidden.value = false
    for (const patient of data.data) known.set(patient.id, patient)
    const options = data.data.map(optionOf)
    return data.meta.total > data.data.length
      ? {
          options,
          notice: `${data.meta.total} fiches correspondent : précisez la recherche pour voir les autres.`,
        }
      : options
  } catch (error) {
    if (error instanceof ApiError) {
      searchForbidden.value = error.status === 403
      if (error.status === 401 || error.status === 419) {
        void revalidateSession().catch(() => undefined)
      }
    }
    throw error
  }
}

const unavailableText = computed(() =>
  searchForbidden.value
    ? 'Ce compte n’a pas le droit de rechercher des patients.'
    : 'Recherche serveur indisponible : cela ne prouve pas que le patient n’existe pas. Réessayez avant de créer une nouvelle fiche.',
)

const canSearch = computed(() => can('patient.read'))
const canCreatePatient = computed(
  () => can('patient.create') && enabledModules.value.includes('patients'),
)
const canRegister = computed(() => can('visit.register'))

const selectedLabel = computed(() =>
  selected.value === null
    ? null
    : patientDisplayName(selected.value.last_name, selected.value.first_names),
)

/** Pourquoi la fiche choisie ne peut pas recevoir d'examen (fiche fusionnée ou archivée), sinon null. */
const problem = computed<string | null>(() => {
  const patient = selected.value
  if (patient === null) return null
  if (patient.merged_into_patient_id !== null) {
    return 'Cette fiche a été fusionnée dans une autre : cherchez la fiche conservée.'
  }
  if (patient.archived) {
    return 'Cette fiche est archivée : un examen ne peut pas lui être ouvert.'
  }
  return null
})

/** Visite d'examen déjà ouverte aujourd'hui pour le patient choisi (hors annulée), à proposer telle quelle. */
const openVisit = computed<Visit | null>(() => {
  const patient = selected.value
  const day = dayRead.data.value
  if (patient === null || day === null) return null
  return (
    existingVisits(day.visits, patient.id).find(
      (visit) => isExamReason(visit.reason) && OPEN.includes(visit.status),
    ) ?? null
  )
})

// --- Arrivée puis examen -------------------------------------------------------------------------

const arrival = useMutation()
const registering = computed(() => arrival.state.value === 'saving')
const arrivalUnresolved = computed(() => REPLAYABLE.has(arrival.state.value))
const arrivalFailure = computed(() =>
  arrival.state.value === 'idle' ||
  arrival.state.value === 'saving' ||
  arrival.state.value === 'synced'
    ? null
    : arrival.failureMessage.value,
)
/** Visite créée par « Enregistrer l'arrivée et démarrer l'examen » : l'examen démarre depuis elle. */
const registered = shallowRef<Visit | null>(null)
/** L'arrivée est enregistrée mais la visite n'a pas pu être relue : la file du jour la montre. */
const registeredUnread = ref(false)
const clockProblem = ref(false)

const registeredStartable = computed(
  () =>
    registered.value !== null && ['ARRIVED', 'READY_FOR_EXAM'].includes(registered.value.status),
)

function onSelect(option: ComboboxOption | null): void {
  selected.value = option === null ? null : (known.get(option.value) ?? null)
  registered.value = null
  registeredUnread.value = false
  clockProblem.value = false
  // Une autre fiche, une autre arrivée : clé et identifiant de visite repartent à neuf.
  if (arrival.state.value !== 'saving') arrival.reset()
  // Sur un petit écran, la fiche choisie et son bouton sont sous le champ : les ramener dans la boîte.
  if (selected.value !== null) {
    void nextTick(() => resultCard.value?.scrollIntoView?.({ block: 'nearest' }))
  }
}

/** Visite portée par la réponse du serveur, ou null si la réponse n'a pas la forme d'une visite. */
function visitFromResult(result: unknown): Visit | null {
  const data =
    typeof result === 'object' && result !== null && 'data' in result
      ? (result as { data: unknown }).data
      : null
  if (typeof data !== 'object' || data === null) return null
  const candidate = data as Partial<Visit>
  return typeof candidate.id === 'string' &&
    typeof candidate.patient_id === 'string' &&
    typeof candidate.status === 'string' &&
    typeof candidate.patient === 'object' &&
    candidate.patient !== null
    ? (data as Visit)
    : null
}

async function afterArrival(outcome: MutationOutcome): Promise<void> {
  switch (outcome.kind) {
    case 'synced': {
      const visit = visitFromResult(outcome.result)
      if (visit !== null) {
        registered.value = visit
        return
      }
      // Réponse sans la visite : la file est relue pour la retrouver, sans rien supposer.
      await dayRead.reload()
      const wanted = arrival.effectId('visit_id')
      const found = dayRead.data.value?.visits.find((entry) => entry.id === wanted) ?? null
      if (found === null) registeredUnread.value = true
      else registered.value = found
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

async function registerAndStart(): Promise<void> {
  const patient = selected.value
  if (patient === null || registering.value || registered.value !== null) return
  clockProblem.value = false
  if (arrivalUnresolved.value) {
    await afterArrival(await arrival.retry())
    return
  }
  let at: string
  try {
    at = currentInstant()
  } catch {
    clockProblem.value = true
    return
  }
  const payload = buildRegisterVisitPayload(
    { patient_id: patient.id, reason: 'EXAM', administrative_note: null },
    { visitId: arrival.effectId('visit_id') },
    at,
  )
  await afterArrival(await arrival.submit({ name: 'RegisterVisit', payload }))
}
</script>

<template>
  <div class="space-y-6 p-5">
    <div class="flex items-start justify-between gap-3">
      <h2
        :id="props.titleId"
        tabindex="-1"
        class="min-w-0 text-xl font-semibold focus:outline-none"
      >
        Nouvelle consultation
      </h2>
      <AppButton variant="secondary" @click="emit('close')">Fermer</AppButton>
    </div>
    <p class="max-w-prose text-base text-muted">
      Choisissez le patient à examiner : il attend déjà dans la file du jour, ou vous le cherchez
      par son nom, son téléphone ou son numéro de dossier.
    </p>

    <StateMessage
      v-if="staleNotice"
      state="conflict"
      title="La visite a changé depuis l’affichage de la file"
    >
      {{ staleNotice }}
    </StateMessage>

    <section aria-labelledby="nouvelle-consultation-file" class="space-y-3">
      <h3 id="nouvelle-consultation-file" class="section-title">Dans la file du jour</h3>
      <QueueStateMessage
        v-if="!dayReady"
        :state="dayRead.state.value"
        :error="dayRead.error.value"
        @retry="dayRead.reload()"
      />
      <p v-else-if="waiting.length === 0" class="text-base text-muted">
        Aucun patient n’attend un examen dans la file du jour.
      </p>
      <ul v-else class="space-y-2">
        <li
          v-for="visit in waiting"
          :key="visit.id"
          class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-surface p-3"
        >
          <PatientInitials
            size="sm"
            :last-name="visit.patient.last_name"
            :first-names="visit.patient.first_names"
          />
          <p class="min-w-36 flex-1">
            <span class="block font-semibold break-words text-ink">{{ nameOf(visit) }}</span>
            <span class="block text-sm break-words text-muted"
              >Dossier {{ visit.patient.record_number }} · arrivé à
              {{ formatTimeFr(visit.occurred_at) }} · {{ reasonLabel(visit.reason) }}</span
            >
          </p>
          <StatusChip
            :tone="visitStatusView(visit.status).tone"
            :icon="visitStatusView(visit.status).icon"
            ><span class="sr-only">Statut : </span>{{ statusLabel(visit.status) }}</StatusChip
          >
          <ExamAction :visit="visit" @stale="onStale" />
        </li>
      </ul>
      <p v-if="anyAwaitingFee" class="flex items-start gap-1.5 text-sm text-muted">
        <AppIcon name="info" :size="16" class="mt-0.5" />
        <span
          >Un examen en attente du paiement démarre après l’encaissement des frais d’examen ou la
          dispense accordée par la gérante.</span
        >
      </p>
      <p
        v-if="dayReady && dayRead.data.value?.truncated"
        class="flex items-start gap-1.5 text-sm text-muted"
      >
        <AppIcon name="info" :size="16" class="mt-0.5" />
        <span
          >La file du jour est longue : seules les premières visites sont lues ici. Ouvrez la file
          du jour pour voir les autres.</span
        >
      </p>
    </section>

    <section aria-labelledby="nouvelle-consultation-autre" class="space-y-3">
      <h3 id="nouvelle-consultation-autre" class="section-title">Un autre patient</h3>
      <p v-if="!canSearch" class="text-base text-muted">
        Ce compte n’a pas le droit de rechercher des patients : choisissez un patient de la file du
        jour.
      </p>
      <template v-else>
        <ComboboxField
          v-model="patientId"
          control-id="nouvelle-consultation-patient"
          label="Patient"
          :selected-label="selectedLabel"
          :search="searchForPatients"
          :unavailable-text="unavailableText"
          :disabled="registering"
          hint="Nom, prénom, téléphone ou numéro de dossier (par exemple EE-2026-0001). Au moins 2 caractères."
          @select="onSelect"
        />

        <div
          v-if="selected"
          ref="resultCard"
          class="space-y-3 rounded-xl border border-line bg-canvas p-4"
        >
          <PatientIdentityHeader :patient="selected" avatar />

          <p
            v-if="problem"
            role="status"
            class="flex items-start gap-2 rounded-xl border border-warning bg-warning-soft p-3 text-ink"
          >
            <AppIcon name="alert" :size="18" class="mt-0.5 text-warning" />
            <span>{{ problem }}</span>
          </p>

          <template v-else-if="openVisit">
            <p class="flex flex-wrap items-center gap-2 text-base text-ink">
              <span
                >Arrivé aujourd’hui à {{ formatTimeFr(openVisit.occurred_at) }} ({{
                  reasonLabel(openVisit.reason)
                }}).</span
              >
              <StatusChip
                :tone="visitStatusView(openVisit.status).tone"
                :icon="visitStatusView(openVisit.status).icon"
                ><span class="sr-only">Statut : </span
                >{{ statusLabel(openVisit.status) }}</StatusChip
              >
            </p>
            <ExamAction :visit="openVisit" @stale="onStale" />
          </template>

          <template v-else-if="registered">
            <p role="status" class="flex items-start gap-2 text-base text-ink">
              <AppIcon name="check-circle" :size="18" class="mt-0.5 text-accent" />
              <span>Arrivée enregistrée.</span>
            </p>
            <StartExamButton
              v-if="registeredStartable"
              :visit="registered"
              autostart
              @stale="onStale"
            />
            <p v-else class="text-base text-ink">
              Les frais d’examen sont à encaisser (ou une dispense à accorder) avant de démarrer
              l’examen : la file du jour suit ce patient.
            </p>
          </template>

          <p v-else-if="registeredUnread" role="status" class="text-base text-ink">
            L’arrivée est enregistrée, mais la visite n’a pas pu être relue. Ouvrez la file du jour
            pour démarrer l’examen.
          </p>

          <p v-else-if="!dayComplete" role="status" class="flex items-start gap-2 text-base">
            <AppIcon name="info" :size="18" class="mt-0.5 text-muted" />
            <span
              >La file du jour n’a pas pu être lue en entier : une arrivée déjà enregistrée ne peut
              pas être écartée. Réessayez avant d’enregistrer une arrivée.</span
            >
          </p>

          <div v-else-if="canRegister" class="space-y-2">
            <p class="text-base text-muted">
              Ce patient n’est pas dans la file du jour. L’arrivée est enregistrée, puis l’examen
              démarre.
            </p>
            <AppButton
              variant="primary"
              :pending="registering"
              pending-label="Enregistrement de l’arrivée…"
              @click="registerAndStart"
              ><AppIcon :name="arrivalUnresolved ? 'refresh' : 'stethoscope'" :size="18" />{{
                arrivalUnresolved
                  ? 'Réessayer d’enregistrer l’arrivée'
                  : 'Enregistrer l’arrivée et démarrer l’examen'
              }}</AppButton
            >
            <p v-if="clockProblem" role="alert" class="text-sm font-medium text-danger">
              L’heure de cet appareil n’est pas valide : corrigez la date et l’heure de l’appareil
              avant d’enregistrer.
            </p>
            <p
              v-if="arrivalFailure"
              role="alert"
              class="flex max-w-prose items-start gap-1.5 text-sm font-medium text-danger"
            >
              <AppIcon name="alert" :size="16" class="mt-0.5" /><span>{{ arrivalFailure }}</span>
            </p>
          </div>

          <p v-else class="text-base text-muted">
            Ce patient n’est pas dans la file du jour : l’accueil doit d’abord enregistrer son
            arrivée.
          </p>
        </div>
      </template>

      <p class="text-sm text-muted">
        Le patient vient pour la première fois ?
        <RouterLink
          v-if="canCreatePatient"
          to="/patients/nouveau"
          class="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4 hover:decoration-gold hover:decoration-2"
          >Nouveau patient</RouterLink
        >
        <template v-else
          >L’accueil crée sa fiche (« Nouveau patient »), puis vous le retrouvez ici.</template
        >
      </p>
    </section>
  </div>
</template>
