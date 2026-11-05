<script setup lang="ts">
/**
 * Résultats d'une recherche de patients (fichier 02 : nom, numéro, âge et téléphone ; fichier 04 :
 * chargement, vide, hors ligne, erreur). Une instance lit UNE page d'UNE recherche : l'écran la
 * recrée pour chaque recherche ou page, si bien qu'une réponse tardive d'une recherche précédente
 * ne peut jamais s'afficher à la place de la courante. « Aucun résultat » n'est dit que si le
 * serveur a répondu à cette recherche (`useRead` : état « vide ») ; sans réponse, c'est « Recherche
 * serveur indisponible ». Identité administrative seulement : aucun résumé médical. Serveur injoignable,
 * les fiches de CE poste répondent et une note le dit (« Données de ce poste seulement ») : la liste n'est
 * alors pas celle de toute la clinique.
 *
 * Présentation : une carte de rangées séparées par un filet ; chaque rangée est un lien vers la fiche
 * (pastille d'initiales, nom en gras, dossier, âge, téléphone, puces « archivée » et « fusionnée »).
 */
import { computed, nextTick, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import { clinicTimeZone, clinicToday } from '@/app/clinicTime'
import { searchPatients } from '@/app/services/patients'
import { can } from '@/app/session'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import EmptyState from '@/components/layout/EmptyState.vue'
import StatusChip from '@/components/layout/StatusChip.vue'
import PatientInitials from '@/components/patients/PatientInitials.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import PaginationControls from '@/components/ui/PaginationControls.vue'
import type { PatientPage } from '@/domain/contracts/generated'
import { formatAge, patientAge, patientDisplayName } from '@/domain/patients/identity'

import ReadStateMessage from './ReadStateMessage.vue'
import { usePatientRead } from './usePatientRead'

const props = withDefaults(
  defineProps<{
    query: string
    page: number
    /** Vrai après un changement de page : le focus va au titre des résultats une fois chargés. */
    focusOnLoad?: boolean
  }>(),
  { focusOnLoad: false },
)

const emit = defineEmits<{ page: [page: number]; summary: [text: string] }>()

// Serveur injoignable : les fiches de CE poste répondent (jamais un « aucun résultat » affirmé : `live` faux).
const read = usePatientRead<PatientPage>(
  () => searchPatients(props.query, props.page, { includeLocal: true }),
  { isEmpty: (result) => result.data.length === 0 },
)

const heading = ref<HTMLElement | null>(null)
const today = clinicToday()
const timeZone = clinicTimeZone()
const canCreate = computed(() => can('patient.create'))

const result = computed(() => read.data.value)
const total = computed(() => result.value?.meta.total ?? 0)
/** Vide « certain » mais le serveur annonce des résultats : la page demandée n'existe plus. */
const pastTheEnd = computed(() => read.state.value === 'empty' && total.value > 0)

function announcement(): string {
  switch (read.state.value) {
    case 'ready': {
      const meta = result.value?.meta
      const count = meta?.total === 1 ? '1 patient trouvé' : `${meta?.total ?? 0} patients trouvés`
      return meta !== undefined && meta.last_page > 1
        ? `${count}, page ${meta.current_page} sur ${meta.last_page}`
        : count
    }
    case 'empty':
      return pastTheEnd.value ? 'Cette page ne contient plus de résultats' : 'Aucun résultat'
    case 'offline':
      return 'Recherche serveur indisponible'
    case 'forbidden':
      return 'Droits insuffisants'
    case 'session-expired':
      return 'Session expirée'
    case 'error':
      return 'La recherche a échoué'
    default:
      return ''
  }
}

watch(
  read.state,
  async (state) => {
    if (state === 'loading') return
    emit('summary', announcement())
    if (props.focusOnLoad) {
      await nextTick()
      heading.value?.focus()
    }
  },
  { immediate: true },
)

/** Nombre de fiches trouvées, écrit au-dessus de la liste (le même texte est annoncé). */
const found = computed(() =>
  total.value === 1 ? '1 patient trouvé' : `${total.value} patients trouvés`,
)

function age(patient: PatientPage['data'][number]): string {
  return formatAge(patientAge(patient.birth_date, today))
}
</script>

<template>
  <section aria-labelledby="titre-resultats" class="space-y-4">
    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 id="titre-resultats" ref="heading" tabindex="-1" class="section-title focus:outline-none">
        Résultats
      </h2>
      <p v-if="read.state.value === 'ready' && result !== null" class="text-sm text-muted">
        {{ found }}
      </p>
    </div>

    <ReadStateMessage
      v-if="read.state.value !== 'ready' && read.state.value !== 'empty'"
      :state="read.state.value"
      subject="search"
      :error="read.error.value"
      @retry="read.reload()"
    />

    <StateMessage
      v-else-if="pastTheEnd"
      state="empty"
      title="Cette page ne contient plus de résultats"
    >
      Les résultats ont changé depuis l’affichage précédent.
      <template #action>
        <AppButton variant="secondary" @click="emit('page', 1)"
          >Revenir à la première page</AppButton
        >
      </template>
    </StateMessage>

    <EmptyState v-else-if="read.state.value === 'empty'" title="Aucun résultat" icon="search">
      Le serveur n’a trouvé aucun patient pour cette recherche. Vérifiez l’orthographe, ou cherchez
      par téléphone ou par numéro de dossier avant de créer une nouvelle fiche.
      <template v-if="canCreate" #action>
        <LinkButton to="/patients/nouveau" variant="primary">Créer un patient</LinkButton>
      </template>
    </EmptyState>

    <template v-else-if="result !== null">
      <ul class="card divide-y divide-line">
        <li
          v-for="patient in result.data"
          :key="patient.id"
          class="first:rounded-t-xl last:rounded-b-xl hover:bg-canvas"
        >
          <RouterLink
            :to="{ name: 'patient', params: { id: patient.id } }"
            class="group flex min-h-11 items-center gap-3 rounded-xl p-3 sm:gap-4 sm:px-5 sm:py-4"
          >
            <PatientInitials
              :last-name="patient.last_name"
              :first-names="patient.first_names"
              size="sm"
            />
            <span class="min-w-0 flex-1 space-y-1">
              <span class="block font-semibold break-words text-ink group-hover:underline">{{
                patientDisplayName(patient.last_name, patient.first_names)
              }}</span>
              <span class="block text-sm break-words text-muted"
                >Dossier <span class="font-medium text-ink">{{ patient.record_number }}</span> ·
                {{ age(patient) }} · {{ patient.phone_primary ?? 'téléphone non renseigné' }}</span
              >
              <span
                v-if="patient.archived || patient.merged_into_patient_id !== null"
                class="flex flex-wrap gap-2 pt-0.5"
              >
                <StatusChip v-if="patient.archived" tone="warning" icon="alert"
                  >Fiche archivée</StatusChip
                >
                <StatusChip
                  v-if="patient.merged_into_patient_id !== null"
                  tone="warning"
                  icon="alert"
                  >Fiche fusionnée</StatusChip
                >
              </span>
            </span>
            <AppIcon name="chevron-right" :size="20" class="text-muted group-hover:text-gold-ink" />
          </RouterLink>
        </li>
      </ul>

      <FreshnessNote
        v-if="read.freshness.value && read.freshness.value.serverAsOf === null"
        :freshness="read.freshness.value"
        :time-zone="timeZone"
      />

      <div class="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <PaginationControls
          :current-page="result.meta.current_page"
          :last-page="result.meta.last_page"
          :total="result.meta.total"
          @page="emit('page', $event)"
        />

        <p v-if="canCreate" class="text-sm text-muted">
          Le patient n’est pas dans la liste ?
          <RouterLink
            to="/patients/nouveau"
            class="text-link inline-flex min-h-11 items-center font-semibold"
            >Créer un nouveau patient</RouterLink
          >
        </p>
      </div>
    </template>
  </section>
</template>
