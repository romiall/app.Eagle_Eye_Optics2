<script setup lang="ts">
/**
 * Un rendez-vous de l'agenda (S01) : heure, patient, prestation, ressource et statut (texte et symbole, jamais
 * la seule couleur). Actions selon les droits et le statut : « Enregistrer l'arrivée » (le jour même, accueil),
 * « Déplacer » (créneaux libres relus sur le serveur), « Annuler » (motif obligatoire), « Absent » (après l'heure).
 * Chaque action passe par le chemin central avec la version du rendez-vous : un rendez-vous modifié ailleurs
 * entre-temps est dit (409) et l'agenda est relu. Aucun succès n'est supposé sans réponse du serveur.
 *
 * Présentation : filet gauche et puce (teinte et icône) selon le statut ; dès que la carte est assez large, les
 * heures passent dans une colonne à gauche, le reste à droite. Créneaux du déplacement en pastilles.
 */
import { computed, ref, useId } from 'vue'
import { RouterLink } from 'vue-router'

import { clinicTimeZone, clinicToday, formatTimeFr } from '@/app/clinicTime'
import { listAvailableSlots } from '@/app/services/agenda'
import type { MutationOutcome } from '@/app/services/mutations'
import { useMutation } from '@/app/services/useMutation'
import { canOnScreen, moduleOpenOnScreen, revalidateSession } from '@/app/session'
import SlotOption from '@/components/agenda/SlotOption.vue'
import { APPOINTMENT_LOOKS, UNKNOWN_APPOINTMENT_LOOK } from '@/components/agenda/tones'
import ConfirmDialog from '@/components/feedback/ConfirmDialog.vue'
import DateField from '@/components/form/DateField.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import StatusChip from '@/components/layout/StatusChip.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import {
  APPOINTMENT_STATUS_LABELS,
  CANCEL_REASON_MAX_LENGTH,
  canMarkNoShow,
  canRegisterArrival,
  dayOf,
  isChangeable,
  validateCancelReason,
} from '@/domain/agenda/agenda'
import type { Appointment, AvailableSlots } from '@/domain/contracts/generated'
import { patientDisplayName } from '@/domain/patients/identity'

const props = defineProps<{ appointment: Appointment }>()
const emit = defineEmits<{ changed: [message: string]; stale: [message: string] }>()

const timeZone = clinicTimeZone()
const ids = useId()
const REASON_ID = `${ids}-motif`
const mutation = useMutation()
const saving = computed(() => mutation.state.value === 'saving')
const error = ref<string | null>(null)

const name = computed(() =>
  props.appointment.patient === null
    ? 'Patient non renseigné'
    : patientDisplayName(
        props.appointment.patient.last_name,
        props.appointment.patient.first_names,
      ),
)
/** Début et fin à l'heure du cabinet (le titre les lit « 08h00 – 08h30 »). */
const start = computed(() => formatTimeFr(props.appointment.starts_at))
const end = computed(() => formatTimeFr(props.appointment.ends_at))
/** Teinte et icône du statut ; un statut inconnu de cette version reste neutre. */
const look = computed(() => APPOINTMENT_LOOKS[props.appointment.status] ?? UNKNOWN_APPOINTMENT_LOOK)
const canWrite = computed(() => canOnScreen('agenda.write'))
const changeable = computed(() => canWrite.value && isChangeable(props.appointment))
const noShowOffered = computed(() => canWrite.value && canMarkNoShow(props.appointment, Date.now()))
const arrivalOffered = computed(
  () =>
    canOnScreen('visit.register') &&
    moduleOpenOnScreen('today') &&
    canRegisterArrival(props.appointment, clinicToday(), timeZone),
)
const arrivalLink = computed(() => ({
  name: 'arrivee',
  query: { patient: props.appointment.patient_id ?? '', 'rendez-vous': props.appointment.id },
}))
const canOpenPatient = computed(
  () =>
    props.appointment.patient_id !== null &&
    canOnScreen('patient.read') &&
    moduleOpenOnScreen('patients'),
)
const patientLink = computed(() =>
  props.appointment.patient_id === null
    ? null
    : { name: 'patient' as const, params: { id: props.appointment.patient_id } },
)
const queueLinkOffered = computed(
  () =>
    props.appointment.status === 'ARRIVED' &&
    moduleOpenOnScreen('today') &&
    (canOnScreen('visit.register') || canOnScreen('agenda.read')),
)
const consultationsLinkOffered = computed(
  () =>
    props.appointment.status === 'ARRIVED' &&
    moduleOpenOnScreen('consultations') &&
    canOnScreen('clinical.read'),
)

async function afterOutcome(outcome: MutationOutcome, done: string): Promise<boolean> {
  switch (outcome.kind) {
    case 'synced':
      mutation.reset()
      emit('changed', done)
      return true
    case 'conflict':
      emit('stale', `Le rendez-vous de ${name.value} a changé entre-temps : l’agenda a été relu.`)
      return true
    case 'refused':
      if (outcome.error.status === 409) {
        emit('stale', `${outcome.error.message} L’agenda a été relu.`)
        return true
      }
      error.value = Object.values(outcome.error.fields)[0]?.[0] ?? outcome.error.message
      return false
    case 'session-expired':
    case 'reauthentication-required':
      void revalidateSession().catch(() => undefined)
      error.value = mutation.failureMessage.value
      return false
    default:
      error.value = mutation.failureMessage.value
      return false
  }
}

// --- Annuler ---------------------------------------------------------------------------------------
const cancelOpen = ref(false)
const cancelReason = ref('')

async function confirmCancel(): Promise<void> {
  if (saving.value) return
  const checked = validateCancelReason(cancelReason.value)
  if (!checked.ok) {
    error.value = checked.error
    document.getElementById(REASON_ID)?.focus()
    return
  }
  error.value = null
  const closed = await afterOutcome(
    await mutation.submit({
      name: 'CancelAppointment',
      route: {
        method: 'POST',
        path: `/appointments/${props.appointment.id}/cancel`,
        expectedVersion: 'entity',
      },
      payload: { reason: checked.reason },
      expectedVersion: props.appointment.version,
    }),
    `Rendez-vous de ${name.value} annulé sur le serveur ; le créneau est libéré.`,
  )
  if (closed) {
    cancelOpen.value = false
    cancelReason.value = ''
  }
}

// --- Absent ----------------------------------------------------------------------------------------
async function markNoShow(): Promise<void> {
  if (saving.value) return
  error.value = null
  await afterOutcome(
    await mutation.submit({
      name: 'MarkAppointmentNoShow',
      route: {
        method: 'POST',
        path: `/appointments/${props.appointment.id}/no-show`,
        expectedVersion: 'entity',
      },
      payload: {},
      expectedVersion: props.appointment.version,
    }),
    `Absence de ${name.value} constatée sur le serveur.`,
  )
}

// --- Déplacer --------------------------------------------------------------------------------------
const moving = ref(false)
const moveDay = ref<string | null>(null)
const slots = ref<AvailableSlots | null>(null)
const slotsError = ref<string | null>(null)
const loadingSlots = ref(false)
const chosen = ref<string | null>(null)

function startMove(): void {
  moving.value = true
  moveDay.value = dayOf(props.appointment.starts_at, timeZone).toString()
  void loadSlots()
}

async function loadSlots(): Promise<void> {
  slots.value = null
  chosen.value = null
  slotsError.value = null
  if (moveDay.value === null || !/^\d{4}-\d{2}-\d{2}$/.test(moveDay.value)) return
  loadingSlots.value = true
  try {
    slots.value = (
      await listAvailableSlots(
        moveDay.value,
        props.appointment.resource_id,
        props.appointment.service_id,
      )
    ).data
  } catch {
    slotsError.value = 'Créneaux indisponibles : la lecture du serveur a échoué. Réessayez.'
  } finally {
    loadingSlots.value = false
  }
}

async function confirmMove(): Promise<void> {
  if (saving.value) return
  const slot = slots.value?.slots.find((candidate) => candidate.starts_at === chosen.value)
  if (slot === undefined) {
    error.value = 'Choisissez un nouveau créneau.'
    return
  }
  error.value = null
  const closed = await afterOutcome(
    await mutation.submit({
      name: 'RescheduleAppointment',
      route: {
        method: 'POST',
        path: `/appointments/${props.appointment.id}/reschedule`,
        expectedVersion: 'entity',
      },
      payload: { starts_at: slot.starts_at, ends_at: slot.ends_at },
      expectedVersion: props.appointment.version,
    }),
    `Rendez-vous de ${name.value} déplacé sur le serveur (${formatTimeFr(slot.starts_at)}).`,
  )
  if (closed) moving.value = false
}
</script>

<template>
  <article
    :aria-labelledby="`${ids}-titre`"
    :class="[
      'relative @container rounded-xl border border-l-4 border-line',
      look.rail,
      look.quiet ? 'bg-canvas' : 'bg-surface shadow-card',
    ]"
  >
    <div class="space-y-3 p-4 sm:p-5 @lg:p-5 @lg:pl-32">
      <header class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h3 :id="`${ids}-titre`" class="min-w-0 flex-1 break-words">
          <span
            class="flex flex-wrap items-center gap-x-1.5 text-base font-semibold tabular-nums @lg:absolute @lg:inset-y-0 @lg:left-0 @lg:w-28 @lg:flex-col @lg:flex-nowrap @lg:gap-0.5 @lg:border-r @lg:border-line @lg:px-2 @lg:pt-5"
          >
            <AppIcon name="clock" :size="16" class="text-gold @lg:hidden" />
            <span class="@lg:text-xl">{{ start }}</span>
            <span class="text-muted @lg:text-sm"> – {{ end }}</span>
          </span>
          <span class="sr-only"> · </span>
          <RouterLink
            v-if="canOpenPatient && patientLink"
            :to="patientLink"
            class="mt-1 inline-flex min-h-11 items-center text-lg leading-snug font-semibold text-primary underline underline-offset-4 hover:decoration-gold hover:decoration-2 @lg:mt-0"
          >
            {{ name }}
          </RouterLink>
          <span v-else class="mt-1 block text-lg leading-snug font-semibold @lg:mt-0">{{
            name
          }}</span>
        </h3>
        <StatusChip as="p" :tone="look.tone" :icon="look.icon"
          ><span class="sr-only">Statut : </span
          >{{ APPOINTMENT_STATUS_LABELS[props.appointment.status] }}</StatusChip
        >
      </header>

      <ul class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        <li class="flex min-w-0 items-center gap-1.5">
          <AppIcon name="stethoscope" :size="16" class="text-gold" />
          <span class="min-w-0 break-words">{{ props.appointment.service_name }}</span>
        </li>
        <li class="flex min-w-0 items-center gap-1.5">
          <AppIcon name="building" :size="16" class="text-gold" />
          <span class="min-w-0 break-words">{{ props.appointment.resource_name }}</span>
        </li>
        <li v-if="props.appointment.patient" class="flex min-w-0 items-center gap-1.5">
          <AppIcon name="id-card" :size="16" class="text-gold" />
          <span class="min-w-0 break-words"
            >Dossier {{ props.appointment.patient.record_number }}</span
          >
        </li>
      </ul>
      <p
        v-if="props.appointment.administrative_reason"
        class="border-l-2 border-gold pl-3 text-sm break-words"
      >
        <span class="font-semibold">Note :</span> {{ props.appointment.administrative_reason }}
      </p>
      <p
        v-if="props.appointment.cancel_reason"
        class="border-l-2 border-field pl-3 text-sm break-words"
      >
        <span class="font-semibold">Motif de l’annulation :</span>
        {{ props.appointment.cancel_reason }}
      </p>

      <div
        v-if="
          arrivalOffered ||
          changeable ||
          noShowOffered ||
          canOpenPatient ||
          queueLinkOffered ||
          consultationsLinkOffered
        "
        class="flex flex-wrap gap-2 border-t border-line pt-3"
      >
        <LinkButton
          v-if="arrivalOffered"
          :to="arrivalLink"
          variant="primary"
          :accessible-name="`Enregistrer l’arrivée de ${name}`"
        >
          <AppIcon name="arrival" />
          Enregistrer l’arrivée
        </LinkButton>
        <LinkButton
          v-if="queueLinkOffered"
          :to="{ name: 'aujourdhui' }"
          variant="primary"
          :accessible-name="`Voir ${name} dans la file du jour`"
        >
          <AppIcon name="today" />
          Voir la file du jour
        </LinkButton>
        <LinkButton
          v-if="consultationsLinkOffered"
          :to="{ name: 'consultations' }"
          variant="secondary"
        >
          <AppIcon name="consultations" />
          Consultations
        </LinkButton>
        <LinkButton
          v-if="canOpenPatient && patientLink"
          :to="patientLink"
          variant="secondary"
          :accessible-name="`Ouvrir la fiche de ${name}`"
        >
          <AppIcon name="user" />
          Fiche du patient
        </LinkButton>
        <AppButton
          v-if="changeable && !moving"
          variant="secondary"
          :accessible-name="`Déplacer le rendez-vous de ${name}`"
          @click="startMove"
        >
          <AppIcon name="calendar" />
          Déplacer
        </AppButton>
        <AppButton
          v-if="noShowOffered"
          variant="secondary"
          :pending="saving"
          pending-label="Enregistrement…"
          :accessible-name="`Constater l’absence de ${name}`"
          @click="markNoShow"
        >
          <AppIcon name="alert" />
          Absent
        </AppButton>
        <AppButton
          v-if="changeable"
          variant="ghost"
          :accessible-name="`Annuler le rendez-vous de ${name}`"
          @click="cancelOpen = true"
        >
          <AppIcon name="x" />
          Annuler
        </AppButton>
      </div>

      <form
        v-if="moving"
        class="space-y-4 rounded-xl border border-line bg-canvas p-4"
        novalidate
        @submit.prevent="confirmMove"
      >
        <div class="sm:max-w-xs">
          <DateField
            v-model="moveDay"
            label="Nouveau jour"
            :control-id="`${ids}-jour`"
            @update:model-value="loadSlots"
          />
        </div>
        <p v-if="loadingSlots" role="status" class="flex items-center gap-2 text-muted">
          <AppIcon name="clock" :size="18" />
          Lecture des créneaux libres…
        </p>
        <p
          v-else-if="slotsError"
          role="alert"
          class="flex items-start gap-2 font-medium text-danger"
        >
          <AppIcon name="alert" :size="18" class="mt-0.5" />
          <span>{{ slotsError }}</span>
        </p>
        <fieldset v-else-if="slots" class="space-y-3">
          <legend class="font-semibold">Créneau libre</legend>
          <p v-if="slots.slots.length === 0" class="text-muted">Aucun créneau libre ce jour-là.</p>
          <div class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,6.5rem),1fr))] gap-2">
            <SlotOption v-for="slot in slots.slots" :key="slot.starts_at">
              <input
                v-model="chosen"
                type="radio"
                :name="`${ids}-creneau`"
                :value="slot.starts_at"
                class="size-4 shrink-0 accent-primary"
              />
              <span>{{ formatTimeFr(slot.starts_at) }}</span>
            </SlotOption>
          </div>
        </fieldset>
        <div class="form-actions">
          <AppButton type="submit" variant="primary" :pending="saving" pending-label="Déplacement…">
            <AppIcon name="check" />
            Déplacer le rendez-vous
          </AppButton>
          <AppButton variant="ghost" :disabled="saving" @click="moving = false"
            >Garder l’heure</AppButton
          >
        </div>
      </form>

      <p v-if="error" role="alert" class="text-sm font-medium text-danger">
        <span aria-hidden="true">⚠ </span>{{ error }}
      </p>
    </div>

    <ConfirmDialog
      :open="cancelOpen"
      :title="`Annuler le rendez-vous de ${name} ?`"
      confirm-label="Annuler le rendez-vous"
      cancel-label="Garder le rendez-vous"
      tone="danger"
      :pending="saving"
      pending-label="Annulation…"
      :initial-focus="REASON_ID"
      @confirm="confirmCancel"
      @cancel="cancelOpen = false"
    >
      <TextAreaField
        v-model="cancelReason"
        label="Motif de l’annulation (obligatoire)"
        :control-id="REASON_ID"
        :maxlength="CANCEL_REASON_MAX_LENGTH"
        :rows="3"
      />
    </ConfirmDialog>
  </article>
</template>
