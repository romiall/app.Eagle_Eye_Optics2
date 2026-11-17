<script setup lang="ts">
/**
 * États d'une lecture des pages publiques (showroom, prestations, créneaux) : chargement, connexion impossible,
 * page non ouverte (module fermé ou référence inconnue, 404) et erreur du serveur. Le message dit ce qui est su, pas
 * davantage : une liste qui n'a pas pu être lue n'est jamais « aucune référence ». Les états « prêt » et « vide » sont
 * rendus par la page elle-même. Aucun vocabulaire de compte ni de session : le visiteur n'en a pas.
 */
import { computed } from 'vue'

import type { ApiError } from '@/app/api'
import type { ReadState } from '@/app/services/reads'
import StateMessage, { type ScreenState } from '@/components/feedback/StateMessage.vue'
import AppButton from '@/components/ui/AppButton.vue'

const props = withDefaults(
  defineProps<{
    state: ReadState
    /** Ce qui est lu, avec son article : « les références du showroom », « les créneaux ». */
    subject: string
    error?: ApiError | null | undefined
  }>(),
  { error: null },
)

const emit = defineEmits<{ retry: [] }>()

interface View {
  state: ScreenState
  title: string
  text: string
  retry: boolean
}

const view = computed<View | null>(() => {
  switch (props.state) {
    case 'loading':
      return { state: 'loading', title: 'Chargement…', text: '', retry: false }
    case 'offline':
      return {
        state: 'offline',
        title: 'Connexion impossible',
        text: `Impossible de lire ${props.subject} : vérifiez votre connexion Internet, puis réessayez.`,
        retry: true,
      }
    case 'ready':
    case 'empty':
      return null
    default:
      return props.error?.status === 404
        ? {
            state: 'empty',
            title: 'Page non disponible',
            text: 'Cette page n’est pas ouverte pour le moment. Contactez directement le cabinet.',
            retry: false,
          }
        : {
            state: 'error',
            title: 'Le service ne répond pas',
            text: `Impossible de lire ${props.subject} pour le moment. Réessayez dans quelques instants.`,
            retry: true,
          }
  }
})
</script>

<template>
  <StateMessage v-if="view" :state="view.state" :title="view.title">
    {{ view.text }}
    <template v-if="view.retry" #action>
      <AppButton variant="secondary" @click="emit('retry')">Réessayer</AppButton>
    </template>
  </StateMessage>
</template>
