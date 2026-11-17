<script setup lang="ts">
/**
 * Recherche et liste des patients (P02 ; fichier 02 : à partir de 2 caractères, insensible à la casse et aux
 * accents, téléphone ou numéro de dossier ; fichier 04 : écran « Patients »). À l'ouverture de l'écran, la
 * liste complète des patients du cabinet est affichée directement, avec un nombre de lignes réglable.
 * Une recherche par formulaire (Entrée ou bouton) permet de filtrer les résultats ; laisser le champ vide
 * ou cliquer sur « Effacer » réaffiche l'ensemble des patients.
 */
import { computed, ref, watch } from 'vue'

import { can } from '@/app/session'
import TextField from '@/components/form/TextField.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import { searchTerm } from '@/domain/patients/duplicates'

import PatientSearchResults from './PatientSearchResults.vue'
import { searchMemory } from './searchMemory'

const SEARCH_ID = 'patient-recherche'

const memory = searchMemory()
const text = ref(memory.text)
const error = ref<string | null>(null)
/** Annonce persistante (lecteurs d'écran) : nombre de résultats, indisponibilité… */
const announcement = ref('')
const focusResults = ref(false)

watch(text, (value) => {
  memory.text = value
  error.value = null
})

const canCreate = computed(() => can('patient.create'))
const resultsKey = computed(
  () => `${memory.run}\u{1F}${memory.query}\u{1F}${memory.page}\u{1F}${memory.perPage}`,
)

function search(): void {
  if (text.value === '' && memory.query !== '') {
    resetSearch()
    return
  }

  const term = searchTerm(text.value)
  if (!term.ok) {
    error.value =
      term.length === 0
        ? 'Saisissez au moins 2 caractères : un nom, un téléphone ou un numéro de dossier.'
        : 'Saisissez au moins 2 caractères pour lancer la recherche.'
    document.getElementById(SEARCH_ID)?.focus()
    return
  }
  error.value = null
  announcement.value = 'Recherche en cours…'
  focusResults.value = false
  memory.query = term.text
  memory.page = 1
  memory.run += 1
}

function resetSearch(): void {
  text.value = ''
  memory.text = ''
  memory.query = ''
  memory.page = 1
  memory.run += 1
  error.value = null
  announcement.value = 'Affichage de tous les patients…'
  focusResults.value = false
}

function goToPage(page: number): void {
  announcement.value = 'Chargement de la page…'
  focusResults.value = true
  memory.page = page
}

function onPerPageChange(perPage: number): void {
  memory.perPage = perPage
  memory.page = 1
  memory.run += 1
}
</script>

<template>
  <section aria-labelledby="titre-patients" class="page-stack max-w-4xl">
    <PageHeader
      title-id="titre-patients"
      title="Patients"
      icon="patients"
      subtitle="Retrouvez une fiche par le nom, le téléphone ou le numéro de dossier."
    >
      <template v-if="canCreate" #actions>
        <LinkButton to="/patients/nouveau" variant="primary"
          ><AppIcon name="user-plus" :size="18" />Nouveau patient</LinkButton
        >
      </template>
    </PageHeader>

    <form
      role="search"
      aria-label="Rechercher un patient"
      class="card flex flex-col gap-3 border-t-4 border-t-gold p-4 sm:flex-row sm:items-start sm:p-6"
      novalidate
      @submit.prevent="search"
    >
      <div class="min-w-0 flex-1">
        <TextField
          v-model="text"
          label="Rechercher un patient"
          type="search"
          inputmode="search"
          :control-id="SEARCH_ID"
          hint="Nom, prénom, téléphone ou numéro de dossier (par exemple EE-2026-0001). Laissez vide pour afficher tous les patients."
          :error="error"
        />
      </div>
      <AppButton type="submit" class="field-action"
        ><AppIcon name="search" :size="18" />Rechercher</AppButton
      >
      <AppButton
        v-if="text !== '' || memory.query !== ''"
        type="button"
        variant="ghost"
        class="field-action"
        @click="resetSearch"
      >
        Effacer
      </AppButton>
    </form>

    <p role="status" aria-live="polite" class="sr-only">{{ announcement }}</p>

    <PatientSearchResults
      :key="resultsKey"
      :query="memory.query"
      :page="memory.page"
      :per-page="memory.perPage"
      :focus-on-load="focusResults"
      @page="goToPage"
      @per-page="onPerPageChange"
      @reset-search="resetSearch"
      @summary="announcement = $event"
    />
  </section>
</template>
