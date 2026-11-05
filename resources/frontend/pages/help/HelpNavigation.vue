<script setup lang="ts">
/**
 * Sommaire de la documentation : le lien « Accueil de la documentation », une partie repliable par thème
 * (ses rubriques en dessous), puis la « Référence des écrans » (les fiches d'écran, groupées par module).
 * Ne reçoit que ce que le lecteur a le droit de lire (voir `visibleParts` et `visiblePages`) : une rubrique ou
 * une fiche cachée n'y figure pas, pas même en texte.
 *
 * Une partie est ouverte quand elle contient la rubrique affichée ; la personne peut en ouvrir d'autres, et
 * la navigation suivante ne les referme pas (l'état ouvert / fermé est celui du navigateur : seule la partie
 * COURANTE change d'état). Seul le lien de ce qui est affiché porte `aria-current="page"` (voir
 * `HelpNavLink`).
 *
 * Présentation seule : aucun appel serveur, aucun droit vérifié ici.
 */
import type { RouteLocationRaw } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import type { HandbookPart } from '@/domain/help/model'
import { hashFor } from '@/domain/help/rules'
import { SCREENS_GROUP } from '@/domain/help/search'

import type { DocPlace, ScreenGroup } from './documentation'
import HelpNavLink from './HelpNavLink.vue'

const props = defineProps<{
  parts: readonly HandbookPart[]
  groups: readonly ScreenGroup[]
  place: DocPlace
}>()

/** Titre d'une partie ou d'un groupe repliable : cible de 44 px, sans triangle natif (chevron à la place). */
const SUMMARY_CLASS =
  'flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-2 text-base font-semibold hover:bg-primary-soft'

function topicTo(id: string): RouteLocationRaw {
  return { name: 'aide', hash: hashFor({ kind: 'topic', id }) }
}

function screenTo(route: string): RouteLocationRaw {
  return { name: 'aide', hash: hashFor({ kind: 'screen', route }) }
}

function isTopic(id: string): boolean {
  return props.place.kind === 'topic' && props.place.id === id
}

function isScreen(route: string): boolean {
  return props.place.kind === 'screen' && props.place.route === route
}

function partHoldsPlace(part: HandbookPart): boolean {
  return part.topics.some((topic) => isTopic(topic.id))
}

function groupHoldsPlace(group: ScreenGroup): boolean {
  return group.pages.some((page) => isScreen(page.route))
}

function referenceHoldsPlace(): boolean {
  return props.groups.some((group) => groupHoldsPlace(group))
}
</script>

<template>
  <nav aria-label="Sommaire de la documentation" class="min-w-0">
    <ul role="list" class="space-y-1">
      <li>
        <HelpNavLink :to="{ name: 'aide' }" :current="props.place.kind === 'home'">
          <AppIcon name="home" :size="18" class="text-gold" />
          <span class="min-w-0">Accueil de la documentation</span>
        </HelpNavLink>
      </li>

      <li v-for="part in props.parts" :key="part.id">
        <details class="group/part" :open="partHoldsPlace(part)">
          <summary :class="SUMMARY_CLASS">
            <span class="flex min-w-0 items-center gap-2">
              <AppIcon :name="part.icon" :size="18" class="text-gold" />
              <span class="min-w-0 break-words">{{ part.title }}</span>
            </span>
            <AppIcon
              name="chevron-down"
              :size="18"
              class="text-muted transition-transform group-open/part:rotate-180"
            />
          </summary>
          <ul role="list" class="mt-1 ml-5 space-y-1 border-l border-line pl-2">
            <li v-for="topic in part.topics" :key="topic.id">
              <HelpNavLink :to="topicTo(topic.id)" :current="isTopic(topic.id)">
                {{ topic.title }}
              </HelpNavLink>
            </li>
          </ul>
        </details>
      </li>

      <li v-if="props.groups.length > 0">
        <details class="group/part" :open="referenceHoldsPlace()">
          <summary :class="SUMMARY_CLASS">
            <span class="flex min-w-0 items-center gap-2">
              <AppIcon name="file" :size="18" class="text-gold" />
              <span class="min-w-0 break-words">{{ SCREENS_GROUP }}</span>
            </span>
            <AppIcon
              name="chevron-down"
              :size="18"
              class="text-muted transition-transform group-open/part:rotate-180"
            />
          </summary>
          <ul role="list" class="mt-1 ml-5 space-y-1 border-l border-line pl-2">
            <li v-for="group in props.groups" :key="group.key">
              <details class="group/sub" :open="groupHoldsPlace(group)">
                <summary :class="SUMMARY_CLASS">
                  <span class="min-w-0 break-words">{{ group.title }}</span>
                  <AppIcon
                    name="chevron-down"
                    :size="18"
                    class="text-muted transition-transform group-open/sub:rotate-180"
                  />
                </summary>
                <ul role="list" class="mt-1 ml-3 space-y-1 border-l border-line pl-2">
                  <li v-for="page in group.pages" :key="page.route">
                    <HelpNavLink :to="screenTo(page.route)" :current="isScreen(page.route)">
                      {{ page.title }}
                    </HelpNavLink>
                  </li>
                </ul>
              </details>
            </li>
          </ul>
        </details>
      </li>
    </ul>
  </nav>
</template>
