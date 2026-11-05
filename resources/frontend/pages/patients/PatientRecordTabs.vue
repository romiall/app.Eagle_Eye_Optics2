<script setup lang="ts">
/**
 * Onglets du dossier patient (fichier 04 : « En-tête identité ; onglets… » ; « chargement du seul onglet
 * nécessaire ») : Identité, Activité et, pour un compte clinique (module « consultations » ouvert),
 * Prescriptions (ordonnances externes transcrites). Chaque onglet est une adresse distincte, qui ne lit que ce qu'elle
 * montre : la fiche d'identité ne lit jamais l'activité. Ce sont des liens de navigation (le clavier, le
 * menu contextuel et les lecteurs d'écran les traitent comme tels) ; `RouterLink` pose
 * `aria-current="page"` sur l'onglet affiché. Les libellés ne nomment aucune donnée clinique ni financière.
 *
 * Présentation : onglets soulignés sous un filet, l'onglet affiché en encre souligné d'or, les autres en
 * texte secondaire. Sur téléphone, icônes masquées et marges resserrées pour tenir sur une ligne à
 * 360 px ; la liste passe à la ligne plutôt que de déborder (zoom 200 %).
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import { canOnScreen, moduleOpenOnScreen, session } from '@/app/session'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{
  patientId: string
  current: 'identite' | 'activite' | 'prescriptions'
}>()

// Session locale (serveur non joint) : l'activité et les prescriptions se lisent sur le serveur, leurs onglets sont masqués.
const TABS = computed(() => [
  { key: 'identite', label: 'Identité', route: 'patient', icon: 'id-card' },
  ...(session.status === 'local'
    ? []
    : [{ key: 'activite', label: 'Activité', route: 'patient-activite', icon: 'history' }]),
  ...(session.status !== 'local' &&
  canOnScreen('clinical.read') &&
  moduleOpenOnScreen('consultations')
    ? [
        {
          key: 'prescriptions',
          label: 'Prescriptions',
          route: 'patient-prescriptions',
          icon: 'glasses',
        },
      ]
    : []),
])

const BASE =
  'inline-flex min-h-11 items-center gap-2 border-b-2 px-2.5 py-2 text-base font-semibold sm:px-4'
</script>

<template>
  <nav aria-label="Sections du dossier patient" class="border-b border-line">
    <ul class="-mb-px flex flex-wrap gap-x-1 sm:gap-x-2">
      <li v-for="tab in TABS" :key="tab.key">
        <RouterLink
          :to="{ name: tab.route, params: { id: props.patientId } }"
          :class="[
            BASE,
            tab.key === props.current
              ? 'border-gold text-ink'
              : 'border-transparent text-muted hover:border-line hover:text-ink',
          ]"
          ><AppIcon
            :name="tab.icon"
            :size="18"
            :class="['hidden sm:block', tab.key === props.current ? 'text-gold' : '']"
          />{{ tab.label }}</RouterLink
        >
      </li>
    </ul>
  </nav>
</template>
