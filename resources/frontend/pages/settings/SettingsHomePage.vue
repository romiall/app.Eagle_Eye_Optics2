<script setup lang="ts">
/**
 * Paramètres (module « settings ») : point d'entrée de la gérante vers les comptes du personnel et
 * l'identité du cabinet imprimée sur les documents (F05 côté serveur, écrans F09). Chaque carte n'apparaît
 * qu'avec son droit ; les autorisations des opérations sensibles (B06) apparaissent quand leur écran existe
 * dans cette version. La liste des modules ouverts n'est PAS un paramètre de la gérante : elle appartient au
 * déploiement (EEO_ENABLED_MODULES), l'écran le dit. Présentation : grille de cartes de rubriques (icône,
 * titre, description, chevron), une colonne sur téléphone, deux sur tablette, trois sur ordinateur.
 */
import { computed } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import { canOnScreen, moduleOpenOnScreen, session } from '@/app/session'
import EmptyState from '@/components/layout/EmptyState.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import AppIcon from '@/components/ui/AppIcon.vue'

interface Card {
  id: string
  title: string
  text: string
  /** Icône décorative de la rubrique (`AppIcon`). */
  icon: string
  to: string | { name: string }
}

const router = useRouter()

const cards = computed<Card[]>(() => {
  const list: Card[] = []
  if (canOnScreen('users.manage')) {
    list.push(
      {
        id: 'personnel',
        title: 'Personnel',
        text: 'Comptes nominatifs, profils, dérogations de droits, désactivation, réinitialisation d’un mot de passe.',
        icon: 'users',
        to: { name: 'parametres-personnel' },
      },
      {
        id: 'cabinet',
        title: 'Cabinet et documents',
        text: 'Nom, coordonnées, identifiant fiscal et mentions imprimés sur les reçus, factures et ordonnances.',
        icon: 'building',
        to: { name: 'parametres-cabinet' },
      },
    )
  }
  if (canOnScreen('approval.decide') && router.hasRoute('approbations')) {
    list.push({
      id: 'approbations',
      title: 'Autorisations',
      text: 'Demandes d’autorisation des opérations sensibles (remise, dispense, correction).',
      icon: 'shield',
      to: { name: 'approbations' },
    })
  }
  if (canOnScreen('export.global') && router.hasRoute('parametres-exports')) {
    list.push({
      id: 'exports',
      title: 'Exports',
      text: 'Archives privées des patients, des ventes, du stock ou de toutes les données, avec leur dictionnaire.',
      icon: 'download',
      to: { name: 'parametres-exports' },
    })
  }
  if (
    moduleOpenOnScreen('reports') &&
    (canOnScreen('statistics.activity') ||
      canOnScreen('statistics.clinical') ||
      canOnScreen('finance.global.read') ||
      canOnScreen('stock.read') ||
      canOnScreen('workshop.manage')) &&
    router.hasRoute('rapports-gestion')
  ) {
    list.push({
      id: 'rapports-gestion',
      title: 'Rapports de gestion',
      text: 'Tableaux consolidés Finance, Stock, Atelier, Patients et Clinique (N vs N-1) et exports CSV / JSON.',
      icon: 'reports',
      to: { name: 'rapports-gestion' },
    })
  }
  // Préparation du poste (O01, O02) : seulement si l'exploitant a ouvert le module « offline ».
  if (
    canOnScreen('offline.enroll') &&
    moduleOpenOnScreen('offline') &&
    router.hasRoute('parametres-poste')
  ) {
    list.push({
      id: 'poste',
      title: 'Préparer ce poste',
      text: 'Coffre chiffré du poste, enrôlement, profils autorisés, numéros réservés et synchronisation du travail sans Internet.',
      icon: 'smartphone',
      to: { name: 'parametres-poste' },
    })
  }
  // Conflits de synchronisation (O05) : décisions motivées de la gérante sur les pièces d'un poste.
  if (
    canOnScreen('approval.decide') &&
    moduleOpenOnScreen('offline') &&
    router.hasRoute('conflits-synchronisation')
  ) {
    list.push({
      id: 'conflits',
      title: 'Conflits de synchronisation',
      text: 'Pièces d’un poste sans Internet que le serveur n’a pas pu appliquer telles quelles : décision motivée.',
      icon: 'cloud-off',
      to: { name: 'conflits-synchronisation' },
    })
  }
  return list
})
</script>

<template>
  <section aria-labelledby="titre-parametres" class="page-stack max-w-5xl">
    <PageHeader
      title-id="titre-parametres"
      title="Paramètres"
      icon="settings"
      :subtitle="session.account?.clinic.name"
    />

    <ul v-if="cards.length > 0" role="list" class="card-grid">
      <li v-for="card in cards" :key="card.id" class="min-w-0">
        <RouterLink :to="card.to" class="group card card-link h-full gap-3 p-5 sm:p-6">
          <span class="flex items-start justify-between gap-3">
            <span
              aria-hidden="true"
              class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gold-soft text-gold-ink"
            >
              <AppIcon :name="card.icon" :size="22" />
            </span>
            <AppIcon
              name="chevron-right"
              :size="20"
              class="mt-3 text-muted group-hover:text-primary"
            />
          </span>
          <span class="text-lg font-semibold text-ink group-hover:text-primary">{{
            card.title
          }}</span>
          <span class="text-sm text-muted">{{ card.text }}</span>
        </RouterLink>
      </li>
    </ul>
    <EmptyState v-else title="Aucun paramètre n’est ouvert à ce compte." icon="lock" />

    <p
      class="flex max-w-prose items-start gap-3 rounded-xl border border-line bg-surface p-4 text-sm text-muted"
    >
      <AppIcon name="info" :size="18" class="mt-0.5 text-gold" />
      <span>
        Les modules visibles dans l’application (patients, consultations, ventes…) sont ouverts par
        l’exploitant lors du déploiement, pas depuis cet écran.
      </span>
    </p>
  </section>
</template>
