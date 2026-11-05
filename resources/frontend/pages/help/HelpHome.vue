<script setup lang="ts">
/**
 * Accueil de la documentation : un mot d'accueil, les cartes « Par où commencer » (cinq questions que se pose
 * une personne qui ouvre la documentation, chacune menant à des rubriques qu'elle peut lire), puis une carte par
 * partie visible avec son résumé et ses rubriques, et la « Référence des écrans » (la fiche de chaque écran,
 * groupée par module). Le titre (`h2`) reçoit le focus quand on arrive ; il ne défile pas la page à l'ouverture.
 *
 * Ne reçoit que ce que le lecteur a le droit de lire. Présentation seule : aucun appel serveur, aucun droit
 * vérifié ici.
 */
import { useId } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import type { HandbookPart } from '@/domain/help/model'
import { hashFor } from '@/domain/help/rules'
import { SCREENS_GROUP } from '@/domain/help/search'

import type { ScreenGroup, StartCard } from './documentation'

const props = defineProps<{
  cards: readonly StartCard[]
  parts: readonly HandbookPart[]
  groups: readonly ScreenGroup[]
}>()

const uid = useId()
const startId = `${uid}-demarrer`
const partsId = `${uid}-parties`

const TOPIC_LINK =
  'text-link inline-flex min-h-11 max-w-full items-center gap-2 font-medium break-words'

function topicTo(id: string): RouteLocationRaw {
  return { name: 'aide', hash: hashFor({ kind: 'topic', id }) }
}

function screenTo(route: string): RouteLocationRaw {
  return { name: 'aide', hash: hashFor({ kind: 'screen', route }) }
}
</script>

<template>
  <div class="@container min-w-0 space-y-8">
    <header class="space-y-3">
      <h2
        tabindex="-1"
        class="scroll-mt-6 text-2xl font-semibold tracking-tight focus:outline-none"
      >
        Accueil de la documentation
      </h2>
      <p class="max-w-prose text-base">
        Cette documentation explique l’application métier par métier et écran par écran. Elle ne
        montre que ce que votre compte peut ouvrir. Cherchez un mot, parcourez le sommaire ou suivez
        l’un des chemins ci-dessous.
      </p>
    </header>

    <section v-if="props.cards.length > 0" :aria-labelledby="startId" class="space-y-3">
      <h3 :id="startId" class="section-title">Par où commencer</h3>
      <ul role="list" class="grid gap-3 @xl:grid-cols-2">
        <li v-for="card in props.cards" :key="card.id" class="card min-w-0 space-y-2 p-4">
          <h4 class="text-base font-semibold break-words">{{ card.title }}</h4>
          <p class="text-muted">{{ card.text }}</p>
          <ul role="list" class="space-y-1">
            <li v-for="link in card.links" :key="link.hash">
              <RouterLink :to="{ name: 'aide', hash: link.hash }" :class="TOPIC_LINK">
                <AppIcon name="arrow-right" :size="16" class="text-gold" />
                <span class="min-w-0">{{ link.label }}</span>
              </RouterLink>
            </li>
          </ul>
        </li>
      </ul>
    </section>

    <section
      v-if="props.parts.length > 0 || props.groups.length > 0"
      :aria-labelledby="partsId"
      class="space-y-3"
    >
      <h3 :id="partsId" class="section-title">Les parties de la documentation</h3>
      <ul role="list" class="grid gap-3 @xl:grid-cols-2">
        <li v-for="part in props.parts" :key="part.id" class="card min-w-0 space-y-3 p-4">
          <div class="flex items-start gap-3">
            <span
              aria-hidden="true"
              class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gold-soft text-gold-ink"
            >
              <AppIcon :name="part.icon" :size="18" />
            </span>
            <div class="min-w-0 space-y-1">
              <h4 class="text-base font-semibold break-words">{{ part.title }}</h4>
              <p class="text-muted">{{ part.summary }}</p>
            </div>
          </div>
          <ul role="list" class="space-y-1">
            <li v-for="topic in part.topics" :key="topic.id">
              <RouterLink :to="topicTo(topic.id)" :class="TOPIC_LINK">
                <AppIcon name="chevron-right" :size="16" class="text-gold" />
                <span class="min-w-0">{{ topic.title }}</span>
              </RouterLink>
            </li>
          </ul>
        </li>

        <li v-if="props.groups.length > 0" class="card min-w-0 space-y-3 p-4 @xl:col-span-2">
          <div class="flex items-start gap-3">
            <span
              aria-hidden="true"
              class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gold-soft text-gold-ink"
            >
              <AppIcon name="file" :size="18" />
            </span>
            <div class="min-w-0 space-y-1">
              <h4 class="text-base font-semibold break-words">{{ SCREENS_GROUP }}</h4>
              <p class="text-muted">
                La fiche de chaque écran, la même que celle du bouton « Aide » de l’en-tête.
              </p>
            </div>
          </div>
          <div class="space-y-2">
            <details
              v-for="group in props.groups"
              :key="group.key"
              class="group rounded-xl border border-line bg-canvas"
            >
              <summary
                class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-base font-semibold hover:bg-primary-soft"
              >
                <span class="min-w-0 break-words">{{ group.title }}</span>
                <AppIcon
                  name="chevron-down"
                  :size="20"
                  class="text-muted transition-transform group-open:rotate-180"
                />
              </summary>
              <ul role="list" class="space-y-1 border-t border-line px-4 py-2">
                <li v-for="page in group.pages" :key="page.route">
                  <RouterLink :to="screenTo(page.route)" :class="TOPIC_LINK">
                    <AppIcon name="chevron-right" :size="16" class="text-gold" />
                    <span class="min-w-0">{{ page.title }}</span>
                  </RouterLink>
                </li>
              </ul>
            </details>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
