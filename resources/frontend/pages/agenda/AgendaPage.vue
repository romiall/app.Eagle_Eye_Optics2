<script setup lang="ts">
/**
 * Agenda interne (S01 ; fichier 02 « Agenda en vues jour et semaine ; RDV confirmé, arrivé, terminé, annulé,
 * absent »), EN LIGNE : les rendez-vous lus sur le serveur, par jour civil du cabinet, du plus tôt au plus tard, en
 * vues Jour, Semaine ou Mois (grille calendrier avec ajout en 1 clic sur chaque journée). Filtre par ressource.
 * Un rendez-vous n'est jamais dit confirmé sans la réponse du serveur ; une lecture qui échoue est « indisponible »,
 * jamais « aucun rendez-vous ».
 */
import { computed, ref, shallowRef } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import {
  clinicTimeZone,
  clinicToday,
  formatDayFr,
  formatMonthYearFr,
  formatTimeFr,
} from '@/app/clinicTime'
import { getAgendaConfiguration, listAppointments } from '@/app/services/agenda'
import { canOnScreen } from '@/app/session'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import DateField from '@/components/form/DateField.vue'
import SelectField from '@/components/form/SelectField.vue'
import EmptyState from '@/components/layout/EmptyState.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import SectionCard from '@/components/layout/SectionCard.vue'
import StatusChip from '@/components/layout/StatusChip.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import {
  type AgendaView,
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_SYMBOLS,
  groupByDay,
  monthGridWeeks,
  shownDays,
} from '@/domain/agenda/agenda'
import type { AgendaConfiguration, Appointment } from '@/domain/contracts/generated'
import { patientDisplayName } from '@/domain/patients/identity'
import { CivilDate } from '@/domain/values/civilDate'
import SalesReadMessage from '@/pages/sales/SalesReadMessage.vue'
import { useServerRead } from '@/pages/today/useServerRead'

import AppointmentCard from './AppointmentCard.vue'

const route = useRoute()
const timeZone = clinicTimeZone()
const initialView = ((): AgendaView => {
  const param = route.query['vue']
  return param === 'week' || param === 'month' || param === 'day' ? param : 'day'
})()
const initialDay = ((): string => {
  const param = route.query['jour']
  if (typeof param === 'string') {
    try {
      const parsed = CivilDate.parse(param)
      if (parsed !== null) return parsed.toString()
    } catch {
      // Paramètre d'adresse ignoré s'il n'est pas une date civile valide.
    }
  }
  return clinicToday().toString()
})()

const view = ref<AgendaView>(initialView)
const day = ref<string | null>(initialDay)
const resourceId = ref<string | null>(null)
const flash = ref<string | null>(null)
const stale = ref<string | null>(null)
const canWrite = computed(() => canOnScreen('agenda.write'))

/** Jour choisi ; une saisie incomplète ou invalide (dite par le champ) laisse aujourd'hui. */
const anchor = computed(() => {
  try {
    return (day.value === null ? null : CivilDate.parse(day.value)) ?? clinicToday()
  } catch {
    return clinicToday()
  }
})
const days = computed(() => shownDays(anchor.value, view.value))

const configuration = useServerRead<AgendaConfiguration>(() => getAgendaConfiguration())
const resourceOptions = computed(() => [
  { value: '', label: 'Toutes les ressources' },
  ...(configuration.data.value?.resources ?? [])
    .filter((resource) => resource.active)
    .map((resource) => ({ value: resource.id, label: resource.name })),
])

/**
 * Ce qui est LU et affiché : la vue, la période et la ressource APPLIQUÉES par « Afficher », les flèches,
 * « Aujourd’hui » ou « Jour / Semaine / Mois » (`show`). Saisir une date et sortir du champ ne les change pas.
 */
const applied = shallowRef<{
  view: AgendaView
  anchor: CivilDate
  days: CivilDate[]
  resourceId: string | null
}>({
  view: view.value,
  anchor: anchor.value,
  days: days.value,
  resourceId: null,
})

const selectedCalendarDay = ref<CivilDate>(anchor.value)

/** Les rendez-vous lus et les jours de CETTE lecture : ils voyagent ensemble, jamais l'un sans l'autre. */
interface ShownAgenda {
  days: CivilDate[]
  appointments: Appointment[]
}

const read = useServerRead<ShownAgenda>(async () => {
  const { days: list, resourceId: onlyResource } = applied.value
  const outcome = await listAppointments(list[0]!.toString(), list[list.length - 1]!.toString(), {
    resourceId: onlyResource,
  })
  return { ...outcome, data: { days: list, appointments: outcome.data } }
})
const grouped = computed(() =>
  read.data.value === null
    ? []
    : groupByDay(read.data.value.appointments, read.data.value.days, timeZone),
)
const groupedByKey = computed(
  () => new Map(grouped.value.map((entry) => [entry.day.toString(), entry.appointments])),
)
const monthWeeks = computed(() =>
  applied.value.view === 'month' ? monthGridWeeks(applied.value.anchor) : [],
)
const selectedCalendarGroup = computed(() => {
  if (applied.value.view !== 'month' || grouped.value.length === 0) return null
  const key = selectedCalendarDay.value.toString()
  return (
    grouped.value.find((entry) => entry.day.toString() === key) ??
    grouped.value.find((entry) => entry.day.month === applied.value.anchor.month) ??
    grouped.value[0] ??
    null
  )
})
const weekShown = computed(() => applied.value.view === 'week')
const monthShown = computed(() => applied.value.view === 'month')

const title = computed(() => {
  const list = applied.value.days
  if (applied.value.view === 'month') return `Agenda : ${formatMonthYearFr(applied.value.anchor)}`
  if (list.length === 1) return `Agenda du ${formatDayFr(list[0]!)}`
  return `Agenda : semaine du ${formatDayFr(list[0]!)} au ${formatDayFr(list[list.length - 1]!)}`
})

/** Repère « Aujourd’hui » d'une carte de jour (jour civil du cabinet). */
function isToday(shownDay: CivilDate): boolean {
  return shownDay.compare(clinicToday()) === 0
}

function isSelectedCalendarDay(shownDay: CivilDate): boolean {
  return selectedCalendarDay.value.compare(shownDay) === 0
}

function selectCalendarDay(shownDay: CivilDate): void {
  selectedCalendarDay.value = shownDay
  day.value = shownDay.toString()
}

function newAppointmentRoute(targetDay: CivilDate) {
  return {
    name: 'rendez-vous-nouveau' as const,
    query: {
      jour: targetDay.toString(),
      ...(applied.value.resourceId ? { ressource: applied.value.resourceId } : {}),
    },
  }
}

function appointmentsOn(shownDay: CivilDate): Appointment[] {
  return groupedByKey.value.get(shownDay.toString()) ?? []
}

function shortPatientName(appointment: Appointment): string {
  if (appointment.patient === null) return 'Patient'
  return patientDisplayName(appointment.patient.last_name, appointment.patient.first_names)
}

/** Applique les champs : lit la période et la ressource choisies, puis les affiche. */
function show(): void {
  const nextAnchor = anchor.value
  const nextDays = shownDays(nextAnchor, view.value)
  applied.value = {
    view: view.value,
    anchor: nextAnchor,
    days: nextDays,
    resourceId: resourceId.value === null || resourceId.value === '' ? null : resourceId.value,
  }
  if (
    view.value === 'month' &&
    !nextDays.some((entry) => entry.compare(selectedCalendarDay.value) === 0)
  ) {
    selectedCalendarDay.value = nextAnchor
  }
  void read.reload()
}

function shift(direction: -1 | 1): void {
  if (view.value === 'month') {
    const next = anchor.value.addMonths(direction)
    day.value = next.toString()
    selectedCalendarDay.value = CivilDate.of(next.year, next.month, 1)
  } else {
    const step = view.value === 'day' ? 1 : 7
    const next = anchor.value.addDays(direction * step)
    day.value = next.toString()
    selectedCalendarDay.value = next
  }
  show()
}

function today(): void {
  const nowDay = clinicToday()
  day.value = nowDay.toString()
  selectedCalendarDay.value = nowDay
  show()
}

function setView(next: AgendaView): void {
  view.value = next
  if (next === 'month') {
    selectedCalendarDay.value = anchor.value
  }
  show()
}

function changed(message: string): void {
  stale.value = null
  flash.value = message
  void read.reload()
}

function staled(message: string): void {
  flash.value = null
  stale.value = message
  void read.reload()
}

const WEEKDAY_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const
</script>

<template>
  <section aria-labelledby="titre-agenda" class="page-stack max-w-6xl">
    <PageHeader title-id="titre-agenda" :title="title" icon="agenda">
      <div class="flex flex-wrap gap-2">
        <LinkButton :to="{ name: 'suivis' }" variant="secondary">
          <AppIcon name="phone" />
          Patients à rappeler
        </LinkButton>
        <LinkButton
          v-if="canOnScreen('users.manage')"
          :to="{ name: 'agenda-configuration' }"
          variant="ghost"
        >
          <AppIcon name="settings" />
          Configuration
        </LinkButton>
      </div>
      <template v-if="canWrite" #actions>
        <LinkButton :to="{ name: 'rendez-vous-nouveau' }" variant="primary">
          <AppIcon name="calendar-plus" />
          Nouveau rendez-vous
        </LinkButton>
      </template>
    </PageHeader>

    <StateMessage v-if="flash" state="success" :title="flash" />
    <StateMessage v-if="stale" state="conflict" :title="stale" />

    <div role="group" aria-label="Choisir les jours affichés" class="card space-y-4 p-4 sm:p-5">
      <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div class="grid grid-cols-3 gap-1 rounded-xl border border-line bg-canvas p-1">
          <AppButton variant="ghost" :pressed="view === 'day'" @click="setView('day')"
            >Jour</AppButton
          >
          <AppButton variant="ghost" :pressed="view === 'week'" @click="setView('week')"
            >Semaine</AppButton
          >
          <AppButton variant="ghost" :pressed="view === 'month'" @click="setView('month')"
            >Mois</AppButton
          >
        </div>
        <div class="flex items-center gap-2">
          <AppButton variant="secondary" @click="shift(-1)">
            <AppIcon name="chevron-left" />
            <span class="max-lg:sr-only">{{
              view === 'day'
                ? 'Jour précédent'
                : view === 'week'
                  ? 'Semaine précédente'
                  : 'Mois précédent'
            }}</span>
          </AppButton>
          <AppButton variant="secondary" class="grow sm:grow-0" @click="today">
            <AppIcon name="today" />
            Aujourd’hui
          </AppButton>
          <AppButton variant="secondary" @click="shift(1)">
            <span class="max-lg:sr-only">{{
              view === 'day'
                ? 'Jour suivant'
                : view === 'week'
                  ? 'Semaine suivante'
                  : 'Mois suivant'
            }}</span>
            <AppIcon name="chevron-right" />
          </AppButton>
        </div>
      </div>
      <form class="toolbar border-t border-line pt-4" @submit.prevent="show">
        <div class="min-w-0 sm:flex-1">
          <DateField v-model="day" label="Jour" control-id="agenda-jour" />
        </div>
        <div class="min-w-0 sm:flex-1">
          <SelectField
            v-model="resourceId"
            label="Ressource"
            hint="Professionnel ou salle d’examen."
            :options="resourceOptions"
            control-id="agenda-ressource"
          />
        </div>
        <AppButton type="submit" variant="secondary">Afficher</AppButton>
      </form>
    </div>

    <SalesReadMessage
      v-if="read.state.value !== 'ready'"
      :state="read.state.value"
      subject="l’agenda"
      :error="read.error.value"
      @retry="read.reload()"
    />

    <template v-else>
      <template v-if="monthShown">
        <SectionCard
          :title="`Calendrier : ${formatMonthYearFr(applied.anchor)}`"
          title-id="titre-calendrier-mois"
          description="Touchez un jour pour consulter ses rendez-vous en détail, ou ajoutez directement un rendez-vous sur le jour voulu."
          icon="calendar"
        >
          <!-- Grille compacte sur téléphone (360 px sans débordement, cibles >= 44 px) -->
          <div class="space-y-2 md:hidden">
            <div class="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-muted">
              <span v-for="weekday in WEEKDAY_SHORT" :key="weekday">{{ weekday }}</span>
            </div>
            <div class="grid grid-cols-7 gap-1">
              <button
                v-for="cell in monthWeeks.flat()"
                :key="cell.day.toString()"
                type="button"
                :aria-label="`${formatDayFr(cell.day)} (${appointmentsOn(cell.day).length} rendez-vous)`"
                :aria-pressed="isSelectedCalendarDay(cell.day)"
                :class="[
                  'flex min-h-11 flex-col items-center justify-center rounded-lg border text-sm font-semibold tabular-nums transition-colors',
                  isSelectedCalendarDay(cell.day)
                    ? 'border-primary bg-primary text-primary-contrast'
                    : isToday(cell.day)
                      ? 'border-gold bg-gold-soft text-ink'
                      : cell.inMonth
                        ? 'border-line bg-surface text-ink hover:border-primary'
                        : 'border-transparent bg-canvas text-muted opacity-65',
                ]"
                @click="selectCalendarDay(cell.day)"
              >
                <span>{{ cell.day.day }}</span>
                <span
                  v-if="appointmentsOn(cell.day).length > 0"
                  :class="[
                    'text-[11px] leading-none font-medium',
                    isSelectedCalendarDay(cell.day) ? 'text-primary-contrast' : 'text-gold-ink',
                  ]"
                >
                  {{ appointmentsOn(cell.day).length }}
                </span>
              </button>
            </div>
          </div>

          <!-- Grille calendrier complète sur tablette et ordinateur -->
          <div class="hidden space-y-2 md:block">
            <div class="grid grid-cols-7 gap-2 text-center text-sm font-semibold text-muted">
              <span v-for="weekday in WEEKDAY_SHORT" :key="weekday">{{ weekday }}</span>
            </div>
            <div class="grid grid-cols-7 gap-2">
              <div
                v-for="cell in monthWeeks.flat()"
                :key="cell.day.toString()"
                :class="[
                  'flex min-h-32 min-w-0 flex-col justify-between gap-2 rounded-xl border p-2 transition-colors',
                  isSelectedCalendarDay(cell.day)
                    ? 'border-primary bg-primary-soft ring-1 ring-primary'
                    : isToday(cell.day)
                      ? 'border-gold bg-gold-soft/40'
                      : cell.inMonth
                        ? 'border-line bg-surface'
                        : 'border-line/60 bg-canvas opacity-70',
                ]"
              >
                <div class="flex items-start justify-between gap-1">
                  <button
                    type="button"
                    :aria-label="`Voir le ${formatDayFr(cell.day)}`"
                    :aria-pressed="isSelectedCalendarDay(cell.day)"
                    :class="[
                      'inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold tabular-nums hover:bg-canvas',
                      isSelectedCalendarDay(cell.day) ? 'text-primary' : 'text-ink',
                    ]"
                    @click="selectCalendarDay(cell.day)"
                  >
                    <span>{{ cell.day.day }}</span>
                    <span
                      v-if="isToday(cell.day)"
                      class="rounded bg-gold-soft px-1.5 py-0.5 text-[11px] font-semibold text-gold-ink"
                    >
                      Auj.
                    </span>
                  </button>
                  <RouterLink
                    v-if="canWrite"
                    :to="newAppointmentRoute(cell.day)"
                    :aria-label="`Prendre rendez-vous le ${formatDayFr(cell.day)}`"
                    title="Ajouter un rendez-vous ce jour"
                    class="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-line bg-canvas text-primary hover:border-primary hover:bg-primary hover:text-primary-contrast"
                  >
                    <AppIcon name="plus" :size="16" />
                  </RouterLink>
                </div>

                <ul v-if="appointmentsOn(cell.day).length > 0" class="space-y-1 text-xs">
                  <li
                    v-for="appointment in appointmentsOn(cell.day).slice(0, 3)"
                    :key="appointment.id"
                    class="truncate rounded bg-canvas px-1.5 py-1 text-ink"
                    :title="`${formatTimeFr(appointment.starts_at)} · ${shortPatientName(appointment)} (${APPOINTMENT_STATUS_LABELS[appointment.status]})`"
                  >
                    <span aria-hidden="true" class="mr-1 text-gold-ink">{{
                      APPOINTMENT_STATUS_SYMBOLS[appointment.status]
                    }}</span>
                    <strong class="tabular-nums">{{ formatTimeFr(appointment.starts_at) }}</strong>
                    {{ shortPatientName(appointment) }}
                  </li>
                  <li
                    v-if="appointmentsOn(cell.day).length > 3"
                    class="px-1.5 text-xs font-medium text-muted"
                  >
                    + {{ appointmentsOn(cell.day).length - 3 }} autre(s)
                  </li>
                </ul>
                <p v-else class="px-1.5 text-xs text-muted">Libre</p>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          v-if="selectedCalendarGroup"
          :title="formatDayFr(selectedCalendarGroup.day)"
          :title-id="`agenda-calendrier-detail-${selectedCalendarGroup.day.toString()}`"
          icon="calendar"
        >
          <template #actions>
            <StatusChip v-if="isToday(selectedCalendarGroup.day)" tone="gold" icon="today"
              >Aujourd’hui</StatusChip
            >
            <StatusChip v-if="selectedCalendarGroup.appointments.length > 0" tone="info"
              >{{ selectedCalendarGroup.appointments.length }} rendez-vous</StatusChip
            >
            <LinkButton
              v-if="canWrite"
              :to="newAppointmentRoute(selectedCalendarGroup.day)"
              variant="primary"
              :accessible-name="`Prendre rendez-vous le ${formatDayFr(selectedCalendarGroup.day)}`"
            >
              <AppIcon name="calendar-plus" />
              Prendre RDV ce jour
            </LinkButton>
          </template>
          <EmptyState
            v-if="selectedCalendarGroup.appointments.length === 0"
            title="Aucun rendez-vous ce jour-là."
            icon="calendar"
            flat
          >
            Aucun rendez-vous enregistré sur ce jour pour le filtre actuel.
          </EmptyState>
          <div v-else class="space-y-3">
            <AppointmentCard
              v-for="appointment in selectedCalendarGroup.appointments"
              :key="`${appointment.id}-${appointment.version}`"
              :appointment="appointment"
              @changed="changed"
              @stale="staled"
            />
          </div>
        </SectionCard>
      </template>

      <div v-else :class="weekShown ? 'grid gap-4 sm:gap-6 xl:grid-cols-2' : 'space-y-6'">
        <SectionCard
          v-for="group in grouped"
          :key="group.day.toString()"
          :title="formatDayFr(group.day)"
          :title-id="`agenda-jour-${group.day.toString()}`"
          icon="calendar"
        >
          <template v-if="isToday(group.day) || group.appointments.length > 0 || canWrite" #actions>
            <StatusChip v-if="isToday(group.day)" tone="gold" icon="today">Aujourd’hui</StatusChip>
            <StatusChip v-if="group.appointments.length > 0" tone="info"
              >{{ group.appointments.length }} rendez-vous</StatusChip
            >
            <LinkButton
              v-if="canWrite"
              :to="newAppointmentRoute(group.day)"
              variant="secondary"
              :accessible-name="`Prendre rendez-vous le ${formatDayFr(group.day)}`"
            >
              <AppIcon name="calendar-plus" />
              Prendre RDV ce jour
            </LinkButton>
          </template>
          <EmptyState
            v-if="group.appointments.length === 0 && !weekShown"
            title="Aucun rendez-vous ce jour-là."
            icon="calendar"
            flat
          >
            Choisissez un autre jour ou une autre ressource.
          </EmptyState>
          <p
            v-else-if="group.appointments.length === 0"
            class="flex items-center gap-2 rounded-lg border border-dashed border-line bg-canvas px-4 py-3 text-muted"
          >
            <AppIcon name="calendar" class="text-gold" />
            Aucun rendez-vous ce jour-là.
          </p>
          <div v-else class="space-y-3">
            <AppointmentCard
              v-for="appointment in group.appointments"
              :key="`${appointment.id}-${appointment.version}`"
              :appointment="appointment"
              @changed="changed"
              @stale="staled"
            />
          </div>
        </SectionCard>
      </div>
      <FreshnessNote
        v-if="read.freshness.value"
        :freshness="read.freshness.value"
        :time-zone="timeZone"
      />
    </template>
  </section>
</template>
