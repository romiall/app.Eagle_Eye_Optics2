<script setup lang="ts">
/**
 * Patients à rappeler et à revoir (S02 ; fichier 02 « une liste quotidienne permet contacté, RDV pris, sans réponse,
 * refus et reporté »), EN LIGNE :
 * - les tâches de contact du jour (retards compris, et celles traitées ce jour-là), avec la saisie du résultat ;
 * - les patients à revoir des 30 prochains jours (contrôles recommandés), avec « Programmer un rendez-vous ».
 * Aucun SMS ni WhatsApp ne part de l'application dans cette version : le canal est la préférence du patient. Le
 * motif clinique d'un contrôle n'est affiché qu'aux comptes qui lisent le dossier médical (le serveur le masque).
 *
 * Présentation : cartes dont l'échéance est mise en valeur (en retard en rouge, aujourd'hui en or, avec le
 * mot écrit), nombre de tâches à traiter et en retard à côté du titre, deux ou trois colonnes sur ordinateur.
 */
import { computed, ref } from 'vue'

import { clinicTimeZone, clinicToday, formatDayFr } from '@/app/clinicTime'
import { listContactTasks, listFollowUps } from '@/app/services/agenda'
import { canOnScreen, knownAccountId } from '@/app/session'
import {
  DUE_LOOKS,
  type DueState,
  FOLLOW_UP_STATUS_TONES,
  planDueState,
  taskDueState,
} from '@/components/agenda/tones'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import DateField from '@/components/form/DateField.vue'
import EmptyState from '@/components/layout/EmptyState.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import StatusChip from '@/components/layout/StatusChip.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import {
  CHANNEL_LABELS,
  FOLLOW_UP_REASON_LABELS,
  FOLLOW_UP_STATUS_LABELS,
  isOpenTask,
} from '@/domain/agenda/agenda'
import { canCancelFollowUp } from '@/domain/clinical/draftDeletion'
import type { ContactTask, FollowUpPlan } from '@/domain/contracts/generated'
import { patientDisplayName } from '@/domain/patients/identity'
import { CivilDate } from '@/domain/values/civilDate'
import SalesReadMessage from '@/pages/sales/SalesReadMessage.vue'
import { useServerRead } from '@/pages/today/useServerRead'

import CancelFollowUpDialog from './CancelFollowUpDialog.vue'
import ContactTaskCard from './ContactTaskCard.vue'

const timeZone = clinicTimeZone()
const day = ref<string | null>(clinicToday().toString())
const flash = ref<string | null>(null)
const stale = ref<string | null>(null)

const shown = computed(() => {
  try {
    return (day.value === null ? null : CivilDate.parse(day.value)) ?? clinicToday()
  } catch {
    return clinicToday()
  }
})

const tasks = useServerRead<ContactTask[]>(() => listContactTasks(shown.value.toString()))
const due = useServerRead<FollowUpPlan[]>(() =>
  listFollowUps(shown.value.toString(), shown.value.addDays(30).toString()),
)

function reload(): void {
  void tasks.reload()
  void due.reload()
}

function recorded(message: string): void {
  stale.value = null
  flash.value = message
  reload()
}

function staled(message: string): void {
  flash.value = null
  stale.value = message
  reload()
}

function planName(plan: FollowUpPlan): string {
  return patientDisplayName(plan.patient.last_name, plan.patient.first_names)
}

/** Annulation d'un contrôle encore actif (motif obligatoire) : une seule boîte pour toute la liste. */
const cancelling = ref<FollowUpPlan | null>(null)

function cancellable(plan: FollowUpPlan): boolean {
  return canCancelFollowUp(plan, { accountId: knownAccountId(), can: canOnScreen })
}

function afterCancel(message: string): void {
  cancelling.value = null
  recorded(message)
}

function cancelRefused(message: string): void {
  cancelling.value = null
  staled(message)
}

/** Nombre de tâches encore à traiter et, parmi elles, en retard (jour civil du cabinet). */
const taskCounts = computed(() => {
  const today = clinicToday()
  const list = tasks.data.value ?? []
  return {
    open: list.filter((task) => isOpenTask(task.status)).length,
    overdue: list.filter((task) => taskDueState(task, today, timeZone) === 'overdue').length,
  }
})

const planCount = computed(() => due.data.value?.length ?? 0)

/** Échéance d'un contrôle encore à programmer (mise en valeur seulement). */
function planDue(plan: FollowUpPlan): DueState {
  return planDueState(plan, clinicToday())
}
</script>

<template>
  <section aria-labelledby="titre-suivis" class="page-stack max-w-5xl">
    <PageHeader
      title-id="titre-suivis"
      title="Patients à rappeler"
      icon="phone"
      subtitle="Liste de travail interne : l’application n’envoie aucun message dans cette version. Appelez ou écrivez au patient vous-même, puis notez le résultat."
      :back="{ to: { name: 'agenda' }, label: 'Retour à l’agenda' }"
    />

    <form class="card toolbar p-4 sm:p-5" @submit.prevent="reload">
      <div class="min-w-0 sm:max-w-xs sm:flex-1">
        <DateField v-model="day" label="Jour" control-id="suivis-jour" />
      </div>
      <AppButton type="submit" variant="secondary">Afficher</AppButton>
    </form>

    <StateMessage v-if="flash" state="success" :title="flash" />
    <StateMessage v-if="stale" state="conflict" :title="stale" />

    <section aria-labelledby="titre-taches" class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 id="titre-taches" class="section-title">À contacter le {{ formatDayFr(shown) }}</h2>
        <div
          v-if="tasks.state.value === 'ready' && (tasks.data.value ?? []).length > 0"
          class="flex flex-wrap gap-2"
        >
          <StatusChip :tone="taskCounts.open > 0 ? 'gold' : 'success'"
            >{{ taskCounts.open }} à traiter</StatusChip
          >
          <StatusChip v-if="taskCounts.overdue > 0" tone="danger" icon="alert"
            >{{ taskCounts.overdue }} en retard</StatusChip
          >
        </div>
      </div>
      <SalesReadMessage
        v-if="tasks.state.value !== 'ready'"
        :state="tasks.state.value"
        subject="les patients à rappeler"
        :error="tasks.error.value"
        @retry="tasks.reload()"
      />
      <template v-else-if="tasks.data.value">
        <EmptyState
          v-if="tasks.data.value.length === 0"
          title="Aucun patient à rappeler ce jour-là."
          icon="phone"
        >
          Les rappels internes apparaissent ici à leur échéance.
        </EmptyState>
        <div v-else class="grid gap-4 xl:grid-cols-2">
          <ContactTaskCard
            v-for="task in tasks.data.value"
            :key="`${task.id}-${task.version}`"
            :task="task"
            @recorded="recorded"
            @stale="staled"
          />
        </div>
        <FreshnessNote
          v-if="tasks.freshness.value"
          :freshness="tasks.freshness.value"
          :time-zone="timeZone"
        />
      </template>
    </section>

    <section aria-labelledby="titre-a-revoir" class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 id="titre-a-revoir" class="section-title">À revoir dans les 30 jours</h2>
        <StatusChip v-if="due.state.value === 'ready' && planCount > 0" tone="info"
          >{{ planCount }} {{ planCount > 1 ? 'contrôles' : 'contrôle' }}</StatusChip
        >
      </div>
      <SalesReadMessage
        v-if="due.state.value !== 'ready'"
        :state="due.state.value"
        subject="les patients à revoir"
        :error="due.error.value"
        @retry="due.reload()"
      />
      <template v-else-if="due.data.value">
        <EmptyState
          v-if="due.data.value.length === 0"
          title="Aucun contrôle recommandé sur cette période."
          icon="calendar"
        />
        <div v-else class="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <article
            v-for="plan in due.data.value"
            :key="`${plan.id}-${plan.version}`"
            :class="[
              'flex flex-col gap-3 rounded-xl border border-l-4 border-line bg-surface p-4 shadow-card sm:p-5',
              DUE_LOOKS[planDue(plan)].rail,
            ]"
          >
            <div class="flex flex-wrap items-start justify-between gap-2">
              <h3 class="min-w-0 text-base font-semibold break-words">
                {{ planName(plan) }}
                <span class="font-normal text-muted"
                  >· Dossier {{ plan.patient.record_number }}</span
                >
              </h3>
              <StatusChip as="p" :tone="FOLLOW_UP_STATUS_TONES[plan.status]">{{
                FOLLOW_UP_STATUS_LABELS[plan.status]
              }}</StatusChip>
            </div>
            <dl :class="['rounded-lg border px-3 py-2', DUE_LOOKS[planDue(plan)].box]">
              <dt :class="['text-sm font-medium', DUE_LOOKS[planDue(plan)].label]">
                Contrôle recommandé le
              </dt>
              <dd class="flex flex-wrap items-center gap-2 font-semibold text-ink">
                {{ formatDayFr(CivilDate.fromString(plan.recommended_date)) }}
                <StatusChip v-if="planDue(plan) === 'overdue'" tone="danger" icon="alert"
                  >En retard</StatusChip
                >
                <StatusChip v-else-if="planDue(plan) === 'today'" tone="gold" icon="today"
                  >Aujourd’hui</StatusChip
                >
              </dd>
            </dl>
            <ul class="space-y-1 text-sm text-muted">
              <li v-if="plan.reason">{{ FOLLOW_UP_REASON_LABELS[plan.reason] }}</li>
              <li>Canal souhaité : {{ CHANNEL_LABELS[plan.preferred_channel] }}</li>
            </ul>
            <LinkButton
              v-if="plan.status === 'ACTIVE' && canOnScreen('agenda.write')"
              :to="{
                name: 'rendez-vous-nouveau',
                query: { patient: plan.patient_id, suivi: plan.id },
              }"
              variant="secondary"
              class="mt-auto self-start"
              :accessible-name="`Programmer un rendez-vous pour ${planName(plan)}`"
            >
              <AppIcon name="calendar-plus" />
              Programmer un rendez-vous
            </LinkButton>
            <AppButton
              v-if="cancellable(plan)"
              variant="ghost"
              class="self-start"
              :accessible-name="`Annuler le contrôle de ${planName(plan)}`"
              @click="cancelling = plan"
              >Annuler le contrôle</AppButton
            >
          </article>
        </div>
      </template>
    </section>

    <CancelFollowUpDialog
      v-if="cancelling"
      :plan-id="cancelling.id"
      :version="cancelling.version"
      :patient-name="planName(cancelling)"
      @cancelled="afterCancel"
      @stale="cancelRefused"
      @close="cancelling = null"
    />
  </section>
</template>
