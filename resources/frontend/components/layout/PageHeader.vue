<script setup lang="ts">
/**
 * En-tête d'écran (charte du logo, docs/implementation/shell.md) : lien de retour facultatif,
 * pastille d'icône dorée facultative, vrai titre `h1` au texte fourni (son `id` sert à
 * l'`aria-labelledby` de la section de l'écran ; le filet doré sous le titre vient de
 * `#contenu h1`), rubrique, sous-titre et emplacement d'actions : à droite du titre sur tablette et
 * ordinateur, dessous et en pleine largeur sur téléphone. Présentation seule : aucun appel serveur
 * ni droit vérifié ici, l'écran ne passe que les actions ouvertes au compte
 * (`<template v-if="…" #actions>`).
 *
 * Fentes : `title` (contenu du `h1` à la place de `title`), par défaut (sous le sous-titre : puces
 * d'état, précisions), `actions` (boutons et liens de l'écran).
 */
import { RouterLink, type RouteLocationRaw } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'

/** Lien de retour affiché au-dessus du titre (« Retour aux patients »). */
export interface PageBackLink {
  to: RouteLocationRaw
  label: string
}

const props = withDefaults(
  defineProps<{
    /** Identifiant du `h1`, repris par l'`aria-labelledby` de la section de l'écran. */
    titleId: string
    /** Texte du `h1`, tel que les tests le ciblent ; la fente `title` le remplace. */
    title?: string
    /** Phrase d'introduction sous le titre (texte secondaire). */
    subtitle?: string | undefined
    /** Nom d'une icône d'`AppIcon`, décorative. */
    icon?: string | undefined
    /** Rubrique en capitales dorées au-dessus du titre ; jamais le doublon d'un autre texte. */
    eyebrow?: string | undefined
    back?: PageBackLink | undefined
  }>(),
  { title: '', subtitle: undefined, icon: undefined, eyebrow: undefined, back: undefined },
)
</script>

<template>
  <header class="space-y-3">
    <p v-if="props.back">
      <RouterLink
        :to="props.back.to"
        class="-ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-muted hover:text-primary hover:underline hover:underline-offset-4"
        ><AppIcon name="arrow-left" :size="16" />{{ props.back.label }}</RouterLink
      >
    </p>
    <div
      class="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-6"
    >
      <div class="flex min-w-0 flex-1 items-start gap-4 sm:basis-72">
        <div
          v-if="props.icon"
          aria-hidden="true"
          class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gold-soft text-gold-ink sm:size-12"
        >
          <AppIcon :name="props.icon" :size="24" />
        </div>
        <div class="min-w-0 space-y-1">
          <p
            v-if="props.eyebrow"
            class="text-sm font-semibold tracking-wide text-gold-ink uppercase"
          >
            {{ props.eyebrow }}
          </p>
          <h1
            :id="props.titleId"
            class="text-2xl font-semibold tracking-tight break-words sm:text-3xl"
          >
            <slot name="title">{{ props.title }}</slot>
          </h1>
          <p v-if="props.subtitle" class="max-w-prose text-base text-muted">
            {{ props.subtitle }}
          </p>
          <div v-if="$slots.default" class="pt-1">
            <slot />
          </div>
        </div>
      </div>
      <div v-if="$slots.actions" class="flex min-w-0 max-w-full flex-wrap gap-3 *:grow sm:*:grow-0">
        <slot name="actions" />
      </div>
    </div>
  </header>
</template>
