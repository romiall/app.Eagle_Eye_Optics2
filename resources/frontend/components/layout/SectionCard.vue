<script setup lang="ts">
/**
 * Carte de section d'un écran (charte du logo, docs/implementation/shell.md) : surface blanche à
 * bordure fine et ombre légère, en-tête facultatif (pastille d'icône dorée, titre `h2` ou `h3` avec
 * son `id`, description, actions à droite qui passent dessous sur téléphone) puis le corps. Titrée
 * et identifiée, la carte est une `section` nommée par son titre (`aria-labelledby`) ; sinon un
 * simple `div`. Variante `flat` : fond crème sans ombre (bloc secondaire, carte dans une carte).
 * Variante `flush` : corps sans marge intérieure, pour un tableau `data-table` collé aux bords.
 * Présentation seule : aucun appel serveur.
 *
 * Fentes : par défaut (corps), `actions` (boutons ou liens de la section).
 */
import { computed, useSlots } from 'vue'

import AppIcon from '@/components/ui/AppIcon.vue'

const props = withDefaults(
  defineProps<{
    title?: string | undefined
    /** Identifiant du titre (cible d'`aria-labelledby`, d'un lien ou d'un test). */
    titleId?: string | undefined
    description?: string | undefined
    /** Nom d'une icône d'`AppIcon`, décorative. */
    icon?: string | undefined
    /** `h2` sous le `h1` de l'écran ; `h3` dans une section déjà titrée. */
    headingLevel?: 'h2' | 'h3'
    /** Élément racine imposé ; par défaut `section` si la carte est titrée et identifiée. */
    as?: 'section' | 'div' | 'article' | undefined
    flat?: boolean
    flush?: boolean
  }>(),
  {
    title: undefined,
    titleId: undefined,
    description: undefined,
    icon: undefined,
    headingLevel: 'h2',
    as: undefined,
    flat: false,
    flush: false,
  },
)

const slots = useSlots()

const titled = computed(() => Boolean(props.title) && props.titleId !== undefined)
const tag = computed(() => props.as ?? (titled.value ? 'section' : 'div'))

/** L'en-tête existe avec un titre, une description ou des actions (lu à chaque rendu). */
function hasHeader(): boolean {
  return Boolean(props.title) || Boolean(props.description) || slots.actions !== undefined
}

/** Marges du corps : resserrées sous un en-tête, nulles pour un tableau collé aux bords. */
function bodyClass(): string {
  if (props.flush) return hasHeader() ? 'section-card-flush mt-4' : 'section-card-flush'
  return hasHeader() ? 'px-4 pt-4 pb-4 sm:px-6 sm:pb-6' : 'p-4 sm:p-6'
}
</script>

<template>
  <component
    :is="tag"
    :aria-labelledby="titled && tag !== 'div' ? props.titleId : undefined"
    :class="[
      'min-w-0 rounded-xl border border-line',
      props.flat ? 'bg-canvas' : 'bg-surface shadow-card',
    ]"
  >
    <div
      v-if="hasHeader()"
      class="flex flex-col gap-3 px-4 pt-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:px-6 sm:pt-5"
    >
      <div class="flex min-w-0 flex-1 items-start gap-3 sm:basis-60">
        <div
          v-if="props.icon"
          aria-hidden="true"
          class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gold-soft text-gold-ink"
        >
          <AppIcon :name="props.icon" :size="18" />
        </div>
        <div class="min-w-0 space-y-1">
          <component
            :is="props.headingLevel"
            v-if="props.title"
            :id="props.titleId"
            :class="[
              'font-semibold break-words',
              props.headingLevel === 'h2' ? 'text-lg' : 'text-base',
            ]"
          >
            {{ props.title }}
          </component>
          <p v-if="props.description" class="max-w-prose text-sm text-muted">
            {{ props.description }}
          </p>
        </div>
      </div>
      <div v-if="$slots.actions" class="flex min-w-0 max-w-full flex-wrap gap-2">
        <slot name="actions" />
      </div>
    </div>
    <div :class="bodyClass()">
      <slot />
    </div>
  </component>
</template>
