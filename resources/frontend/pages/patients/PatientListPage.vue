<script setup lang="ts">
/**
 * Recherche de patients (P02 ; fichier 02 : à partir de 2 caractères, insensible à la casse et aux
 * accents, téléphone ou numéro de dossier ; fichier 04 : écran « Patients »). La recherche part à la
 * validation du formulaire (Entrée ou bouton), jamais sous 2 caractères. Le texte cherché reste en
 * mémoire de la session pour revenir de la fiche à la liste, sans passer par l'URL (aucun nom ni
 * téléphone dans l'adresse). « Créer » n'est proposé qu'à côté des résultats : on vérifie d'abord
 * que le patient n'existe pas.
 *
 * Présentation : en-tête d'écran, barre de recherche en carte, puis les résultats en rangées
 * (`PatientSearchResults`) ; avant toute recherche, un état vide explique quoi saisir.
 */
import { computed, ref, watch } from 'vue'

import { can } from '@/app/session'
import TextField from '@/components/form/TextField.vue'
import EmptyState from '@/components/layout/EmptyState.vue'
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
const resultsKey = computed(() => `${memory.run}\u{1F}${memory.query}\u{1F}${memory.page}`)

function search(): void {
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

function goToPage(page: number): void {
  announcement.value = 'Chargement de la page…'
  focusResults.value = true
  memory.page = page
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
          hint="Nom, prénom, téléphone ou numéro de dossier (par exemple EE-2026-0001). Au moins 2 caractères."
          :error="error"
        />
      </div>
      <AppButton type="submit" class="field-action"
        ><AppIcon name="search" :size="18" />Rechercher</AppButton
      >
    </form>

    <p role="status" aria-live="polite" class="sr-only">{{ announcement }}</p>

    <PatientSearchResults
      v-if="memory.query !== ''"
      :key="resultsKey"
      :query="memory.query"
      :page="memory.page"
      :focus-on-load="focusResults"
      @page="goToPage"
      @summary="announcement = $event"
    />
    <EmptyState v-else title="Commencez par une recherche" icon="search">
      Saisissez un nom, un téléphone ou un numéro de dossier pour afficher les fiches. Avant de
      créer un nouveau patient, vérifiez qu’il n’existe pas déjà.
    </EmptyState>
  </section>
</template>
