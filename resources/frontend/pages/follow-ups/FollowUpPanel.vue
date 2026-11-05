<script setup lang="ts">
/**
 * « Contrôle recommandé » d'une consultation (S02 ; fichier 02 « Un contrôle recommandé possède un délai, une date
 * de départ, une date calculée, un canal souhaité, une politique de rappel et des observations ») : les contrôles
 * déjà programmés et, pour qui peut les programmer (`follow_up.write` et `clinical.read`), le formulaire.
 *
 * - La date de départ est choisie EXPLICITEMENT : la consultation (sa date effective), le début ou la fin du
 *   traitement (date donnée par le professionnel), ou une date saisie à la main avec un motif.
 * - Le délai est celui du professionnel (10, 12 ou 14 jours, 3 ou 6 mois, 1 ou 2 ans, ou autre) : aucun choix
 *   médical automatique. La date calculée et sa provenance sont affichées ; le serveur la recalcule.
 * - Rappel interne activé ou non, canal souhaité, avance (1, 3 ou 7 jours, 1 mois) : aucune transmission externe.
 * Ce n'est pas un rendez-vous : « Programmer un rendez-vous » le prend ensuite dans l'agenda.
 *
 * Présentation : carte de section ; chaque contrôle avec sa date en évidence et son statut en
 * puce ; formulaire en deux colonnes sur tablette, date recommandée encadrée en or.
 */
import { computed, ref, useId } from 'vue'

import { clinicTimeZone, formatDayFr } from '@/app/clinicTime'
import { listConsultationFollowUps } from '@/app/services/agenda'
import { getConsultation } from '@/app/services/consultations'
import type { MutationOutcome } from '@/app/services/mutations'
import { useMutation } from '@/app/services/useMutation'
import { canOnScreen, knownAccountId, moduleOpenOnScreen, revalidateSession } from '@/app/session'
import { FOLLOW_UP_STATUS_TONES } from '@/components/agenda/tones'
import StateMessage from '@/components/feedback/StateMessage.vue'
import CheckboxField from '@/components/form/CheckboxField.vue'
import DateField from '@/components/form/DateField.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import TextField from '@/components/form/TextField.vue'
import SectionCard from '@/components/layout/SectionCard.vue'
import StatusChip from '@/components/layout/StatusChip.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import {
  ADVANCE_PRESETS,
  ANCHOR_KIND_LABELS,
  calculatedDate,
  CHANNEL_LABELS,
  dayOf,
  FOLLOW_UP_REASON_LABELS,
  FOLLOW_UP_STATUS_LABELS,
  INTERVAL_PRESETS,
  PREFERRED_CHANNELS,
} from '@/domain/agenda/agenda'
import { canCancelFollowUp } from '@/domain/clinical/draftDeletion'
import type {
  Consultation,
  FollowUpPlan,
  FollowUpPlansAnchorKind,
  FollowUpPlansIntervalUnit,
  FollowUpPlansReason,
} from '@/domain/contracts/generated'
import { patientDisplayName } from '@/domain/patients/identity'
import { CivilDate } from '@/domain/values/civilDate'
import { useServerRead } from '@/pages/today/useServerRead'

import CancelFollowUpDialog from './CancelFollowUpDialog.vue'

const props = defineProps<{ consultationId: string }>()

const ids = useId()
const timeZone = clinicTimeZone()
const visible = computed(
  () => moduleOpenOnScreen('agenda') && canOnScreen('clinical.read') && canOnScreen('agenda.read'),
)
const canCreate = computed(() => canOnScreen('follow_up.write'))

const plans = useServerRead<FollowUpPlan[]>(() => listConsultationFollowUps(props.consultationId))
// La consultation ne sert qu'au formulaire (date de départ, patient) : elle n'est lue qu'à son ouverture, jamais en double
// avec celle de l'écran de la consultation.
const consultation = useServerRead<Consultation>(() => getConsultation(props.consultationId), {
  lazy: true,
})
const consultationDay = computed(() =>
  consultation.data.value === null ? null : dayOf(consultation.data.value.effective_at, timeZone),
)

const mutation = useMutation()
const saving = computed(() => mutation.state.value === 'saving')
const open = ref(false)

function openForm(): void {
  open.value = true
  if (consultation.data.value === null) void consultation.reload()
}
const flash = ref<string | null>(null)
const error = ref<string | null>(null)

// Annulation d'un contrôle encore actif (motif obligatoire) : une seule boîte pour tout le panneau.
const cancelling = ref<FollowUpPlan | null>(null)
const cancelProblem = ref<string | null>(null)

function cancellable(plan: FollowUpPlan): boolean {
  return canCancelFollowUp(plan, { accountId: knownAccountId(), can: canOnScreen })
}

function planPatient(plan: FollowUpPlan): string {
  return patientDisplayName(plan.patient.last_name, plan.patient.first_names)
}

function afterCancel(message: string, success: boolean): void {
  cancelling.value = null
  flash.value = success ? message : null
  cancelProblem.value = success ? null : message
  void plans.reload()
}

const reason = ref<string | null>('ROUTINE')
const anchorKind = ref<string | null>('CONSULTATION')
const anchorDay = ref<string | null>(null)
const preset = ref<string | null>('3m')
const otherValue = ref('')
const otherUnit = ref<string | null>('MONTH')
const manualDay = ref<string | null>(null)
const manualReason = ref('')
const reminder = ref(true)
const channel = ref<string | null>('CALL')
const advance = ref<string | null>('7d')
const notes = ref('')

const reasonOptions = (Object.keys(FOLLOW_UP_REASON_LABELS) as FollowUpPlansReason[]).map(
  (value) => ({
    value,
    label: FOLLOW_UP_REASON_LABELS[value],
  }),
)
const anchorOptions = (Object.keys(ANCHOR_KIND_LABELS) as FollowUpPlansAnchorKind[]).map(
  (value) => ({
    value,
    label: ANCHOR_KIND_LABELS[value],
  }),
)
const intervalOptions = [
  ...INTERVAL_PRESETS.map((option) => ({ value: option.key, label: option.label })),
  { value: 'other', label: 'Autre délai' },
]
const unitOptions = [
  { value: 'DAY', label: 'jours' },
  { value: 'MONTH', label: 'mois' },
  { value: 'YEAR', label: 'ans' },
]
const channelOptions = PREFERRED_CHANNELS.map((value) => ({ value, label: CHANNEL_LABELS[value] }))
const advanceOptions = ADVANCE_PRESETS.map((option) => ({ value: option.key, label: option.label }))

function parseDay(value: string | null): CivilDate | null {
  try {
    return value === null ? null : CivilDate.parse(value)
  } catch {
    return null
  }
}

const manual = computed(() => anchorKind.value === 'MANUAL')
const anchor = computed<CivilDate | null>(() => {
  if (anchorKind.value === 'CONSULTATION') return consultationDay.value
  if (manual.value) return parseDay(manualDay.value)
  return parseDay(anchorDay.value)
})
const interval = computed<{ value: number | null; unit: FollowUpPlansIntervalUnit | null }>(() => {
  if (manual.value) return { value: null, unit: null }
  const chosen = INTERVAL_PRESETS.find((option) => option.key === preset.value)
  if (chosen !== undefined) return { value: chosen.value, unit: chosen.unit }
  const value = Number(otherValue.value)
  return Number.isSafeInteger(value) && value >= 1
    ? { value, unit: (otherUnit.value as FollowUpPlansIntervalUnit | null) ?? null }
    : { value: null, unit: null }
})
const recommended = computed<CivilDate | null>(() =>
  manual.value
    ? parseDay(manualDay.value)
    : calculatedDate(anchor.value, interval.value.value, interval.value.unit),
)

async function afterOutcome(outcome: MutationOutcome): Promise<void> {
  switch (outcome.kind) {
    case 'synced':
      open.value = false
      mutation.reset()
      flash.value = 'Contrôle recommandé enregistré sur le serveur.'
      void plans.reload()
      return
    case 'refused':
      error.value = Object.values(outcome.error.fields)[0]?.[0] ?? outcome.error.message
      return
    case 'session-expired':
    case 'reauthentication-required':
      void revalidateSession().catch(() => undefined)
      error.value = mutation.failureMessage.value
      return
    default:
      error.value = mutation.failureMessage.value
  }
}

async function save(): Promise<void> {
  if (saving.value || consultation.data.value === null) return
  error.value = null
  flash.value = null
  if (anchor.value === null || recommended.value === null) {
    error.value = manual.value
      ? 'Indiquez la date du contrôle.'
      : 'Indiquez la date de départ et le délai du contrôle.'
    return
  }
  if (manual.value && manualReason.value.trim().length < 3) {
    error.value = 'Une date saisie à la main porte son motif (au moins 3 caractères).'
    return
  }
  const chosenAdvance =
    ADVANCE_PRESETS.find((option) => option.key === advance.value) ?? ADVANCE_PRESETS[0]!
  const text = notes.value.trim()
  await afterOutcome(
    await mutation.submit({
      name: 'CreateFollowUp',
      payload: {
        follow_up_plan_id: mutation.effectId('follow_up_plan_id'),
        consultation_id: props.consultationId,
        patient_id: consultation.data.value.patient.id,
        reason: reason.value,
        anchor_kind: anchorKind.value,
        anchor_date: anchor.value.toString(),
        interval_value: interval.value.value,
        interval_unit: interval.value.unit,
        recommended_date: recommended.value.toString(),
        date_origin: manual.value ? 'MANUAL' : 'CALCULATED',
        manual_reason: manual.value ? manualReason.value.trim() : null,
        reminder_enabled: reminder.value,
        preferred_channel: channel.value,
        advance_value: reminder.value ? chosenAdvance.value : null,
        advance_unit: reminder.value ? chosenAdvance.unit : null,
        notes: text === '' ? null : text,
      },
    }),
  )
}
</script>

<template>
  <SectionCard
    v-if="visible"
    title="Contrôle recommandé"
    title-id="titre-controle"
    icon="calendar"
    class="max-w-3xl"
  >
    <template v-if="canCreate && !open" #actions>
      <AppButton variant="secondary" @click="openForm()">
        <AppIcon name="plus" />
        Programmer un contrôle
      </AppButton>
    </template>

    <div class="space-y-4">
      <StateMessage v-if="flash" state="success" :title="flash" />
      <StateMessage v-if="cancelProblem" state="conflict" :title="cancelProblem" />

      <p
        v-if="plans.state.value === 'ready' && (plans.data.value ?? []).length === 0"
        class="flex items-center gap-2 text-muted"
      >
        <AppIcon name="calendar" class="text-gold" />
        Aucun contrôle programmé pour cette consultation.
      </p>
      <ul v-else-if="plans.data.value" class="space-y-3">
        <li
          v-for="plan in plans.data.value"
          :key="plan.id"
          class="space-y-2 rounded-xl border border-l-4 border-line border-l-gold bg-canvas p-4 text-sm break-words"
        >
          <div class="flex flex-wrap items-start justify-between gap-2">
            <p class="min-w-0 text-base font-semibold text-ink">
              Le {{ formatDayFr(CivilDate.fromString(plan.recommended_date)) }}
              <span v-if="plan.reason" class="font-normal text-muted"
                >· {{ FOLLOW_UP_REASON_LABELS[plan.reason] }}</span
              >
            </p>
            <StatusChip as="p" :tone="FOLLOW_UP_STATUS_TONES[plan.status]">{{
              FOLLOW_UP_STATUS_LABELS[plan.status]
            }}</StatusChip>
          </div>
          <p class="text-muted">
            {{
              plan.date_origin === 'MANUAL'
                ? 'Date saisie à la main'
                : `Calculée depuis : ${ANCHOR_KIND_LABELS[plan.anchor_kind]} (${formatDayFr(CivilDate.fromString(plan.anchor_date))})`
            }}
            <template v-if="plan.reminder_date">
              · Rappel interne le
              {{ formatDayFr(CivilDate.fromString(plan.reminder_date)) }}</template
            >
          </p>
          <LinkButton
            v-if="plan.status === 'ACTIVE' && canOnScreen('agenda.write')"
            :to="{
              name: 'rendez-vous-nouveau',
              query: { patient: plan.patient_id, suivi: plan.id },
            }"
            variant="ghost"
          >
            <AppIcon name="calendar-plus" />
            Programmer un rendez-vous
          </LinkButton>
          <AppButton
            v-if="cancellable(plan)"
            variant="ghost"
            :accessible-name="`Annuler le contrôle de ${planPatient(plan)}`"
            @click="cancelling = plan"
            >Annuler le contrôle</AppButton
          >
        </li>
      </ul>

      <CancelFollowUpDialog
        v-if="cancelling"
        :plan-id="cancelling.id"
        :version="cancelling.version"
        :patient-name="planPatient(cancelling)"
        @cancelled="afterCancel($event, true)"
        @stale="afterCancel($event, false)"
        @close="cancelling = null"
      />

      <form
        v-if="open"
        class="space-y-4 rounded-xl border border-line bg-canvas p-4 sm:p-5"
        novalidate
        @submit.prevent="save"
      >
        <div class="form-grid">
          <SelectField
            v-model="reason"
            label="Motif du contrôle"
            :options="reasonOptions"
            :control-id="`${ids}-motif`"
          />
          <SelectField
            v-model="anchorKind"
            label="Date de départ"
            :options="anchorOptions"
            :control-id="`${ids}-depart`"
          />
          <p
            v-if="anchorKind === 'CONSULTATION' && consultationDay"
            class="col-span-full text-sm text-muted"
          >
            Consultation du {{ formatDayFr(consultationDay) }}.
          </p>
          <DateField
            v-if="anchorKind === 'TREATMENT_START' || anchorKind === 'TREATMENT_END'"
            v-model="anchorDay"
            :label="anchorKind === 'TREATMENT_START' ? 'Début du traitement' : 'Fin du traitement'"
            hint="Date donnée par le professionnel : aucune durée de traitement n’est supposée."
            :control-id="`${ids}-ancre`"
          />
          <template v-if="!manual">
            <SelectField
              v-model="preset"
              label="Délai"
              :options="intervalOptions"
              :control-id="`${ids}-delai`"
            />
            <div v-if="preset === 'other'" class="grid grid-cols-[8rem_minmax(0,1fr)] gap-3">
              <TextField
                v-model="otherValue"
                label="Nombre"
                inputmode="numeric"
                :control-id="`${ids}-nombre`"
              />
              <SelectField
                v-model="otherUnit"
                label="Unité"
                :options="unitOptions"
                :control-id="`${ids}-unite`"
              />
            </div>
          </template>
          <template v-else>
            <DateField v-model="manualDay" label="Date du contrôle" :control-id="`${ids}-date`" />
            <TextAreaField
              v-model="manualReason"
              class="col-span-full"
              label="Motif de la date saisie à la main (obligatoire)"
              :control-id="`${ids}-motif-date`"
              :rows="2"
              :maxlength="4000"
            />
          </template>
        </div>

        <p
          class="rounded-xl border border-gold bg-gold-soft p-4 font-medium text-ink"
          role="status"
        >
          <template v-if="recommended">
            Date recommandée :
            <span class="font-semibold">{{ formatDayFr(recommended) }}</span>
            <span class="text-sm font-normal text-muted">
              ({{
                manual ? 'saisie à la main' : 'date de départ + délai, au calendrier civil'
              }})</span
            >
          </template>
          <template v-else>Date recommandée : à compléter.</template>
        </p>

        <div class="form-grid">
          <CheckboxField
            v-model="reminder"
            class="col-span-full"
            label="Rappel interne (liste « Patients à rappeler »)"
            :control-id="`${ids}-rappel`"
          />
          <SelectField
            v-if="reminder"
            v-model="advance"
            label="Quand rappeler"
            :options="advanceOptions"
            :control-id="`${ids}-avance`"
          />
          <SelectField
            v-model="channel"
            label="Canal souhaité par le patient"
            :options="channelOptions"
            :control-id="`${ids}-canal`"
          />
          <TextAreaField
            v-model="notes"
            class="col-span-full"
            label="Observations (facultatives)"
            :control-id="`${ids}-notes`"
            :rows="3"
            :maxlength="4000"
          />
        </div>

        <p v-if="error" role="alert" class="font-medium text-danger">
          <span aria-hidden="true">⚠ </span>{{ error }}
        </p>
        <div class="form-actions">
          <AppButton
            type="submit"
            variant="primary"
            :pending="saving"
            pending-label="Enregistrement…"
          >
            <AppIcon name="check" />
            Enregistrer le contrôle
          </AppButton>
          <AppButton variant="ghost" :disabled="saving" @click="open = false">Annuler</AppButton>
        </div>
      </form>
    </div>
  </SectionCard>
</template>
