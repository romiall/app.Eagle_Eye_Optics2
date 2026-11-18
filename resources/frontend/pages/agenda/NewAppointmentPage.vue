<script setup lang="ts">
/**
 * Prise de rendez-vous (S01 ; fichier 02 « Le bouton Programmer un RDV choisit service, professionnel/ressource,
 * début et durée, puis confirme »), EN LIGNE : patient (présélectionné depuis sa fiche ou un contrôle à programmer,
 * ou recherché), prestation, ressource, jour, puis un créneau libre lu sur le serveur. Le rendez-vous n'est dit
 * « confirmé » qu'à la réponse du serveur ; un créneau pris entre-temps est refusé (409) et les créneaux sont relus.
 * Double clic ou coupure : la même clé d'idempotence, jamais deux rendez-vous. Aucune donnée clinique.
 *
 * Présentation : quatre étapes numérotées (patient, prestation et ressource, jour et créneau, note et
 * confirmation), la pastille d'une étape remplie devient une coche ; créneaux libres en pastilles.
 */
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'

import { clinicToday, formatDayFr, formatInstantFr, formatTimeFr } from '@/app/clinicTime'
import { getAgendaConfiguration, listAvailableSlots } from '@/app/services/agenda'
import type { MutationOutcome } from '@/app/services/mutations'
import { getPatient, searchPatients } from '@/app/services/patients'
import { useMutation } from '@/app/services/useMutation'
import { canOnScreen, moduleOpenOnScreen, revalidateSession } from '@/app/session'
import SlotOption from '@/components/agenda/SlotOption.vue'
import StepCard from '@/components/agenda/StepCard.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import DateField from '@/components/form/DateField.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import TextField from '@/components/form/TextField.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import type { AgendaConfiguration, AvailableSlots } from '@/domain/contracts/generated'
import { patientDisplayName } from '@/domain/patients/identity'
import { CivilDate } from '@/domain/values/civilDate'
import { isUlid } from '@/domain/values/ulid'
import SalesReadMessage from '@/pages/sales/SalesReadMessage.vue'
import { useServerRead } from '@/pages/today/useServerRead'

interface ChosenPatient {
  id: string
  name: string
  recordNumber: string
}

const route = useRoute()
const mutation = useMutation()
const saving = computed(() => mutation.state.value === 'saving')

const queryPatient = typeof route.query['patient'] === 'string' ? route.query['patient'] : null
const queryFollowUp = typeof route.query['suivi'] === 'string' ? route.query['suivi'] : null
const queryDay = typeof route.query['jour'] === 'string' ? route.query['jour'] : null
const queryResource = typeof route.query['ressource'] === 'string' ? route.query['ressource'] : null
const queryService =
  typeof route.query['prestation'] === 'string' ? route.query['prestation'] : null
const followUpId = queryFollowUp !== null && isUlid(queryFollowUp) ? queryFollowUp : null
const requestedResourceId = queryResource !== null && isUlid(queryResource) ? queryResource : null
const requestedServiceId = queryService !== null && isUlid(queryService) ? queryService : null
const initialDay = ((): string => {
  if (queryDay !== null) {
    try {
      const parsed = CivilDate.parse(queryDay)
      if (parsed !== null) return parsed.toString()
    } catch {
      // Date invalide dans l'adresse ignorée au profit du jour civil du cabinet.
    }
  }
  return clinicToday().toString()
})()

// --- Patient ---------------------------------------------------------------------------------------
const patient = shallowRef<ChosenPatient | null>(null)
const patientError = ref<string | null>(null)
const search = ref('')
const results = shallowRef<ChosenPatient[]>([])
const searching = ref(false)
const canCreatePatient = computed(
  () => canOnScreen('patient.create') && moduleOpenOnScreen('patients'),
)
const canOpenPatient = computed(() => canOnScreen('patient.read') && moduleOpenOnScreen('patients'))
const canRegisterArrival = computed(
  () => canOnScreen('visit.register') && moduleOpenOnScreen('today'),
)

if (queryPatient !== null && isUlid(queryPatient)) {
  void getPatient(queryPatient)
    .then((outcome) => {
      const found = outcome.data
      patient.value = {
        id: found.id,
        name: patientDisplayName(found.last_name, found.first_names),
        recordNumber: found.record_number,
      }
    })
    .catch(() => {
      patientError.value = 'La fiche du patient n’a pas pu être lue : recherchez-le ci-dessous.'
    })
}

async function runSearch(): Promise<void> {
  patientError.value = null
  if (search.value.trim().length < 2) {
    patientError.value = 'La recherche demande 2 caractères au moins.'
    return
  }
  searching.value = true
  try {
    const page = (await searchPatients(search.value)).data
    results.value = page.data.map((row) => ({
      id: row.id,
      name: patientDisplayName(row.last_name, row.first_names),
      recordNumber: row.record_number,
    }))
    if (results.value.length === 0)
      patientError.value = 'Aucun patient ne correspond à cette recherche.'
  } catch {
    patientError.value =
      'Recherche indisponible : cela ne prouve pas que le patient n’existe pas. Réessayez.'
  } finally {
    searching.value = false
  }
}

// --- Prestation, ressource, jour, créneau ----------------------------------------------------------
const configuration = useServerRead<AgendaConfiguration>(() => getAgendaConfiguration())
const serviceId = ref<string | null>(null)
const resourceId = ref<string | null>(null)
const day = ref<string | null>(initialDay)
const slots = shallowRef<AvailableSlots | null>(null)
const slotsState = ref<'idle' | 'loading' | 'ready' | 'failed'>('idle')
const chosenSlot = ref<string | null>(null)
const reason = ref('')
const formError = ref<string | null>(null)
const confirmed = ref<{
  label: string
  appointmentId: string
  patientId: string
  day: string
} | null>(null)

const serviceOptions = computed(() =>
  (configuration.data.value?.services ?? [])
    .filter((service) => service.active)
    .map((service) => ({
      value: service.id,
      label: `${service.name} (${service.duration_minutes} min)`,
    })),
)
const resourceOptions = computed(() =>
  (configuration.data.value?.resources ?? [])
    .filter((resource) => resource.active)
    .map((resource) => ({
      value: resource.id,
      label: resource.professional_name
        ? `${resource.name} (${resource.professional_name})`
        : resource.name,
    })),
)
const noConfiguration = computed(
  () =>
    configuration.state.value === 'ready' &&
    (serviceOptions.value.length === 0 || resourceOptions.value.length === 0),
)

watch(
  () => configuration.data.value,
  (loaded) => {
    if (loaded === null) return
    let autoChosen = false
    if (serviceId.value === null) {
      const fromUrl =
        requestedServiceId !== null &&
        serviceOptions.value.some((option) => option.value === requestedServiceId)
          ? requestedServiceId
          : null
      if (fromUrl !== null) {
        serviceId.value = fromUrl
        autoChosen = true
      } else if (serviceOptions.value.length === 1) {
        serviceId.value = serviceOptions.value[0]!.value
        autoChosen = true
      }
    }
    if (resourceId.value === null) {
      const fromUrl =
        requestedResourceId !== null &&
        resourceOptions.value.some((option) => option.value === requestedResourceId)
          ? requestedResourceId
          : null
      if (fromUrl !== null) {
        resourceId.value = fromUrl
        autoChosen = true
      } else if (resourceOptions.value.length === 1) {
        resourceId.value = resourceOptions.value[0]!.value
        autoChosen = true
      }
    }
    if (autoChosen && serviceId.value !== null && resourceId.value !== null) {
      void loadSlots()
    }
  },
  { immediate: true },
)

async function loadSlots(): Promise<void> {
  slots.value = null
  chosenSlot.value = null
  if (serviceId.value === null || resourceId.value === null || day.value === null) return
  let parsed: CivilDate | null
  try {
    parsed = CivilDate.parse(day.value)
  } catch {
    parsed = null
  }
  if (parsed === null) return
  slotsState.value = 'loading'
  try {
    slots.value = (
      await listAvailableSlots(parsed.toString(), resourceId.value, serviceId.value)
    ).data
    slotsState.value = 'ready'
  } catch {
    slotsState.value = 'failed'
  }
}

async function afterOutcome(
  outcome: MutationOutcome,
  details: { label: string; appointmentId: string; patientId: string; day: string },
): Promise<void> {
  switch (outcome.kind) {
    case 'synced':
      confirmed.value = details
      return
    case 'refused':
      if (outcome.error.code === 'SLOT_UNAVAILABLE' || outcome.error.status === 409) {
        formError.value = outcome.error.message
        mutation.reset()
        await loadSlots()
        return
      }
      formError.value = Object.values(outcome.error.fields)[0]?.[0] ?? outcome.error.message
      return
    case 'session-expired':
    case 'reauthentication-required':
      void revalidateSession().catch(() => undefined)
      formError.value = mutation.failureMessage.value
      return
    default:
      formError.value = mutation.failureMessage.value
  }
}

async function submit(): Promise<void> {
  if (saving.value) return
  formError.value = null
  const slot = slots.value?.slots.find((candidate) => candidate.starts_at === chosenSlot.value)
  if (patient.value === null) {
    formError.value = 'Choisissez le patient du rendez-vous.'
    return
  }
  if (serviceId.value === null || resourceId.value === null || slot === undefined) {
    formError.value = 'Choisissez la prestation, la ressource, le jour et un créneau libre.'
    return
  }
  const note = reason.value.trim()
  const label = `${patient.value.name}, ${formatInstantFr(slot.starts_at)}`
  const appointmentId = mutation.effectId('appointment_id')
  const chosenDay = slots.value?.date ?? day.value ?? clinicToday().toString()
  await afterOutcome(
    await mutation.submit({
      name: 'CreateAppointment',
      payload: {
        appointment_id: appointmentId,
        patient_id: patient.value.id,
        prospect_contact_id: null,
        follow_up_id: followUpId,
        resource_id: resourceId.value,
        service_id: serviceId.value,
        starts_at: slot.starts_at,
        ends_at: slot.ends_at,
        administrative_reason: note === '' ? null : note,
      },
    }),
    { label, appointmentId, patientId: patient.value.id, day: chosenDay },
  )
}

function another(): void {
  confirmed.value = null
  chosenSlot.value = null
  reason.value = ''
  mutation.reset()
  void loadSlots()
}
</script>

<template>
  <section aria-labelledby="titre-nouveau-rdv" class="page-stack max-w-4xl">
    <PageHeader
      title-id="titre-nouveau-rdv"
      title="Nouveau rendez-vous"
      icon="calendar-plus"
      subtitle="Choisissez le patient, la prestation et la ressource, puis un créneau libre lu sur le serveur."
      :back="{
        to: { name: 'agenda', ...(day ? { query: { jour: day } } : {}) },
        label: 'Retour à l’agenda',
      }"
    />

    <StateMessage
      v-if="confirmed"
      state="success"
      :title="`Rendez-vous confirmé par le serveur : ${confirmed.label}`"
    >
      <template #action>
        <div class="flex flex-wrap gap-3">
          <LinkButton :to="{ name: 'agenda', query: { jour: confirmed.day } }" variant="primary">
            <AppIcon name="agenda" />
            Voir l’agenda
          </LinkButton>
          <LinkButton
            v-if="canRegisterArrival && confirmed.day === clinicToday().toString()"
            :to="{
              name: 'arrivee',
              query: { patient: confirmed.patientId, 'rendez-vous': confirmed.appointmentId },
            }"
            variant="secondary"
          >
            <AppIcon name="arrival" />
            Enregistrer l’arrivée
          </LinkButton>
          <LinkButton
            v-if="canOpenPatient"
            :to="{ name: 'patient', params: { id: confirmed.patientId } }"
            variant="secondary"
          >
            <AppIcon name="user" />
            Ouvrir la fiche du patient
          </LinkButton>
          <AppButton variant="secondary" @click="another">
            <AppIcon name="plus" />
            Autre rendez-vous
          </AppButton>
        </div>
      </template>
    </StateMessage>

    <template v-else>
      <p
        v-if="followUpId"
        class="flex max-w-prose items-start gap-3 rounded-xl border border-gold bg-gold-soft p-4 text-ink"
      >
        <AppIcon name="info" class="mt-0.5 text-gold-ink" />
        <span
          >Ce rendez-vous programme un contrôle recommandé : le contrôle passera « rendez-vous
          programmé ».</span
        >
      </p>

      <StepCard :step="1" title="Patient" :done="patient !== null">
        <fieldset class="space-y-4">
          <legend class="sr-only">Patient</legend>
          <div
            v-if="patient"
            class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-l-4 border-line border-l-gold bg-primary-soft p-4"
          >
            <p class="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                class="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-gold-ink"
              >
                <AppIcon name="user" />
              </span>
              <span class="min-w-0 break-words">
                <span class="block font-semibold">{{ patient.name }}</span>
                <span class="sr-only"> · </span>
                <span class="block text-sm text-muted">Dossier {{ patient.recordNumber }}</span>
              </span>
            </p>
            <AppButton variant="secondary" @click="patient = null">Changer de patient</AppButton>
          </div>
          <template v-else>
            <form class="toolbar" role="search" @submit.prevent="runSearch">
              <div class="min-w-0 sm:flex-1">
                <TextField
                  v-model="search"
                  label="Rechercher un patient"
                  hint="Nom, téléphone ou numéro de dossier."
                  type="search"
                  control-id="rdv-recherche"
                />
              </div>
              <AppButton
                type="submit"
                variant="secondary"
                :pending="searching"
                pending-label="Recherche…"
              >
                <AppIcon name="search" />
                Rechercher
              </AppButton>
            </form>
            <ul v-if="results.length > 0" class="space-y-2">
              <li v-for="result in results" :key="result.id">
                <AppButton variant="secondary" class="w-full" @click="patient = result">
                  <span class="flex w-full min-w-0 items-center gap-3 text-left">
                    <AppIcon name="user" class="text-gold" />
                    <span class="min-w-0 flex-1 break-words"
                      >{{ result.name }} · Dossier {{ result.recordNumber }}</span
                    >
                    <AppIcon name="chevron-right" class="text-muted" />
                  </span>
                </AppButton>
              </li>
            </ul>
            <div
              v-if="canCreatePatient"
              class="flex flex-wrap items-center gap-2 text-sm text-muted"
            >
              <span>Le patient n’a pas encore de dossier ?</span>
              <LinkButton :to="{ name: 'patient-nouveau' }" variant="ghost">
                Créer une fiche patient
              </LinkButton>
            </div>
          </template>
          <p
            v-if="patientError"
            role="alert"
            class="flex items-start gap-2 text-sm font-medium text-danger"
          >
            <AppIcon name="alert" :size="18" />
            <span>{{ patientError }}</span>
          </p>
        </fieldset>
      </StepCard>

      <SalesReadMessage
        v-if="configuration.state.value !== 'ready'"
        :state="configuration.state.value"
        subject="la configuration de l’agenda"
        :error="configuration.error.value"
        @retry="configuration.reload()"
      />
      <StateMessage v-else-if="noConfiguration" state="empty" title="Agenda non configuré">
        Aucune prestation ou ressource active : la gérante les crée dans « Agenda », « Configuration
        » (aucun horaire n’est inventé).
      </StateMessage>

      <form v-else class="space-y-6 sm:space-y-8" novalidate @submit.prevent="submit">
        <StepCard
          :step="2"
          title="Prestation et ressource"
          :done="serviceId !== null && resourceId !== null"
        >
          <div class="form-grid">
            <SelectField
              v-model="serviceId"
              label="Prestation"
              placeholder="Choisir une prestation…"
              :options="serviceOptions"
              control-id="rdv-prestation"
              required
              @update:model-value="loadSlots"
            />
            <SelectField
              v-model="resourceId"
              label="Professionnel ou salle"
              placeholder="Choisir une ressource…"
              :options="resourceOptions"
              control-id="rdv-ressource"
              required
              @update:model-value="loadSlots"
            />
          </div>
        </StepCard>

        <StepCard :step="3" title="Jour et créneau" :done="chosenSlot !== null">
          <div class="sm:max-w-xs">
            <DateField
              v-model="day"
              label="Jour"
              control-id="rdv-jour"
              required
              @update:model-value="loadSlots"
            />
          </div>

          <p
            v-if="slotsState === 'loading'"
            role="status"
            class="flex items-center gap-2 text-muted"
          >
            <AppIcon name="clock" :size="18" />
            Lecture des créneaux libres…
          </p>
          <p
            v-else-if="slotsState === 'failed'"
            role="alert"
            class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-danger bg-danger-soft p-3 font-medium text-danger"
          >
            <span class="inline-flex items-start gap-2">
              <AppIcon name="alert" :size="18" class="mt-0.5" />
              Créneaux indisponibles : la lecture du serveur a échoué.
            </span>
            <AppButton variant="ghost" @click="loadSlots">Réessayer</AppButton>
          </p>
          <fieldset v-else-if="slots" class="space-y-3">
            <legend class="font-semibold">
              Créneau libre du {{ formatDayFr(CivilDate.fromString(slots.date)) }} ({{
                slots.duration_minutes
              }}
              min)
            </legend>
            <p
              v-if="slots.slots.length === 0"
              class="flex items-center gap-2 rounded-xl border border-dashed border-line bg-canvas px-4 py-3 text-muted"
            >
              <AppIcon name="calendar" class="text-gold" />
              Aucun créneau libre ce jour-là pour cette ressource.
            </p>
            <div class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,6.5rem),1fr))] gap-2">
              <SlotOption v-for="slot in slots.slots" :key="slot.starts_at">
                <input
                  v-model="chosenSlot"
                  type="radio"
                  name="rdv-creneau"
                  :value="slot.starts_at"
                  class="size-4 shrink-0 accent-primary"
                />
                <span>{{ formatTimeFr(slot.starts_at) }}</span>
              </SlotOption>
            </div>
          </fieldset>
          <p v-else-if="serviceId === null || resourceId === null" class="text-sm text-muted">
            Les créneaux libres s’affichent après le choix de la prestation et de la ressource.
          </p>
        </StepCard>

        <StepCard :step="4" title="Note et confirmation">
          <TextAreaField
            v-model="reason"
            label="Note administrative (facultative)"
            hint="Information d’accueil seulement, aucune information médicale."
            control-id="rdv-note"
            :rows="2"
            :maxlength="4000"
          />

          <p
            v-if="formError"
            role="alert"
            class="rounded-xl border border-danger bg-danger-soft p-3 font-medium text-danger"
          >
            <span aria-hidden="true">⚠ </span>{{ formError }}
          </p>
          <div class="form-actions">
            <AppButton
              type="submit"
              variant="primary"
              :pending="saving"
              pending-label="Confirmation en cours…"
            >
              <AppIcon name="check" />
              Confirmer le rendez-vous
            </AppButton>
            <LinkButton :to="{ name: 'agenda' }" variant="ghost">Annuler</LinkButton>
          </div>
        </StepCard>
      </form>
    </template>
  </section>
</template>
