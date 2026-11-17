<script setup lang="ts">
/**
 * Bandeau « Aujourd’hui » de l'accueil : chiffres du jour civil du cabinet lus sur le serveur,
 * chaque tuile affichée seulement avec son droit ET son module ouvert, comme l'écran de détail où
 * elle mène (et comme la route du serveur, qui revérifie tout) :
 *  - file du jour : `visit.register` ou `agenda.read`, module « today » ;
 *  - rendez-vous du jour : `agenda.read`, module « agenda » ;
 *  - encaissé net du jour : `finance.global.read` ou `cash.own_session`, module « sales » ;
 *  - alertes de stock bas et péremption : `stock.read`, module « stock ».
 * Sans aucune tuile ouverte, rien n'est affiché ni lu. Quand les tuiles ouvertes changent (droits
 * relus avec la session), le bloc des tuiles est remonté et ses lectures recréées.
 */
import { computed } from 'vue'

import { canOnScreen, moduleOpenOnScreen } from '@/app/session'

import TodayFigures from './TodayFigures.vue'

const queue = computed(() => {
  const readable = canOnScreen('visit.register') || canOnScreen('agenda.read')
  return readable && moduleOpenOnScreen('today')
})
const appointments = computed(() => canOnScreen('agenda.read') && moduleOpenOnScreen('agenda'))
const cash = computed(() => {
  const readable = canOnScreen('finance.global.read') || canOnScreen('cash.own_session')
  return readable && moduleOpenOnScreen('sales')
})
const stockAlerts = computed(() => canOnScreen('stock.read') && moduleOpenOnScreen('stock'))
/** Change avec les tuiles ouvertes : le bloc est remonté et ses lectures recréées. */
const shownKey = computed(() =>
  [queue.value, appointments.value, cash.value, stockAlerts.value].join('-'),
)
</script>

<template>
  <TodayFigures
    v-if="queue || appointments || cash || stockAlerts"
    :key="shownKey"
    :queue="queue"
    :appointments="appointments"
    :cash="cash"
    :stock-alerts="stockAlerts"
  />
</template>
