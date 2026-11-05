<script setup lang="ts">
/**
 * Mise en page des blocs d'une rubrique d'aide (docs/implementation/help.md) : étapes numérotées,
 * puces, notes, enchaînement d'étapes, tableau, questions fréquentes et définitions. Un seul rendu pour
 * toute l'aide : la documentation globale et les fiches d'écran montrent les mêmes blocs, si bien que le
 * personnel retrouve partout les mêmes repères (pastilles dorées pour les étapes, puces dorées, notes
 * dont le fond ET le symbole changent avec le ton).
 *
 * Tout texte passe par `HelpText` : les libellés d'écran écrits « comme ceci » deviennent des puces et
 * aucun HTML n'est interprété. Présentation seule : aucun appel serveur, aucun droit vérifié (le parent
 * ne passe que les blocs qu'il a le droit de montrer).
 *
 * Accessibilité : le titre d'un bloc est un vrai titre (`level`, sans saut de niveau) ; les listes gardent
 * leur rôle malgré l'absence de puces natives (`role="list"`, comme le reste de l'application) ; la
 * couleur ne porte jamais seule le sens d'une note (symbole, et ton lu à voix haute pour les lecteurs
 * d'écran) ; le tableau a sa légende, ses en-têtes de colonne et de ligne, et son cadre défilant se
 * prend au clavier ; les questions fréquentes sont des `details` natifs (clavier et état annoncés par le
 * navigateur). Mise en page : colonne unique à 360 px, sans défilement horizontal de la page ; un
 * enchaînement d'étapes est vertical dans un cadre étroit et passe en rangées quand son cadre s'élargit
 * (requête de conteneur : il s'adapte à la place qu'on lui donne, pas à la largeur de l'écran).
 */
import { computed, useId } from 'vue'

import HelpText from '@/components/help/HelpText.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { HelpBlock } from '@/domain/help/model'

type NoteTone = 'info' | 'warning' | 'tip'

const props = withDefaults(
  defineProps<{
    blocks: readonly HelpBlock[]
    /** Niveau des titres de bloc : 3 sous un titre de rubrique `h2`, 4 sous un `h3`. */
    level?: 3 | 4 | undefined
  }>(),
  { level: 3 },
)

const uid = useId()
const headingTag = computed(() => (props.level === 4 ? 'h4' : 'h3'))

/**
 * Aspect d'une note selon son ton : fond, filet gauche, symbole et mot lu à voix haute. Associations de
 * teintes vérifiées par palette.test.ts (encre sur chaque fond léger, symbole dans la teinte de l'état).
 */
const NOTE_LOOKS: Readonly<
  Record<NoteTone, { box: string; icon: string; tint: string; label: string }>
> = {
  info: {
    box: 'border-line border-l-gold bg-primary-soft',
    icon: 'info',
    tint: 'text-primary',
    label: 'Information',
  },
  warning: {
    box: 'border-warning bg-warning-soft',
    icon: 'alert',
    tint: 'text-warning',
    label: 'Attention',
  },
  tip: {
    box: 'border-accent bg-accent-soft',
    icon: 'check-circle',
    tint: 'text-accent',
    label: 'Conseil',
  },
}

function noteLook(tone: NoteTone | undefined): (typeof NOTE_LOOKS)[NoteTone] {
  return NOTE_LOOKS[tone ?? 'info']
}

/** Colonnes d'un enchaînement d'étapes quand son cadre est assez large : 2 × 2 pour quatre étapes, 3 au plus. */
function flowColumns(count: number): number {
  if (count === 4) return 2
  return Math.min(Math.max(count, 1), 3)
}

/** Une flèche relie une étape à la suivante de SA rangée, jamais à la première de la rangée d'après. */
function hasArrowToRight(index: number, count: number): boolean {
  return index < count - 1 && (index + 1) % flowColumns(count) !== 0
}

/** Identifiant de la légende d'un tableau (nom du cadre défilant). */
function captionId(index: number): string {
  return `${uid}-tableau-${index}`
}
</script>

<template>
  <div v-if="props.blocks.length > 0" class="min-w-0 space-y-5">
    <template v-for="(block, index) in props.blocks" :key="`${index}-${block.kind}`">
      <!-- Étapes : une action par ligne, pastille dorée numérotée. -->
      <div v-if="block.kind === 'steps'" class="space-y-3">
        <component :is="headingTag" v-if="block.title" class="text-base font-semibold break-words">
          <HelpText :text="block.title" />
        </component>
        <ol role="list" class="max-w-prose space-y-3">
          <li v-for="(item, step) in block.items" :key="step" class="flex gap-3">
            <span
              aria-hidden="true"
              class="flex size-7 shrink-0 items-center justify-center rounded-full bg-gold-soft text-sm font-semibold text-gold-ink tabular-nums"
              >{{ step + 1 }}</span
            >
            <span class="min-w-0 pt-0.5 break-words"><HelpText :text="item" /></span>
          </li>
        </ol>
      </div>

      <!-- Puces : points à retenir, sans ordre. -->
      <div v-else-if="block.kind === 'points'" class="space-y-3">
        <component :is="headingTag" v-if="block.title" class="text-base font-semibold break-words">
          <HelpText :text="block.title" />
        </component>
        <ul role="list" class="max-w-prose space-y-2">
          <li v-for="(item, point) in block.items" :key="point" class="flex gap-3">
            <span aria-hidden="true" class="mt-2.5 size-1.5 shrink-0 rounded-full bg-gold"></span>
            <span class="min-w-0 break-words"><HelpText :text="item" /></span>
          </li>
        </ul>
      </div>

      <!-- Note : le ton change le fond ET le symbole, et le mot est lu aux lecteurs d'écran. -->
      <div
        v-else-if="block.kind === 'note'"
        role="note"
        :class="[
          'flex items-start gap-3 rounded-xl border border-l-4 p-4 text-ink',
          noteLook(block.tone).box,
        ]"
      >
        <AppIcon
          :name="noteLook(block.tone).icon"
          :size="20"
          :class="['mt-0.5', noteLook(block.tone).tint]"
        />
        <p class="max-w-prose min-w-0 break-words">
          <span class="sr-only">{{ `${noteLook(block.tone).label} : ` }}</span>
          <HelpText :text="block.text" />
        </p>
      </div>

      <!-- Enchaînement : vertical dans un cadre étroit, en rangées reliées par des flèches ensuite. -->
      <div v-else-if="block.kind === 'flow'" class="@container space-y-3">
        <component :is="headingTag" v-if="block.title" class="text-base font-semibold break-words">
          <HelpText :text="block.title" />
        </component>
        <ol
          role="list"
          class="grid grid-cols-1 gap-y-7 @xl:grid-cols-[repeat(var(--flow-columns),minmax(0,1fr))] @xl:gap-x-9"
          :style="{ '--flow-columns': String(flowColumns(block.stages.length)) }"
        >
          <li v-for="(stage, position) in block.stages" :key="position" class="relative min-w-0">
            <div class="h-full rounded-xl border border-line bg-canvas p-4">
              <p class="flex items-start gap-2 font-semibold">
                <span
                  aria-hidden="true"
                  class="flex size-6 shrink-0 items-center justify-center rounded-full bg-gold-soft text-sm text-gold-ink tabular-nums"
                  >{{ position + 1 }}</span
                >
                <span class="min-w-0 break-words"><HelpText :text="stage.label" /></span>
              </p>
              <p class="mt-2 break-words"><HelpText :text="stage.text" /></p>
            </div>
            <AppIcon
              v-if="position < block.stages.length - 1"
              name="chevron-down"
              :size="20"
              class="absolute -bottom-6 left-1/2 -translate-x-1/2 text-gold @xl:hidden"
            />
            <AppIcon
              v-if="hasArrowToRight(position, block.stages.length)"
              name="chevron-right"
              :size="20"
              class="absolute top-1/2 -right-7 hidden -translate-y-1/2 text-gold @xl:block"
            />
          </li>
        </ol>
      </div>

      <!-- Tableau : légende, en-têtes de colonne et de ligne, cadre qui défile seul (jamais la page). -->
      <div
        v-else-if="block.kind === 'table'"
        role="region"
        tabindex="0"
        :aria-label="block.title ? undefined : 'Tableau'"
        :aria-labelledby="block.title ? captionId(index) : undefined"
        class="data-table-wrap"
      >
        <table class="data-table">
          <caption v-if="block.title" :id="captionId(index)">
            <HelpText :text="block.title" />
          </caption>
          <thead>
            <tr>
              <th v-for="(cell, column) in block.head" :key="column" scope="col">
                <HelpText :text="cell" />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, line) in block.rows" :key="line">
              <template v-for="(cell, column) in row" :key="column">
                <th v-if="column === 0" scope="row" class="text-left font-semibold">
                  <HelpText :text="cell" />
                </th>
                <td v-else><HelpText :text="cell" /></td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Questions fréquentes : une question fermée par défaut, la réponse dessous. -->
      <div v-else-if="block.kind === 'faq'" class="space-y-3">
        <component :is="headingTag" v-if="block.title" class="text-base font-semibold break-words">
          <HelpText :text="block.title" />
        </component>
        <div class="space-y-2">
          <details
            v-for="(item, position) in block.items"
            :key="position"
            class="group rounded-xl border border-line bg-surface"
          >
            <summary
              class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-base font-semibold hover:bg-primary-soft"
            >
              <span class="min-w-0 break-words"><HelpText :text="item.q" /></span>
              <AppIcon
                name="chevron-down"
                :size="20"
                class="text-muted transition-transform group-open:rotate-180"
              />
            </summary>
            <div class="max-w-prose border-t border-line px-4 py-3 break-words">
              <HelpText :text="item.a" />
            </div>
          </details>
        </div>
      </div>

      <!-- Définitions : un mot, son sens. -->
      <div v-else-if="block.kind === 'terms'" class="space-y-3">
        <component :is="headingTag" v-if="block.title" class="text-base font-semibold break-words">
          <HelpText :text="block.title" />
        </component>
        <dl class="space-y-2">
          <div
            v-for="(item, position) in block.items"
            :key="position"
            class="rounded-xl border border-line bg-canvas px-4 py-3"
          >
            <dt class="font-semibold break-words"><HelpText :text="item.term" /></dt>
            <dd class="mt-1 max-w-prose break-words"><HelpText :text="item.definition" /></dd>
          </div>
        </dl>
      </div>
    </template>
  </div>
</template>
