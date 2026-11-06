<script setup lang="ts">
/**
 * Ventes et caisse (B01 à B05, I00) : point d'entrée du module « sales ». Chaque écran n'est proposé
 * qu'avec son droit (le serveur revérifie chaque action) ; le stock n'apparaît que si son module est
 * ouvert. Premier jalon EN LIGNE : tout ce qui s'enregistre ici l'est sur le serveur, rien n'est
 * enregistré sur ce poste.
 */
import { computed } from 'vue'

import { canOnScreen, moduleOpenOnScreen } from '@/app/session'
import LinkButton from '@/components/ui/LinkButton.vue'

interface Entry {
  name: string
  label: string
  text: string
  visible: boolean
}

const entries = computed<Entry[]>(() =>
  [
    {
      name: 'caisse',
      label: 'Caisse',
      text: 'Ouvrir la session du jour avec son fond, la clôturer avec le compté.',
      visible: canOnScreen('cash.own_session'),
    },
    {
      name: 'caisse-du-jour',
      label: 'Caisse du jour',
      text: canOnScreen('finance.global.read')
        ? 'Encaissements du jour par mode, ventes émises et reste à encaisser.'
        : 'Vos encaissements du jour par mode et vos sessions.',
      visible: canOnScreen('finance.global.read') || canOnScreen('cash.own_session'),
    },
    {
      name: 'finance',
      label: 'Finance du cabinet',
      text: 'Chiffre d’affaires, encaissements, créances et caisse sur une période, avec la fraîcheur des postes (gérante).',
      visible: canOnScreen('finance.global.read'),
    },
    {
      name: 'facture-nouvelle',
      label: 'Nouvelle facture',
      text: 'Préparer un brouillon pour un patient, puis l’émettre.',
      visible: canOnScreen('invoice.create') || canOnScreen('exam_fee.collect'),
    },
    {
      name: 'factures',
      label: 'Factures',
      text: 'Brouillons et factures émises, encaissements et reçus.',
      visible: canOnScreen('invoice.read'),
    },
    {
      name: 'devis',
      label: 'Devis',
      text: 'Propositions remises au client, révisions réimprimables et conversion en facture.',
      visible: canOnScreen('invoice.read'),
    },
    {
      name: 'catalogue',
      label: 'Catalogue',
      text: 'Articles, prestations et prix de vente (gérante).',
      visible: canOnScreen('catalog.manage'),
    },
    {
      name: 'taxes',
      label: 'Règles fiscales',
      text: 'Taux saisis et validés par la gérante ; aucune taxe n’est préconfigurée.',
      visible: canOnScreen('catalog.manage'),
    },
    {
      name: 'stock',
      label: 'Stock',
      text: 'Disponibilités et stock initial (gérante).',
      visible: moduleOpenOnScreen('stock') && canOnScreen('stock.read'),
    },
  ].filter((entry) => entry.visible),
)
</script>

<template>
  <section aria-labelledby="titre-ventes" class="max-w-3xl space-y-6">
    <h1 id="titre-ventes" class="text-2xl font-semibold tracking-tight">Ventes et caisse</h1>
    <p class="text-base text-muted">
      Écrans en ligne : chaque enregistrement est confirmé par le serveur avant d’être dit
      enregistré.
    </p>
    <ul class="grid gap-3 sm:grid-cols-2">
      <li
        v-for="entry in entries"
        :key="entry.name"
        class="space-y-2 rounded-xl border border-line bg-surface shadow-card p-4"
      >
        <LinkButton :to="{ name: entry.name }" variant="secondary">{{ entry.label }}</LinkButton>
        <p class="text-sm text-muted">{{ entry.text }}</p>
      </li>
    </ul>
    <p v-if="entries.length === 0" class="text-base">
      Aucun écran de vente n’est ouvert à ce compte.
    </p>
  </section>
</template>
