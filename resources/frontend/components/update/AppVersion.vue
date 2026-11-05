<script setup lang="ts">
/**
 * Pied de page de chaque écran (O06) : la version de l'application que CE navigateur exécute (identifiant de la
 * livraison et date de construction) et un bouton pour chercher une nouvelle version. C'est ce qui permet de vérifier,
 * après une livraison, que l'écran affiche bien la dernière version (constaté le 2026-10-30 : le navigateur gardait
 * l'ancienne, sans que rien ne le dise).
 */
import { computed } from 'vue'

import { clinicTimeZone } from '@/app/clinicTime'
import { describeBuild } from '@/app/buildInfo'
import { APP_BUILD } from '@/app/release'
import { appUpdateState, checkForUpdate } from '@/app/services/appUpdate'

const state = appUpdateState

const versionText = computed(() => describeBuild(APP_BUILD, clinicTimeZone()))

/** Résultat de la dernière recherche, dans les mots de la personne (annoncé sans déplacer le focus). */
const status = computed<string | null>(() => {
  const current = state.value
  if (current.reloadNeeded)
    return 'Cette page doit être rechargée pour utiliser la nouvelle version.'
  if (current.available) {
    return 'Une nouvelle version est prête : installez-la depuis le bandeau en haut de la page.'
  }
  if (current.downloading)
    return 'Une nouvelle version est en cours de préparation dans ce navigateur…'
  if (current.searching) return 'Recherche d’une nouvelle version…'
  if (current.searchFailed) {
    return 'La recherche a échoué : le serveur est injoignable. Réessayez quand la connexion est rétablie.'
  }
  if (current.lastCheckedAt !== null) return 'Vous utilisez la dernière version publiée.'
  return null
})
</script>

<template>
  <footer
    class="border-t border-line bg-surface px-4 py-3 pb-20 text-center text-xs text-muted sm:px-6 md:pb-3 print:hidden"
  >
    <p>
      Version de l’application : <span class="font-medium text-ink">{{ versionText }}</span
      >.
    </p>
    <p v-if="state.supported" class="mt-1 flex flex-wrap items-center justify-center gap-x-3">
      <button
        type="button"
        class="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-primary underline underline-offset-4 hover:bg-primary-soft disabled:cursor-not-allowed disabled:no-underline disabled:text-disabled-ink"
        :disabled="state.searching"
        @click="checkForUpdate('manual')"
      >
        Rechercher une nouvelle version
      </button>
    </p>
    <!-- Zone d'annonce toujours présente : un changement de texte y est lu, une zone qui apparaît ne l'est pas. -->
    <p role="status" class="mt-1 min-h-5 text-sm text-ink">{{ status ?? '' }}</p>
  </footer>
</template>
