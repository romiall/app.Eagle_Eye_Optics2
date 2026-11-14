<script setup lang="ts">
/**
 * Activité d'un patient (onglet « Activité » ; fichier 02 : historique jamais écrasé ; fichier 04 : états
 * chargement, vide, hors ligne, erreur ; fichier 09 : sections séparées par droits). Lecture EN LIGNE
 * (`listPatientActivity`), du plus récent au plus ancien, 25 éléments par page, filtre simple par section.
 *
 * Le serveur n'envoie que les sections que le compte peut voir (`meta.sections`) : les filtres viennent de
 * cette liste, une section absente n'apparaît nulle part (ni filtre, ni compte, ni message). « Aucune visite
 * enregistrée » n'est dit que si le serveur a répondu à CET appel (`useRead` : état « vide ») ; sans
 * réponse, c'est « Activité indisponible », jamais un dossier vide.
 *
 * Liste en cartes empilées (aucun tableau, aucun défilement horizontal à 360 px). Un élément n'est un lien
 * que si le serveur donne l'adresse de son écran ET que cet écran existe dans cette version et s'ouvre pour
 * ce compte (droit et module) ; sinon son titre est du texte simple.
 *
 * Présentation : frise chronologique, une pastille d'icône par nature d'élément (teinte de sa section)
 * reliée par un filet, puis la carte (date, titre, détails). Le montant d'une pièce financière est repris
 * en grand à droite pour la lecture rapide ; ce rappel est masqué aux lecteurs d'écran, qui le lisent déjà
 * dans les détails.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import { clinicTimeZone, formatInstantFr } from '@/app/clinicTime'
import { type ActivitySectionCode, listPatientActivity } from '@/app/services/patients'
import { canAny, enabledModules } from '@/app/session'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import StateMessage, { type ScreenState } from '@/components/feedback/StateMessage.vue'
import EmptyState from '@/components/layout/EmptyState.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import PaginationControls from '@/components/ui/PaginationControls.vue'
import type {
  PatientActivity,
  PatientActivityItem,
  PatientActivitySection,
} from '@/domain/contracts/generated'
import {
  type ActivitySection,
  ALL_EMPTY,
  itemDetails,
  itemKey,
  itemTitle,
  SECTION_EMPTY,
  SECTION_LABELS,
  sectionOf,
} from '@/domain/patients/activity'
import { formatMoney } from '@/domain/values/money'

import { usePatientRead } from './usePatientRead'

const props = defineProps<{ patientId: string }>()

const router = useRouter()
const timeZone = clinicTimeZone()

/** Filtre affiché (null : toutes les sections visibles) et page demandée. */
const section = ref<ActivitySectionCode | null>(null)
const page = ref(1)
const heading = ref<HTMLElement | null>(null)
const focusOnLoad = ref(false)
const announcement = ref('')

const read = usePatientRead<PatientActivity>(
  () => listPatientActivity(props.patientId, section.value, page.value),
  { isEmpty: (answer) => answer.data.length === 0 },
)

/**
 * Réponse de CETTE demande (même filtre, même page) : pendant le chargement d'un autre filtre, la liste
 * précédente n'est jamais présentée comme celle du filtre choisi.
 */
const result = computed<PatientActivity | null>(() => {
  const data = read.data.value
  if (data === null) return null
  return data.meta.section === section.value && data.meta.current_page === page.value ? data : null
})

/**
 * Sections visibles du compte, d'après la dernière réponse du serveur (filtres). `useRead` garde la
 * dernière réponse pendant une relecture : les filtres ne disparaissent pas pendant un chargement.
 */
const sections = computed<readonly PatientActivitySection[]>(
  () => read.data.value?.meta.sections ?? [],
)

const allTotal = computed(() => sections.value.reduce((sum, entry) => sum + entry.total, 0))
const canCompareExams = computed(
  () =>
    canAny(['clinical.read']) &&
    enabledModules.value.includes('consultations') &&
    (sections.value.find((entry) => entry.section === 'EXAMS')?.total ?? 0) >= 2,
)
const pastTheEnd = computed(
  () => read.state.value === 'empty' && result.value !== null && result.value.meta.total > 0,
)
/**
 * Vide confirmé : celui de la section filtrée ; sans filtre, celui de la seule section visible s'il n'y
 * en a qu'une (l'accueil : « Aucune visite enregistrée »), sinon « Aucune activité enregistrée ».
 */
const emptyTitle = computed(() => {
  if (section.value !== null) return SECTION_EMPTY[section.value]
  const only = sections.value.length === 1 ? sections.value[0] : undefined
  return only === undefined ? ALL_EMPTY : SECTION_EMPTY[only.section]
})

function choose(next: ActivitySectionCode | null): void {
  if (next === section.value && page.value === 1) return
  section.value = next
  page.value = 1
  focusOnLoad.value = false
  announcement.value = 'Chargement de l’activité…'
  void read.reload()
}

function goToPage(next: number): void {
  page.value = next
  focusOnLoad.value = true
  announcement.value = 'Chargement de la page…'
  void read.reload()
}

/**
 * Adresse ouvrable d'un élément : donnée par le serveur, connue de cette version (pas « page
 * introuvable ») et autorisée pour ce compte (droit et module de la page). Sinon null : texte simple.
 */
function openable(item: PatientActivityItem): string | null {
  const path = item.screen_path
  if (path === null || !path.startsWith('/') || path.startsWith('//')) return null
  const resolved = router.resolve(path)
  if (resolved.matched.length === 0 || resolved.name === 'introuvable') return null
  const moduleCode = resolved.meta.module
  if (moduleCode !== undefined && !enabledModules.value.includes(moduleCode)) return null
  const required = resolved.meta.permissions
  if (required !== undefined && !canAny(required)) return null
  return resolved.fullPath
}

function chipLabel(entry: { label: string; total: number }): string {
  return `${entry.label} (${entry.total})`
}

const chips = computed(() => [
  { code: null, label: 'Tout', total: allTotal.value },
  ...sections.value.map((entry) => ({
    code: entry.section,
    label: SECTION_LABELS[entry.section],
    total: entry.total,
  })),
])

function summary(): string {
  switch (read.state.value) {
    case 'ready': {
      const total = result.value?.meta.total ?? 0
      return total === 1 ? '1 élément' : `${total} éléments`
    }
    case 'empty':
      return pastTheEnd.value ? 'Cette page ne contient plus d’éléments' : emptyTitle.value
    case 'offline':
      return 'Activité indisponible'
    case 'forbidden':
      return 'Droits insuffisants'
    case 'session-expired':
      return 'Session expirée'
    case 'error':
      return 'L’activité n’a pas pu être lue'
    default:
      return ''
  }
}

watch(read.state, async (state) => {
  if (state === 'loading') return
  announcement.value = summary()
  if (focusOnLoad.value) {
    await nextTick()
    heading.value?.focus()
  }
})

interface View {
  state: ScreenState
  title: string
  text: string
  retry: boolean
}

/** États autres que « prêt » et « vide » : le message dit ce qui est su, pas davantage. */
const failure = computed<View | null>(() => {
  switch (read.state.value) {
    case 'loading':
      return { state: 'loading', title: 'Chargement de l’activité…', text: '', retry: false }
    case 'offline':
      return {
        state: 'offline',
        title: 'Activité indisponible',
        text: 'Le serveur n’a pas répondu : l’activité n’a pas pu être lue. Cela ne prouve pas que le dossier soit vide, et aucune ancienne copie n’est présentée comme à jour.',
        retry: true,
      }
    case 'forbidden':
      return {
        state: 'forbidden',
        title: 'Droits insuffisants',
        text: 'Ce compte n’a pas le droit de consulter cette activité.',
        retry: false,
      }
    case 'session-expired':
      return {
        state: 'offline',
        title: 'Session expirée',
        text: 'Reconnectez-vous avec le bouton « Se reconnecter » de l’en-tête, puis réessayez.',
        retry: true,
      }
    case 'error':
      if (read.error.value?.status === 404) {
        return {
          state: 'error',
          title: 'Fiche introuvable',
          text: 'Ce dossier n’existe pas ou n’est plus accessible.',
          retry: false,
        }
      }
      return {
        state: 'error',
        title: 'L’activité n’a pas pu être lue',
        text: read.error.value?.message ?? 'Une erreur inattendue est survenue.',
        retry: true,
      }
    default:
      return null
  }
})

/** Icône de la pastille selon la nature de l'élément (décorative : le titre la dit en clair). */
const ICONS: Readonly<Record<PatientActivityItem['type'], string>> = {
  VISIT: 'arrival',
  CONSULTATION: 'eye',
  PRESCRIPTION: 'glasses',
  MEDICATION_ORDER: 'clipboard',
  INVOICE: 'file',
  RECEIPT: 'receipt',
  CREDIT_NOTE: 'percent',
  REFUND: 'wallet',
}

/** Teinte de la pastille selon la section (associations vérifiées : icône sur son fond léger). */
const TONES: Readonly<Record<ActivitySection, string>> = {
  VISITS: 'border-line bg-surface text-muted',
  EXAMS: 'border-line bg-primary-soft text-primary',
  PRESCRIPTIONS: 'border-gold bg-gold-soft text-gold-ink',
  FINANCIAL: 'border-accent bg-accent-soft text-accent',
}

/** Montant d'une pièce financière, déjà écrit dans ses détails : rappel visuel aligné à droite. */
function amountOf(item: PatientActivityItem): string | null {
  switch (item.type) {
    case 'INVOICE':
      return formatMoney(item.total_gross)
    case 'RECEIPT':
    case 'REFUND':
      return formatMoney(item.amount)
    case 'CREDIT_NOTE':
      return formatMoney(item.amount_gross)
    default:
      return null
  }
}

const LINK_CLASS = 'text-link inline-flex min-h-11 items-center font-semibold break-words'
</script>

<template>
  <section aria-labelledby="titre-activite" class="space-y-5">
    <div class="space-y-1">
      <h2 id="titre-activite" ref="heading" tabindex="-1" class="section-title focus:outline-none">
        Activité
      </h2>
      <p class="max-w-prose text-muted">
        Du plus récent au plus ancien. Une nouvelle entrée ne remplace jamais une précédente.
      </p>
    </div>

    <div
      v-if="sections.length > 1"
      role="group"
      aria-label="Filtrer l’activité"
      class="flex flex-wrap gap-2"
    >
      <AppButton
        v-for="chip in chips"
        :key="chip.code ?? 'tout'"
        variant="secondary"
        :pressed="chip.code === section"
        @click="choose(chip.code)"
      >
        {{ chipLabel(chip) }}
      </AppButton>
    </div>

    <p role="status" aria-live="polite" class="sr-only">{{ announcement }}</p>

    <StateMessage v-if="failure" :state="failure.state" :title="failure.title">
      {{ failure.text }}
      <template v-if="failure.retry" #action>
        <AppButton variant="secondary" @click="read.reload()">Réessayer</AppButton>
      </template>
    </StateMessage>

    <StateMessage
      v-else-if="pastTheEnd"
      state="empty"
      title="Cette page ne contient plus d’éléments"
    >
      L’activité a changé depuis l’affichage précédent.
      <template #action>
        <AppButton variant="secondary" @click="goToPage(1)">Revenir à la première page</AppButton>
      </template>
    </StateMessage>

    <EmptyState v-else-if="read.state.value === 'empty'" :title="emptyTitle" icon="history" />

    <StateMessage
      v-else-if="read.state.value === 'ready' && result === null"
      state="error"
      title="Réponse inattendue"
    >
      Le serveur a répondu pour un autre filtre ou une autre page : rien n’est affiché.
    </StateMessage>

    <template v-else-if="result !== null">
      <div v-if="canCompareExams" class="flex flex-wrap gap-3">
        <LinkButton
          :to="{ name: 'patient-comparaison', params: { id: props.patientId } }"
          variant="secondary"
          >Comparer deux examens</LinkButton
        >
      </div>

      <ol
        id="activite-liste"
        class="relative space-y-4 before:absolute before:top-5 before:bottom-5 before:left-5 before:w-px before:bg-line"
        aria-label="Activité, du plus récent au plus ancien"
      >
        <li
          v-for="item in result.data"
          :key="itemKey(item)"
          class="relative flex gap-3 break-words sm:gap-4"
        >
          <span
            aria-hidden="true"
            :class="[
              'relative flex size-10 shrink-0 items-center justify-center rounded-full border',
              TONES[sectionOf(item)],
            ]"
          >
            <AppIcon :name="ICONS[item.type]" :size="18" />
          </span>
          <div class="min-w-0 flex-1 rounded-xl border border-line bg-surface p-4 shadow-card">
            <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <div class="min-w-0 space-y-0.5">
                <p class="text-sm text-muted">
                  <time :datetime="item.occurred_at">{{ formatInstantFr(item.occurred_at) }}</time>
                </p>
                <p>
                  <RouterLink v-if="openable(item)" :to="openable(item) ?? '/'" :class="LINK_CLASS"
                    >{{ itemTitle(item)
                    }}<span class="sr-only">
                      du {{ formatInstantFr(item.occurred_at) }}</span
                    ></RouterLink
                  >
                  <span v-else class="font-semibold text-ink">{{ itemTitle(item) }}</span>
                </p>
              </div>
              <span
                v-if="amountOf(item) !== null"
                aria-hidden="true"
                class="text-lg font-semibold whitespace-nowrap text-ink tabular-nums"
                >{{ amountOf(item) }}</span
              >
            </div>
            <p v-for="line in itemDetails(item)" :key="line" class="mt-1 text-base text-ink">
              {{ line }}
            </p>
          </div>
        </li>
      </ol>

      <PaginationControls
        :current-page="result.meta.current_page"
        :last-page="result.meta.last_page"
        :total="result.meta.total"
        :busy="read.state.value === 'loading'"
        label="Pagination de l’activité"
        unit="éléments"
        @page="goToPage"
      />
    </template>

    <FreshnessNote
      v-if="read.freshness.value && (read.state.value === 'ready' || read.state.value === 'empty')"
      :freshness="read.freshness.value"
      :time-zone="timeZone"
    />
  </section>
</template>
