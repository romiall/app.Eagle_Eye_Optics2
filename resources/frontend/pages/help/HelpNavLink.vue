<script setup lang="ts">
/**
 * Lien du sommaire de la documentation. Le routeur marque « actif » tout lien qui mène au même écran sans
 * regarder l'ancre (`#/rubrique`) : tous les liens du sommaire porteraient `aria-current="page"`. Ce lien
 * écrit donc lui-même l'attribut, sur la seule rubrique (ou fiche) affichée, et laisse le routeur faire la
 * navigation (clic simple, touches Ctrl / Cmd / Maj pour un autre onglet).
 *
 * Teinte, filet doré et graisse accompagnent l'attribut : la page courante n'est jamais signalée par la seule
 * couleur. Cible de 44 px, texte qui passe à la ligne.
 */
import { RouterLink, type RouteLocationRaw } from 'vue-router'

const props = defineProps<{
  to: RouteLocationRaw
  /** Ce lien mène à ce qui est affiché. */
  current: boolean
}>()
</script>

<template>
  <RouterLink v-slot="{ href, navigate }" :to="props.to" custom>
    <a
      :href="href"
      :aria-current="props.current ? 'page' : undefined"
      class="flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-base wrap-anywhere text-ink hover:bg-primary-soft aria-[current=page]:bg-primary-soft aria-[current=page]:font-semibold aria-[current=page]:text-primary aria-[current=page]:shadow-[inset_3px_0_0_var(--color-gold)]"
      @click="navigate"
    >
      <slot />
    </a>
  </RouterLink>
</template>
