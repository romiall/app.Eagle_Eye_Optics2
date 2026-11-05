<script setup lang="ts">
/**
 * Une rubrique de la documentation (une page de lecture) : la partie qui la range, son titre (`h2`, qui reçoit
 * le focus quand on arrive), son résumé, les pastilles « Pour » (profils concernés) et « En cours de
 * validation », son introduction, ses blocs (`HelpBlocks`, titres de niveau 3), « Pour aller plus loin » et les
 * rubriques voisines de la partie (« Précédente », « Suivante »).
 *
 * Seul ce que le lecteur peut ouvrir est lié : une rubrique cachée n'est pas proposée, un écran fermé ou interdit
 * non plus (`linkState`, voir `useHelpLinks`) ; un écran qui demande le serveur est nommé sans lien, avec la
 * mention « (demande le serveur) ». Un lien « Pour aller plus loin » ne trahit jamais l'existence de ce qu'il
 * cache : ni lien, ni nom, ni raison.
 *
 * Présentation seule : aucun appel serveur, aucun droit vérifié ici.
 */
import { computed, useId } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'

import HelpBlocks from '@/components/help/HelpBlocks.vue'
import HelpText from '@/components/help/HelpText.vue'
import type { HelpLinkState } from '@/components/help/useHelpLinks'
import StatusChip from '@/components/layout/StatusChip.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { HandbookPart, HandbookTopic } from '@/domain/help/model'
import { PROFILES } from '@/domain/help/profiles'
import { hashFor } from '@/domain/help/rules'

const props = defineProps<{
  part: HandbookPart
  topic: HandbookTopic
  /** Rubriques voisines dans la partie (visibles pour le lecteur). */
  previous?: HandbookTopic | undefined
  next?: HandbookTopic | undefined
  /** État d'un écran cité pour CE lecteur : `open` (lien), `server` (texte et « demande le serveur »), `hidden`. */
  linkState: (route: string) => HelpLinkState
  /** Le lecteur peut-il lire cette rubrique ? Sinon le lien « Pour aller plus loin » n'est pas montré. */
  canOpenTopic: (id: string) => boolean
}>()

const uid = useId()
const titleId = `${uid}-titre`
const relatedId = `${uid}-suite`

/** Profils pour qui la rubrique est écrite, par leur nom court (« Gérante », « Accueil »…). */
const audience = computed(() =>
  (props.topic.audience ?? []).map(
    (code) => PROFILES.find((profile) => profile.code === code)?.label ?? code,
  ),
)

interface RelatedLink {
  readonly key: string
  readonly label: string
  readonly why: string | undefined
  /** Cible du lien ; `null` : écran qui demande le serveur (texte sans lien). */
  readonly to: RouteLocationRaw | null
  readonly server: boolean
}

function topicTo(id: string): RouteLocationRaw {
  return { name: 'aide', hash: hashFor({ kind: 'topic', id }) }
}

/** « Pour aller plus loin » : les renvois de la rubrique que ce lecteur peut suivre. */
const related = computed<RelatedLink[]>(() => {
  const links: RelatedLink[] = []
  for (const [index, link] of (props.topic.related ?? []).entries()) {
    if ('topic' in link) {
      if (!props.canOpenTopic(link.topic)) continue
      links.push({
        key: `${index}-${link.topic}`,
        label: link.label,
        why: link.why,
        to: topicTo(link.topic),
        server: false,
      })
      continue
    }
    const state = props.linkState(link.route)
    if (state === 'hidden') continue
    links.push({
      key: `${index}-${link.route}`,
      label: link.label,
      why: link.why,
      to: state === 'open' ? { name: link.route } : null,
      server: state === 'server',
    })
  }
  return links
})
</script>

<template>
  <article :aria-labelledby="titleId" class="min-w-0 space-y-6">
    <header class="space-y-3">
      <p class="text-sm font-semibold tracking-wide text-gold-ink uppercase">
        {{ props.part.title }}
      </p>
      <h2
        :id="titleId"
        tabindex="-1"
        class="scroll-mt-6 text-2xl font-semibold tracking-tight break-words focus:outline-none"
      >
        {{ props.topic.title }}
      </h2>
      <p class="max-w-prose text-base text-muted">
        <HelpText :text="props.topic.summary" />
      </p>
      <div
        v-if="audience.length > 0 || props.topic.maturity === 'validation'"
        class="flex flex-wrap items-center gap-2"
      >
        <template v-if="audience.length > 0">
          <span class="text-sm font-medium text-muted">Pour</span>
          <ul role="list" aria-label="Profils concernés" class="flex flex-wrap gap-2">
            <StatusChip v-for="label in audience" :key="label" as="li" tone="gold" icon="user">
              {{ label }}
            </StatusChip>
          </ul>
        </template>
        <StatusChip v-if="props.topic.maturity === 'validation'" tone="warning" icon="alert">
          En cours de validation : pas encore ouvert au cabinet
        </StatusChip>
      </div>
    </header>

    <p v-if="props.topic.intro" class="max-w-prose text-base">
      <HelpText :text="props.topic.intro" />
    </p>

    <HelpBlocks :blocks="props.topic.blocks" :level="3" />

    <section v-if="related.length > 0" :aria-labelledby="relatedId" class="space-y-3">
      <h3 :id="relatedId" class="section-title">Pour aller plus loin</h3>
      <ul role="list" class="space-y-1">
        <li v-for="link in related" :key="link.key">
          <RouterLink
            v-if="link.to !== null"
            :to="link.to"
            class="text-link inline-flex min-h-11 max-w-full items-center gap-2 font-medium"
          >
            <AppIcon name="arrow-right" :size="16" class="text-gold" />
            <span class="min-w-0 break-words">{{ link.label }}</span>
          </RouterLink>
          <span v-else class="inline-flex min-h-11 max-w-full items-center gap-2 font-medium">
            <AppIcon name="arrow-right" :size="16" class="text-gold" />
            <span class="min-w-0 break-words">{{ link.label }}</span>
            <span v-if="link.server" class="text-muted">(demande le serveur)</span>
          </span>
          <p v-if="link.why" class="-mt-1 pl-6 break-words text-muted">
            <HelpText :text="link.why" />
          </p>
        </li>
      </ul>
    </section>

    <nav
      v-if="props.previous !== undefined || props.next !== undefined"
      :aria-label="`Autres rubriques de la partie ${props.part.title}`"
      class="grid gap-3 sm:grid-cols-2 print:hidden"
    >
      <RouterLink
        v-if="props.previous !== undefined"
        :to="topicTo(props.previous.id)"
        class="card card-link min-w-0 p-4"
      >
        <span class="flex items-center gap-1.5 text-sm font-medium text-muted">
          <AppIcon name="arrow-left" :size="16" class="text-gold" />
          Précédente<span class="sr-only"> : </span>
        </span>
        <span class="font-semibold break-words">{{ props.previous.title }}</span>
      </RouterLink>
      <RouterLink
        v-if="props.next !== undefined"
        :to="topicTo(props.next.id)"
        class="card card-link min-w-0 p-4 sm:col-start-2 sm:items-end sm:text-right"
      >
        <span class="flex items-center gap-1.5 text-sm font-medium text-muted">
          Suivante<span class="sr-only"> : </span>
          <AppIcon name="arrow-right" :size="16" class="text-gold" />
        </span>
        <span class="font-semibold break-words">{{ props.next.title }}</span>
      </RouterLink>
    </nav>
  </article>
</template>
