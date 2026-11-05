<script setup lang="ts">
/**
 * Écran « Documentation » (`/aide`) : toute la documentation d'utilisation, à lire sans formation. Il
 * n'appelle aucun serveur (offlineCapable) : le contenu (rubriques et fiches d'écran, plusieurs centaines de
 * Ko de texte) est chargé à la demande par `loadHandbook` et `loadPageHelp`, puis lu selon l'adresse :
 *
 * - `?q=mot` : les résultats de la recherche (rubriques et fiches visibles, sans accent ni casse) ;
 * - `#/rubrique` : une rubrique (parcours, notion, glossaire…), `HelpTopic` ;
 * - `#/ecran/nom-de-route` : la fiche d'un écran, la même que celle du panneau « Aide » de l'en-tête ;
 * - sinon l'accueil, `HelpHome`.
 *
 * Le panneau d'aide d'un écran, lui, reste fermé tant qu'on ne le demande pas : cet écran n'ajoute ni bandeau,
 * ni pastille, ni stockage navigateur.
 *
 * QUI LIT. Comme le menu, la documentation ne montre que les rubriques et les fiches du compte (un des droits ET
 * le module ouvert). Un compte qui gère le personnel (`users.manage`) peut « Lire l’aide comme » un profil du
 * cabinet et inclure les modules fermés, pour vérifier ce que verra chaque membre de l'équipe : seule la
 * LECTURE change, jamais un droit (le serveur revérifie chaque action). Les liens vers les écrans suivent le
 * même lecteur (`resolveLinkState`) ; une session locale (poste préparé, serveur arrêté) ne propose que les
 * écrans du poste.
 *
 * MISE EN PAGE. Sur téléphone et tablette : la recherche, puis le « Sommaire » repliable (choix du profil et
 * liens), puis le contenu. Dès 80 rem (écran d'ordinateur) : deux colonnes, le sommaire reste ouvert dans une
 * colonne de 18 rem collée au défilement. Le « Sommaire » est un seul `details` : il est forcé ouvert dans les
 * grands écrans (`matchMedia`, comme la requête CSS `xl`) et se referme après chaque navigation dans les
 * petits. À l'impression : seule la page de lecture reste (recherche, sommaire et boutons sont cachés) et les
 * blocs repliés (tâches, questions fréquentes) sont dépliés le temps de l'impression.
 *
 * FOCUS. À chaque changement de lieu, le titre du contenu (`h2` tabindex -1) reçoit le focus et défile en vue,
 * une fois le contenu chargé ; à l'ouverture, seulement quand l'adresse désigne déjà une rubrique, un écran ou
 * une recherche (lien profond). Règles pures : `documentation.ts`.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { can, currentPermissions, enabledModules, session } from '@/app/session'
import StateMessage from '@/components/feedback/StateMessage.vue'
import CheckboxField from '@/components/form/CheckboxField.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextField from '@/components/form/TextField.vue'
import HelpText from '@/components/help/HelpText.vue'
import PageHelpView from '@/components/help/PageHelpView.vue'
import { resolveLinkState, type HelpLinkState } from '@/components/help/useHelpLinks'
import PageHeader from '@/components/layout/PageHeader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import { loadHandbook, loadPageHelp } from '@/domain/help/loader'
import type { HandbookPart, HandbookTopic, PageHelp } from '@/domain/help/model'
import { PROFILES } from '@/domain/help/profiles'
import { hashFor, parseHash } from '@/domain/help/rules'
import {
  buildIndex,
  queryWords,
  SCREENS_GROUP,
  searchIndex,
  type SearchHit,
} from '@/domain/help/search'

import {
  findTopic,
  neighbours,
  queryText,
  readerFor,
  RESULT_LIMIT,
  resultsTitle,
  screenGroups,
  startCards,
  visibleParts,
  visiblePages,
  type DocPlace,
  type Reader,
} from './documentation'
import HelpHome from './HelpHome.vue'
import HelpNavigation from './HelpNavigation.vue'
import HelpTopic from './HelpTopic.vue'

const route = useRoute()
const router = useRouter()
const uid = useId()

/** Titre du contenu (`h2`) : il reçoit le focus à chaque changement de lieu, sans contour. */
const TITLE_CLASS =
  'scroll-mt-6 text-2xl font-semibold tracking-tight break-words focus:outline-none'

// --- Le contenu, chargé à la demande ---------------------------------------------------------------

type LoadState = 'loading' | 'ready' | 'failed'

const loadState = ref<LoadState>('loading')
const parts = shallowRef<readonly HandbookPart[]>([])
const pages = shallowRef<readonly PageHelp[]>([])

async function load(): Promise<void> {
  loadState.value = 'loading'
  try {
    const [handbook, pageHelp] = await Promise.all([loadHandbook(), loadPageHelp()])
    parts.value = handbook.HANDBOOK_PARTS
    pages.value = pageHelp.PAGE_HELP
    loadState.value = 'ready'
  } catch {
    loadState.value = 'failed'
  }
}

void load()

// --- Qui lit ---------------------------------------------------------------------------------------

/** Seule la gérante (gestion du personnel) lit l'aide comme un autre profil : outil de mise en service. */
const canChoose = computed(() => can('users.manage'))
const profileChoice = ref<string | null>(null)
const includeClosed = ref(false)

const PROFILE_OPTIONS = PROFILES.map((profile) => ({ value: profile.code, label: profile.label }))

const simulated = computed(() =>
  canChoose.value ? PROFILES.find((profile) => profile.code === profileChoice.value) : undefined,
)

const reader = computed<Reader>(() =>
  readerFor(simulated.value?.code ?? null, canChoose.value && includeClosed.value, {
    permissions: currentPermissions.value,
    modules: enabledModules.value,
  }),
)

/** Rappel, au-dessus du contenu, quand la lecture n'est pas celle du compte connecté. */
const simulationNote = computed<string | null>(() => {
  const closed = canChoose.value && includeClosed.value
  if (simulated.value !== undefined) {
    const as = `Vous lisez la documentation comme le profil « ${simulated.value.label} »`
    return closed ? `${as}, modules fermés inclus.` : `${as}.`
  }
  return closed ? 'Vous lisez la documentation de votre compte, modules fermés inclus.' : null
})

/** Profils du lecteur (pour mettre son guide en premier) : le profil simulé, sinon ceux du compte. */
const readerRoles = computed<readonly string[]>(() =>
  simulated.value !== undefined ? [simulated.value.code] : (session.account?.roles ?? []),
)

/** Ce que ce lecteur peut lire : les parties (rubriques visibles) et les fiches d'écran visibles. */
const shownParts = computed(() => visibleParts(parts.value, reader.value))
const shownPages = computed(() => visiblePages(pages.value, reader.value))
const groups = computed(() => screenGroups(shownPages.value))
const cards = computed(() => startCards(shownParts.value, readerRoles.value))

/** État d'un écran cité, pour CE lecteur : `open` (lien), `server` (texte, « demande le serveur »), `hidden`. */
function linkState(routeName: string): HelpLinkState {
  return resolveLinkState(router, routeName, {
    permissions: reader.value.permissions,
    modules: reader.value.modules,
    local: session.status === 'local',
  })
}

function canOpenTopic(id: string): boolean {
  return findTopic(shownParts.value, id) !== undefined
}

function canOpenScreen(routeName: string): boolean {
  return linkState(routeName) === 'open'
}

// --- Où l'on est : recherche, rubrique, écran ou accueil -----------------------------------------

const rawQuery = computed(() => queryText(route.query['q']))
const query = computed(() => rawQuery.value.trim())

const place = computed<DocPlace>(() =>
  query.value === '' ? parseHash(route.hash) : { kind: 'search' },
)

/** Texte du champ de recherche : celui du paramètre `q` de l'adresse, qui reste la référence. */
const text = ref(rawQuery.value)
watch(rawQuery, (value) => {
  text.value = value
})

async function search(): Promise<void> {
  const term = text.value.trim().replace(/\s+/g, ' ')
  if (term === '') {
    if (query.value !== '') await router.push({ name: 'aide' })
    return
  }
  await router.push({ name: 'aide', query: { q: term } })
}

/** Index de recherche, construit seulement quand on cherche. */
const index = computed(() => buildIndex(shownParts.value, shownPages.value))
const hits = computed<readonly SearchHit[]>(() =>
  query.value === '' ? [] : searchIndex(index.value, query.value, RESULT_LIMIT),
)
const hasWords = computed(() => queryWords(query.value).length > 0)

type View =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'home' }
  | { readonly kind: 'results'; readonly hits: readonly SearchHit[] }
  | {
      readonly kind: 'topic'
      readonly part: HandbookPart
      readonly topic: HandbookTopic
      readonly previous: HandbookTopic | undefined
      readonly next: HandbookTopic | undefined
    }
  | { readonly kind: 'screen'; readonly page: PageHelp }
  | { readonly kind: 'missing'; readonly what: 'topic' | 'screen' }

const view = computed<View>(() => {
  if (loadState.value === 'loading') return { kind: 'loading' }
  if (loadState.value === 'failed') return { kind: 'failed' }
  const here = place.value
  if (here.kind === 'search') return { kind: 'results', hits: hits.value }
  if (here.kind === 'home') return { kind: 'home' }
  if (here.kind === 'topic') {
    const found = findTopic(shownParts.value, here.id)
    if (found === undefined) return { kind: 'missing', what: 'topic' }
    return { kind: 'topic', ...found, ...neighbours(found.part, found.topic.id) }
  }
  const page = shownPages.value.find((candidate) => candidate.route === here.route)
  return page === undefined ? { kind: 'missing', what: 'screen' } : { kind: 'screen', page }
})

function resultTo(hit: SearchHit): { name: string; hash: string } {
  return {
    name: 'aide',
    hash:
      hit.entry.kind === 'topic'
        ? hashFor({ kind: 'topic', id: hit.entry.id })
        : hashFor({ kind: 'screen', route: hit.entry.id }),
  }
}

// --- Sommaire repliable (téléphone, tablette) et deux colonnes (ordinateur) ----------------------

/** Même seuil que la variante Tailwind `xl` (80 rem) : le CSS et ce test ne se contredisent jamais. */
const media =
  typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 80rem)') : null
const wide = ref(media?.matches ?? false)
const menu = ref<HTMLDetailsElement | null>(null)

function onMediaChange(event: MediaQueryListEvent): void {
  wide.value = event.matches
}

// --- Focus du titre à chaque changement de lieu -----------------------------------------------

const content = ref<HTMLElement | null>(null)
let revealPending = false
let revealTimer: number | undefined

/** Le titre du contenu reçoit le focus puis défile en vue (le routeur a déjà remonté la page). */
function revealTitle(): void {
  revealTimer = undefined
  const title = content.value?.querySelector<HTMLElement>('h2[tabindex="-1"]')
  if (title === null || title === undefined) return
  title.focus({ preventScroll: true })
  if (typeof title.scrollIntoView === 'function') title.scrollIntoView({ block: 'start' })
}

/**
 * Programme le focus quand le contenu est affiché. Après le rendu, puis au tour suivant : le routeur remonte la
 * page juste après la navigation, et ce défilement ne doit pas défaire celui du titre.
 */
function scheduleReveal(): void {
  if (!revealPending || loadState.value !== 'ready') return
  revealPending = false
  void nextTick(() => {
    window.clearTimeout(revealTimer)
    revealTimer = window.setTimeout(revealTitle, 0)
  })
}

watch(
  () => route.fullPath,
  () => {
    if (route.name !== 'aide') return
    if (!wide.value && menu.value !== null) menu.value.open = false
    revealPending = true
    scheduleReveal()
  },
)

watch(loadState, scheduleReveal)

// --- Impression ------------------------------------------------------------------------------------

/** Blocs repliés que l'impression a dépliés, à replier ensuite (aussi pour Ctrl+P, sans le bouton). */
const unfolded: HTMLDetailsElement[] = []

function unfoldForPrint(): void {
  content.value?.querySelectorAll<HTMLDetailsElement>('details:not([open])').forEach((details) => {
    details.open = true
    unfolded.push(details)
  })
}

function foldAfterPrint(): void {
  for (const details of unfolded.splice(0)) details.open = false
}

function printPage(): void {
  window.print()
}

onMounted(() => {
  media?.addEventListener('change', onMediaChange)
  window.addEventListener('beforeprint', unfoldForPrint)
  window.addEventListener('afterprint', foldAfterPrint)
  // Lien profond (rubrique, écran, recherche) : le titre est mis en vue dès que le contenu est chargé.
  if (place.value.kind !== 'home') {
    revealPending = true
    scheduleReveal()
  }
})

onBeforeUnmount(() => {
  media?.removeEventListener('change', onMediaChange)
  window.removeEventListener('beforeprint', unfoldForPrint)
  window.removeEventListener('afterprint', foldAfterPrint)
  window.clearTimeout(revealTimer)
})
</script>

<template>
  <section aria-labelledby="titre-aide" class="page-stack max-w-6xl print:max-w-none">
    <PageHeader
      title-id="titre-aide"
      title="Aide et documentation"
      icon="help"
      subtitle="Comment utiliser l’application, métier par métier et écran par écran."
    >
      <template #actions>
        <AppButton variant="secondary" class="print:hidden" @click="printPage">
          <AppIcon name="printer" :size="18" />Imprimer cette page
        </AppButton>
      </template>
    </PageHeader>

    <div
      class="flex flex-col gap-6 xl:grid xl:grid-cols-[18rem_minmax(0,1fr)] xl:items-start xl:gap-8 print:block"
    >
      <aside
        aria-label="Recherche et sommaire"
        class="min-w-0 space-y-4 xl:sticky xl:top-6 xl:-m-1.5 xl:max-h-[calc(100vh_-_3rem)] xl:overflow-y-auto xl:p-1.5 print:hidden"
      >
        <form
          role="search"
          aria-label="Chercher dans la documentation"
          class="card p-4"
          novalidate
          @submit.prevent="search"
        >
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start xl:flex-col">
            <div class="min-w-0 sm:flex-1 xl:flex-none">
              <TextField
                v-model="text"
                label="Chercher dans la documentation"
                type="search"
                inputmode="search"
                icon="search"
                hint="Un ou deux mots : un écran, un bouton, un terme."
                control-id="aide-recherche"
              />
            </div>
            <AppButton type="submit" variant="secondary" class="field-action xl:mt-0">
              Chercher
            </AppButton>
          </div>
        </form>

        <details ref="menu" class="group card" :open="wide">
          <summary
            class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-base font-semibold hover:bg-primary-soft xl:hidden"
          >
            <span class="flex items-center gap-2">
              <AppIcon name="list" :size="18" class="text-gold" />
              Sommaire
            </span>
            <AppIcon
              name="chevron-down"
              :size="20"
              class="text-muted transition-transform group-open:rotate-180"
            />
          </summary>
          <div class="space-y-4 px-4 pt-1 pb-4 xl:p-4">
            <div v-if="canChoose" class="space-y-3 border-b border-line pb-4">
              <SelectField
                v-model="profileChoice"
                label="Lire l’aide comme"
                placeholder="Mon compte"
                :options="PROFILE_OPTIONS"
                hint="Pour vérifier ce que verra chaque membre de l’équipe."
                control-id="aide-lecteur"
              />
              <CheckboxField
                v-model="includeClosed"
                label="Inclure les modules fermés"
                hint="Montre aussi ce qui n’est pas encore ouvert dans l’application."
                control-id="aide-modules-fermes"
              />
            </div>
            <HelpNavigation :parts="shownParts" :groups="groups" :place="place" />
          </div>
        </details>
      </aside>

      <div ref="content" class="@container min-w-0 space-y-6">
        <p
          v-if="simulationNote !== null && view.kind !== 'loading' && view.kind !== 'failed'"
          class="flex items-start gap-2 rounded-xl border border-line bg-primary-soft p-3 text-ink print:hidden"
        >
          <AppIcon name="eye" :size="18" class="mt-1 text-primary" />
          <span class="min-w-0 break-words">{{ simulationNote }}</span>
        </p>

        <div v-if="view.kind === 'loading'" aria-live="polite">
          <StateMessage state="loading" title="Chargement de la documentation…" />
        </div>

        <StateMessage
          v-else-if="view.kind === 'failed'"
          state="error"
          title="La documentation n’a pas pu s’ouvrir."
        >
          Vérifiez la connexion, puis réessayez. Si le problème continue, rechargez la page.
          <template #action>
            <AppButton variant="secondary" @click="load">Réessayer</AppButton>
          </template>
        </StateMessage>

        <HelpHome
          v-else-if="view.kind === 'home'"
          :cards="cards"
          :parts="shownParts"
          :groups="groups"
        />

        <section
          v-else-if="view.kind === 'results'"
          :aria-labelledby="`${uid}-resultats`"
          class="space-y-4"
        >
          <template v-if="view.hits.length > 0">
            <h2 :id="`${uid}-resultats`" tabindex="-1" :class="TITLE_CLASS">
              {{ resultsTitle(view.hits.length) }} pour « {{ query }} »
            </h2>
            <ul role="list" class="space-y-3">
              <li
                v-for="hit in view.hits"
                :key="`${hit.entry.kind}:${hit.entry.id}`"
                class="card min-w-0 space-y-1 p-4"
              >
                <p class="text-sm font-medium break-words text-muted">{{ hit.entry.group }}</p>
                <RouterLink
                  :to="resultTo(hit)"
                  class="text-link block text-base font-semibold break-words"
                >
                  {{ hit.entry.title }}
                </RouterLink>
                <p v-if="hit.snippet !== ''" class="break-words text-ink">
                  <HelpText :text="hit.snippet" />
                </p>
              </li>
            </ul>
          </template>
          <template v-else>
            <h2 :id="`${uid}-resultats`" tabindex="-1" :class="TITLE_CLASS">Aucun résultat</h2>
            <p v-if="hasWords" class="max-w-prose text-base break-words">
              Aucune rubrique ni fiche d’écran ne contient tous les mots de « {{ query }} ». Essayez
              avec moins de mots, avec un seul mot, ou avec le nom d’un écran ou d’un bouton.
            </p>
            <p v-else class="max-w-prose text-base">
              Un mot compte au moins deux lettres. Saisissez le nom d’un écran, d’un bouton ou d’un
              terme.
            </p>
            <p>
              <LinkButton :to="{ name: 'aide' }" variant="secondary">
                <AppIcon name="home" :size="18" />Revenir à l’accueil de la documentation
              </LinkButton>
            </p>
          </template>
        </section>

        <HelpTopic
          v-else-if="view.kind === 'topic'"
          :part="view.part"
          :topic="view.topic"
          :previous="view.previous"
          :next="view.next"
          :link-state="linkState"
          :can-open-topic="canOpenTopic"
        />

        <section
          v-else-if="view.kind === 'screen'"
          :aria-labelledby="`${uid}-ecran`"
          class="min-w-0 space-y-5"
        >
          <header class="space-y-3">
            <p class="text-sm font-semibold tracking-wide text-gold-ink uppercase">
              {{ SCREENS_GROUP }}
            </p>
            <h2 :id="`${uid}-ecran`" tabindex="-1" :class="TITLE_CLASS">{{ view.page.title }}</h2>
            <p v-if="canOpenScreen(view.page.route)" class="print:hidden">
              <LinkButton :to="{ name: view.page.route }" variant="secondary">
                <AppIcon name="arrow-right" :size="18" />Ouvrir cet écran
              </LinkButton>
            </p>
          </header>
          <PageHelpView
            :help="view.page"
            :permissions="reader.permissions"
            :level="3"
            :link-state="linkState"
          />
        </section>

        <section v-else :aria-labelledby="`${uid}-absente`" class="space-y-3">
          <h2 :id="`${uid}-absente`" tabindex="-1" :class="TITLE_CLASS">
            {{ view.what === 'screen' ? 'Écran introuvable' : 'Rubrique introuvable' }}
          </h2>
          <p class="max-w-prose text-base">
            Cette rubrique n’existe pas ou n’est pas ouverte à votre compte.
          </p>
          <p>
            <LinkButton :to="{ name: 'aide' }" variant="secondary">
              <AppIcon name="home" :size="18" />Revenir à l’accueil de la documentation
            </LinkButton>
          </p>
        </section>
      </div>
    </div>

    <p class="print:hidden">
      <RouterLink to="/" class="text-link inline-flex min-h-11 items-center gap-2 font-medium">
        <AppIcon name="arrow-left" :size="18" />
        Revenir à l’accueil
      </RouterLink>
    </p>
  </section>
</template>
