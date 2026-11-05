<script setup lang="ts">
/**
 * Examens du cabinet (écran « Consultations », module « consultations », `clinical.read`) : les
 * consultations du jour par défaut, ou de tous les jours, filtrables par état et par « mes examens », de la
 * plus récente à la plus ancienne, 50 par page. La liste ne montre AUCUNE valeur clinique (patient, date,
 * état, professionnel) : le dossier s'ouvre sur la consultation, dont la lecture est tracée. Une liste qui
 * n'a pas pu être lue est « indisponible », jamais « aucun examen ». Cartes plutôt qu'un tableau (360 px) :
 * toute la carte ouvre la consultation (lien étendu), l'état est une puce écrite en toutes lettres, deux
 * colonnes sur grand écran.
 *
 * « Nouvelle consultation » (`clinical.write`) ouvre la boîte de démarrage d'un examen : patients de la file
 * du jour, ou recherche d'un autre patient (`StartConsultationDialog`).
 *
 * Chaque carte offre « Modifier » (ouvre l'examen pour le poursuivre ; un examen terminé s'ouvre en correction,
 * nouvelle révision motivée, avec `clinical.amend`) et, pour un examen resté BROUILLON seulement, « Supprimer »
 * (le professionnel qui l'a démarré ou la gérante) : confirmation, puis commande `DeleteConsultationDraft` (le serveur
 * applique la règle et refuse tout autre cas). Les boutons suivent `domain/clinical/draftDeletion.ts`.
 *
 * Préréglages par l'adresse (raccourcis de l'accueil) : `?jour=tous`, `?etat=IN_PROGRESS`, `?mes=1` — des
 * filtres, jamais une donnée de santé — et `?nouvelle=1`, qui ouvre la boîte « Nouvelle consultation ».
 */
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { clinicTimeZone, clinicToday, formatInstantFr } from '@/app/clinicTime'
import { listConsultations } from '@/app/services/consultationList'
import { canOnScreen, knownAccountId } from '@/app/session'
import WorkStatusChip from '@/components/clinical/WorkStatusChip.vue'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import ReadNotice from '@/components/feedback/ReadNotice.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import CheckboxField from '@/components/form/CheckboxField.vue'
import DateField from '@/components/form/DateField.vue'
import SelectField from '@/components/form/SelectField.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import PaginationControls from '@/components/ui/PaginationControls.vue'
import { canDeleteDraftExam, modifyKind, modifyNote } from '@/domain/clinical/draftDeletion'
import { WORK_STATUS_LABELS } from '@/domain/clinical/labels'
import type {
  ConsultationSummary,
  ConsultationSummaryPage,
  ConsultationsStatus,
} from '@/domain/contracts/generated'
import { patientDisplayName } from '@/domain/patients/identity'
import { useServerRead } from '@/pages/today/useServerRead'

import DeleteConsultationDialog from './DeleteConsultationDialog.vue'
import { takeFlash } from './flash'
import StartConsultationDialog from './StartConsultationDialog.vue'

const STATUSES: readonly ConsultationsStatus[] = ['DRAFT', 'IN_PROGRESS', 'COMPLETED']

const route = useRoute()
const router = useRouter()
const timeZone = clinicTimeZone()
const today = clinicToday().toString()

function queryText(name: string): string | null {
  const value = route.query[name]
  return typeof value === 'string' ? value : null
}

/** Démarrer un examen demande le droit d'écriture clinique ; la boîte est montée seulement quand elle est ouverte. */
const canStart = computed(() => canOnScreen('clinical.write'))
const startOpen = ref(canOnScreen('clinical.write') && queryText('nouvelle') === '1')

function closeStart(): void {
  startOpen.value = false
  // L'adresse ne doit plus rouvrir la boîte (actualisation, retour en arrière) : le reste de l'adresse est gardé.
  if (route.query['nouvelle'] === undefined) return
  const rest = { ...route.query }
  delete rest['nouvelle']
  void router.replace({ name: route.name ?? 'consultations', query: rest })
}

const presetStatus = queryText('etat')
const day = ref<string | null>(queryText('jour') === 'tous' ? null : today)
const status = ref<string | null>(
  presetStatus !== null && (STATUSES as readonly string[]).includes(presetStatus)
    ? presetStatus
    : null,
)
const mine = ref(queryText('mes') === '1')
const page = ref(1)

const statusOptions = STATUSES.map((value) => ({ value, label: WORK_STATUS_LABELS[value] }))

const statusFilter = computed<ConsultationsStatus | null>(() =>
  status.value !== null && (STATUSES as readonly string[]).includes(status.value)
    ? (status.value as ConsultationsStatus)
    : null,
)

const read = useServerRead<ConsultationSummaryPage>(
  () =>
    listConsultations({
      day: day.value,
      status: statusFilter.value,
      mine: mine.value,
      page: page.value,
    }),
  { isEmpty: (result) => result.data.length === 0 },
)

watch([day, statusFilter, mine], () => {
  page.value = 1
  void read.reload()
})

function goToPage(next: number): void {
  page.value = next
  void read.reload()
}

const result = computed(() => read.data.value)

function name(consultation: ConsultationSummary): string {
  return patientDisplayName(consultation.patient.last_name, consultation.patient.first_names)
}

/**
 * « Modifier » et « Supprimer » : affichés selon l'état de l'examen et les droits du compte tels que l'écran les
 * connaît (`domain/clinical/draftDeletion`) ; le serveur revérifie chaque commande et refuse tout autre cas.
 */
function exam(consultation: ConsultationSummary): { status: string; clinicianId: string } {
  return { status: consultation.status, clinicianId: consultation.clinician.id }
}

function modification(consultation: ConsultationSummary): ReturnType<typeof modifyKind> {
  return modifyKind(exam(consultation), { accountId: knownAccountId(), can: canOnScreen })
}

function deletable(consultation: ConsultationSummary): boolean {
  return canDeleteDraftExam(exam(consultation), { accountId: knownAccountId(), can: canOnScreen })
}

/** Nom accessible de « Modifier » : il commence par le libellé visible et dit qu'une correction crée une révision. */
function modifyName(consultation: ConsultationSummary): string {
  const kind = modification(consultation)
  return `Modifier l’examen de ${name(consultation)}${kind === null ? '' : modifyNote(kind)}`
}

/** Un examen terminé se corrige (nouvelle révision) : l'éditeur ouvre directement la correction. */
function modifyTarget(consultation: ConsultationSummary) {
  const base = { name: 'consultation', params: { id: consultation.id } }
  return modification(consultation) === 'correct' ? { ...base, query: { corriger: '1' } } : base
}

function hasFooter(consultation: ConsultationSummary): boolean {
  return consultation.completed_at !== null || consultation.status === 'COMPLETED'
}

/** Examen dont la suppression est demandée (une seule boîte pour toute la liste) et message du dernier résultat. */
const deleting = ref<ConsultationSummary | null>(null)
const flash = takeFlash()
const notice = ref<{ state: 'success' | 'conflict'; message: string } | null>(
  flash === null ? null : { state: 'success', message: flash },
)

function afterDeleteAttempt(state: 'success' | 'conflict', message: string): void {
  deleting.value = null
  notice.value = { state, message }
  void read.reload()
}

const emptyTitle = computed(() =>
  day.value === null
    ? 'Aucun examen pour ces critères'
    : 'Aucun examen ce jour-là pour ces critères',
)
</script>

<template>
  <section aria-labelledby="titre-examens" class="page-stack max-w-5xl">
    <PageHeader
      title-id="titre-examens"
      title="Consultations"
      icon="consultations"
      subtitle="Examens du cabinet, du plus récent au plus ancien. Ouvrez un examen pour le lire ou le poursuivre."
    >
      <template v-if="canStart" #actions>
        <AppButton variant="primary" @click="startOpen = true"
          ><AppIcon name="stethoscope" :size="18" />Nouvelle consultation</AppButton
        >
      </template>
    </PageHeader>

    <StartConsultationDialog v-if="startOpen" @close="closeStart" />

    <DeleteConsultationDialog
      v-if="deleting !== null"
      :consultation-id="deleting.id"
      :version="deleting.version"
      :patient-name="name(deleting)"
      @deleted="afterDeleteAttempt('success', $event)"
      @stale="afterDeleteAttempt('conflict', $event)"
      @close="deleting = null"
    />

    <StateMessage
      v-if="notice !== null"
      :state="notice.state"
      :title="notice.state === 'success' ? 'Examen supprimé' : 'Examen non supprimé'"
    >
      {{ notice.message }}
    </StateMessage>

    <form
      role="search"
      aria-label="Filtrer les examens"
      class="card grid gap-4 p-4 sm:grid-cols-2 sm:gap-x-6 sm:p-5"
      @submit.prevent
    >
      <div class="space-y-2">
        <DateField
          v-model="day"
          label="Jour"
          hint="Vide : tous les jours."
          control-id="examens-jour"
        />
        <div class="flex flex-wrap gap-2">
          <AppButton variant="ghost" @click="day = today">Aujourd’hui</AppButton>
          <AppButton variant="ghost" @click="day = null">Tous les jours</AppButton>
        </div>
      </div>
      <SelectField
        v-model="status"
        label="État"
        placeholder="Tous les états"
        :options="statusOptions"
        control-id="examens-etat"
      />
      <CheckboxField
        v-model="mine"
        label="Seulement mes examens"
        control-id="examens-miens"
        class="border-t border-line pt-3 sm:col-span-2"
      />
    </form>

    <ReadNotice
      v-if="read.state.value !== 'ready' && read.state.value !== 'empty'"
      :state="read.state.value"
      subject="la liste des examens"
      :error="read.error.value"
      @retry="read.reload()"
    />

    <StateMessage v-else-if="read.state.value === 'empty'" state="empty" :title="emptyTitle">
      Le serveur n’a aucun examen pour ces critères. Un examen se démarre avec « Nouvelle
      consultation » ou depuis la file du jour.
    </StateMessage>

    <template v-else-if="result !== null">
      <ul class="grid gap-3 sm:gap-4 xl:grid-cols-2">
        <li
          v-for="consultation in result.data"
          :key="consultation.id"
          class="card relative flex min-w-0 flex-col gap-3 p-4 hover:border-gold hover:shadow-raised sm:p-5"
        >
          <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <p class="min-w-0">
              <!-- Lien étendu (::after) : toute la carte ouvre la consultation. -->
              <RouterLink
                :to="{ name: 'consultation', params: { id: consultation.id } }"
                class="text-link inline-flex min-h-11 items-center text-lg font-semibold break-words after:absolute after:inset-0 after:rounded-xl"
                :aria-label="`${name(consultation)}, examen du ${formatInstantFr(consultation.effective_at)}`"
                >{{ name(consultation) }}</RouterLink
              >
            </p>
            <WorkStatusChip :status="consultation.status" class="sm:mt-2.5" />
          </div>
          <ul class="flex flex-col gap-1.5 text-sm text-muted sm:flex-row sm:flex-wrap sm:gap-x-5">
            <li class="inline-flex items-center gap-1.5">
              <AppIcon name="id-card" :size="16" class="text-gold" />
              <span
                >Dossier
                <span class="font-medium text-ink">{{
                  consultation.patient.record_number
                }}</span></span
              >
            </li>
            <li class="inline-flex items-center gap-1.5">
              <AppIcon name="calendar" :size="16" class="text-gold" />
              <span
                >Examen du
                <span class="font-medium text-ink tabular-nums">{{
                  formatInstantFr(consultation.effective_at)
                }}</span></span
              >
            </li>
            <li class="inline-flex min-w-0 items-center gap-1.5">
              <AppIcon name="stethoscope" :size="16" class="text-gold" />
              <span class="min-w-0 break-words"
                >Professionnel :
                <span class="font-medium text-ink">{{
                  consultation.clinician.display_name
                }}</span></span
              >
            </li>
          </ul>
          <div
            v-if="consultation.completed_at !== null || consultation.status === 'COMPLETED'"
            class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line pt-2 text-sm"
          >
            <p
              v-if="consultation.completed_at !== null"
              class="inline-flex items-center gap-1.5 text-muted"
            >
              <AppIcon name="check-circle" :size="16" class="text-accent" />
              <span
                >Terminé le {{ formatInstantFr(consultation.completed_at) }} (révision
                {{ consultation.current_revision }})</span
              >
            </p>
            <RouterLink
              v-if="consultation.status === 'COMPLETED'"
              :to="{ name: 'consultation-historique', params: { id: consultation.id } }"
              class="text-link relative z-10 inline-flex min-h-11 items-center gap-1.5 font-semibold"
              :aria-label="`Révisions de l’examen de ${name(consultation)}`"
              ><AppIcon name="history" :size="16" />Révisions</RouterLink
            >
          </div>
          <!-- Boutons au-dessus du lien étendu de la carte (z-10) : « Modifier » ouvre l'examen (un examen terminé s'ouvre
               en correction : nouvelle révision), « Supprimer » ne paraît que pour un brouillon. -->
          <div
            v-if="modification(consultation) !== null || deletable(consultation)"
            :class="[
              'relative z-10 flex flex-wrap items-center justify-end gap-2',
              hasFooter(consultation) ? 'pt-1' : 'border-t border-line pt-2',
            ]"
          >
            <LinkButton
              v-if="modification(consultation) !== null"
              :to="modifyTarget(consultation)"
              variant="secondary"
              :accessible-name="modifyName(consultation)"
              ><AppIcon name="edit" :size="18" />Modifier</LinkButton
            >
            <AppButton
              v-if="deletable(consultation)"
              variant="danger"
              :accessible-name="`Supprimer l’examen de ${name(consultation)}`"
              @click="deleting = consultation"
              ><AppIcon name="trash" :size="18" />Supprimer</AppButton
            >
          </div>
        </li>
      </ul>

      <PaginationControls
        :current-page="result.meta.current_page"
        :last-page="result.meta.last_page"
        :total="result.meta.total"
        label="Pagination des examens"
        unit="examens"
        @page="goToPage"
      />

      <FreshnessNote
        v-if="read.freshness.value"
        :freshness="read.freshness.value"
        :time-zone="timeZone"
      />
    </template>
  </section>
</template>
