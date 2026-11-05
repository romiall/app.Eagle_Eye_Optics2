<script setup lang="ts">
/**
 * Fiche d'aide d'un écran (docs/implementation/help.md) : ce que le personnel lit, sans formation, quand il
 * ouvre l'aide d'un écran, et ce que la « Référence des écrans » de la documentation affiche pour chaque
 * écran. Une fiche n'est écrite qu'une fois et ce composant la présente toujours de la même façon, dans le
 * même ordre : « Vous êtes ici », « Ce que vous pouvez faire ici », « Pas à pas », « Comment ça marche »,
 * « Ensuite », « À savoir », « Si ça ne marche pas », « Mots utiles ». Une rubrique vide n'est pas affichée.
 *
 * Seul ce que CE compte peut faire est montré : une action ou une tâche réservée à d'autres droits
 * (`anyPermission`) reste cachée, et une ligne discrète le dit sans rien en révéler. Les droits servent
 * ici à choisir ce que l'on décrit, jamais à autoriser quoi que ce soit : le serveur revérifie chaque
 * action. L'écran, lui, est déjà choisi par l'appelant.
 *
 * Les tâches sont des `details` natifs, fermés sauf la première (`expandFirstTask`) : on voit d'un coup
 * d'œil ce que l'écran permet et l'on ouvre ce dont on a besoin. Les libellés d'écran cités deviennent des
 * puces (`HelpText`). Les liens « Ensuite » et « Mots utiles » sont de vrais liens internes ; un clic
 * simple émet `navigate` pour que l'hôte (le panneau) se referme, un clic avec une touche modificatrice
 * (nouvel onglet) ne le fait pas. Un lien vers une route inconnue du routeur est écrit en texte simple au
 * lieu de faire échouer toute la fiche.
 *
 * Mise en page : aucune largeur d'écran n'est supposée, la fiche s'adapte à SA largeur (requête de
 * conteneur) car elle vit tantôt dans un panneau étroit, tantôt dans une page large ; empilée dans un
 * cadre étroit (360 px sans défilement horizontal), « libellé | effet » en deux colonnes quand elle a la
 * place. Cibles de 44 px, textes de 16 px, jamais la couleur seule, mouvement réduit respecté (base.css).
 */
import { computed, inject, useId } from 'vue'
import { RouterLink, routerKey, type RouteLocationRaw, type Router } from 'vue-router'

import HelpBlocks from '@/components/help/HelpBlocks.vue'
import HelpText from '@/components/help/HelpText.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { HelpBlock, HelpRef, HelpTask, PageHelp } from '@/domain/help/model'
import { actionsFor, hashFor, hiddenCount, tasksFor } from '@/domain/help/rules'
import { normalizeText } from '@/domain/help/search'

const props = withDefaults(
  defineProps<{
    help: PageHelp
    /** Droits du compte (codes de la table `permissions`) : ils choisissent ce que la fiche décrit. */
    permissions: readonly string[]
    /** Niveau des titres de rubrique : 2 quand la fiche est le contenu de la page, 3 sous le titre d'un panneau. */
    level?: 2 | 3 | undefined
    /** La première tâche s'ouvre d'elle-même ; les autres restent fermées. */
    expandFirstTask?: boolean | undefined
    /**
     * État d'un écran cité dans « Ensuite » pour CE compte (voir `useHelpLinkState`) : `open` (lien),
     * `server` (écran fermé tant que le serveur ne répond pas : texte et mention « demande le serveur »),
     * `hidden` (module fermé ou droit absent : le lien n'est pas montré). Absent : tous les liens sont ouverts.
     */
    linkState?: ((route: string) => 'open' | 'hidden' | 'server') | undefined
  }>(),
  { level: 3, expandFirstTask: true, linkState: undefined },
)

const emit = defineEmits<{ navigate: [] }>()

/** Routeur de l'application (absent d'un test sans routeur : les liens s'écrivent alors en texte). */
const router = inject<Router | null>(routerKey, null)
const uid = useId()
const headingTag = computed(() => (props.level === 2 ? 'h2' : 'h3'))

const actions = computed(() => actionsFor(props.help, props.permissions))
const tasks = computed(() => tasksFor(props.help, props.permissions))
const hidden = computed(() => hiddenCount(props.help, props.permissions))
const rulesBlocks = computed<HelpBlock[]>(() => [{ kind: 'points', items: props.help.rules }])
const tips = computed(() => props.help.tips ?? [])
const tipsBlocks = computed<HelpBlock[]>(() => [{ kind: 'points', items: tips.value }])
const problems = computed(() => props.help.problems ?? [])
const terms = computed(() => props.help.terms ?? [])

/** Annonce de l'écran codé mais pas encore ouvert à la cliente : en tête, elle ne promet rien. */
const VALIDATION_NOTICE: readonly HelpBlock[] = [
  {
    kind: 'note',
    tone: 'warning',
    text: 'Cette fonction est en cours de validation : elle n’est pas encore ouverte au cabinet.',
  },
]

function sectionId(name: string): string {
  return `${uid}-${name}`
}

/** Libellé d'une action tel qu'il s'écrit à l'écran, entre guillemets : `HelpText` en fait une puce. */
function quoted(label: string): string {
  return `« ${label} »`
}

function stepsOf(task: HelpTask): HelpBlock[] {
  return [{ kind: 'steps', items: task.steps }]
}

/** Écran (nom de route) ou rubrique de la documentation (écran « Documentation », ancre `#/rubrique`). */
function targetOf(link: HelpRef): RouteLocationRaw {
  return 'topic' in link
    ? { name: 'aide', hash: hashFor({ kind: 'topic', id: link.topic }) }
    : { name: link.route }
}

function isLinkable(link: HelpRef): boolean {
  if (router === null) return false
  return router.hasRoute('topic' in link ? 'aide' : link.route)
}

/** Une rubrique de la documentation est toujours accessible ; un écran dépend de l'état fourni par l'hôte. */
function stateOf(link: HelpRef): 'open' | 'hidden' | 'server' {
  if ('topic' in link || props.linkState === undefined) return 'open'
  return props.linkState(link.route)
}

/** Les écrans que ce compte ne peut pas ouvrir ne sont pas montrés : la fiche n'est jamais plus bavarde que l'écran. */
const nextLinks = computed(() => props.help.next.filter((link) => stateOf(link) !== 'hidden'))

/**
 * Mots d'optique du glossaire « optique » ; tout autre mot est défini dans le glossaire « gestion ».
 * Comparés sans accent ni casse, comme la recherche.
 */
const OPTICAL_TERMS: ReadonlySet<string> = new Set(
  [
    'OD',
    'OG',
    'OU',
    'Acuité visuelle',
    'Autoréfracteur',
    'Réfraction subjective',
    'Sphère',
    'Cylindre',
    'Axe',
    'Addition',
    'Écart pupillaire',
    'Dioptrie',
    'Prescription optique',
    'Ordonnance de médicaments',
    'Ordonnance externe',
    'Orientation',
    'Contrôle recommandé',
    'Monture',
    'Verres',
    'Collyre',
  ].map(normalizeText),
)

const glossaryReachable = computed(() => router !== null && router.hasRoute('aide'))

function glossaryTarget(term: string): RouteLocationRaw {
  const id = OPTICAL_TERMS.has(normalizeText(term)) ? 'glossaire-optique' : 'glossaire-gestion'
  return { name: 'aide', hash: hashFor({ kind: 'topic', id }) }
}

/** Un clic simple sur un lien interne ferme l'hôte ; ouvrir dans un autre onglet le laisse en place. */
function onLinkClick(event: MouseEvent): void {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
  emit('navigate')
}
</script>

<template>
  <div class="@container min-w-0 space-y-5">
    <HelpBlocks v-if="props.help.maturity === 'validation'" :blocks="VALIDATION_NOTICE" />

    <div class="divide-y divide-line">
      <section
        v-if="props.help.purpose !== ''"
        :aria-labelledby="sectionId('ici')"
        class="space-y-3 py-5 first:pt-0 last:pb-0"
      >
        <component :is="headingTag" :id="sectionId('ici')" class="section-title">
          Vous êtes ici
        </component>
        <p class="max-w-prose break-words"><HelpText :text="props.help.purpose" /></p>
      </section>

      <section
        v-if="actions.length > 0"
        :aria-labelledby="sectionId('faire')"
        class="space-y-3 py-5 first:pt-0 last:pb-0"
      >
        <component :is="headingTag" :id="sectionId('faire')" class="section-title">
          Ce que vous pouvez faire ici
        </component>
        <dl class="space-y-4">
          <div
            v-for="(action, index) in actions"
            :key="`${index}-${action.label}`"
            class="grid gap-1 @lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] @lg:gap-x-4"
          >
            <dt class="min-w-0 break-words"><HelpText :text="quoted(action.label)" /></dt>
            <dd class="min-w-0 break-words"><HelpText :text="action.effect" /></dd>
          </div>
        </dl>
      </section>

      <section
        v-if="tasks.length > 0"
        :aria-labelledby="sectionId('pas')"
        class="space-y-3 py-5 first:pt-0 last:pb-0"
      >
        <component :is="headingTag" :id="sectionId('pas')" class="section-title">
          Pas à pas
        </component>
        <div class="space-y-3">
          <details
            v-for="(task, index) in tasks"
            :key="`${props.help.route}:${task.id}`"
            :open="props.expandFirstTask && index === 0"
            class="group rounded-xl border border-line bg-canvas"
          >
            <summary
              class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-base font-semibold hover:bg-primary-soft"
            >
              <span class="min-w-0 break-words"><HelpText :text="task.title" /></span>
              <AppIcon
                name="chevron-down"
                :size="20"
                class="text-muted transition-transform group-open:rotate-180"
              />
            </summary>
            <div class="space-y-4 border-t border-line p-4">
              <HelpBlocks :blocks="stepsOf(task)" />
              <p
                v-if="task.result !== undefined && task.result !== ''"
                class="flex items-start gap-2 rounded-lg bg-accent-soft p-3 text-ink"
              >
                <AppIcon name="check-circle" :size="18" class="mt-1 text-accent" />
                <span class="min-w-0 break-words"
                  ><span class="font-semibold">Résultat :</span> <HelpText :text="task.result"
                /></span>
              </p>
            </div>
          </details>
        </div>
      </section>

      <section
        v-if="props.help.rules.length > 0"
        :aria-labelledby="sectionId('regles')"
        class="space-y-3 py-5 first:pt-0 last:pb-0"
      >
        <component :is="headingTag" :id="sectionId('regles')" class="section-title">
          Comment ça marche
        </component>
        <HelpBlocks :blocks="rulesBlocks" />
      </section>

      <section
        v-if="nextLinks.length > 0"
        :aria-labelledby="sectionId('ensuite')"
        class="space-y-3 py-5 first:pt-0 last:pb-0"
      >
        <component :is="headingTag" :id="sectionId('ensuite')" class="section-title">
          Ensuite
        </component>
        <ul role="list" class="space-y-1">
          <li v-for="(link, index) in nextLinks" :key="`${index}-${link.label}`">
            <RouterLink
              v-if="stateOf(link) === 'open' && isLinkable(link)"
              :to="targetOf(link)"
              class="text-link inline-flex min-h-11 max-w-full items-center gap-2 font-medium"
              @click="onLinkClick"
            >
              <AppIcon name="arrow-right" :size="16" class="text-gold" />
              <span class="min-w-0 break-words">{{ link.label }}</span>
            </RouterLink>
            <span v-else class="inline-flex min-h-11 max-w-full items-center gap-2 font-medium">
              <AppIcon name="arrow-right" :size="16" class="text-gold" />
              <span class="min-w-0 break-words">{{ link.label }}</span>
              <span v-if="stateOf(link) === 'server'" class="text-muted">(demande le serveur)</span>
            </span>
            <p v-if="link.why" class="-mt-1 pl-6 break-words text-muted">
              <HelpText :text="link.why" />
            </p>
          </li>
        </ul>
      </section>

      <section
        v-if="tips.length > 0"
        :aria-labelledby="sectionId('savoir')"
        class="space-y-3 py-5 first:pt-0 last:pb-0"
      >
        <component :is="headingTag" :id="sectionId('savoir')" class="section-title">
          À savoir
        </component>
        <HelpBlocks :blocks="tipsBlocks" />
      </section>

      <section
        v-if="problems.length > 0"
        :aria-labelledby="sectionId('probleme')"
        class="space-y-3 py-5 first:pt-0 last:pb-0"
      >
        <component :is="headingTag" :id="sectionId('probleme')" class="section-title">
          Si ça ne marche pas
        </component>
        <ul role="list" class="space-y-3">
          <li
            v-for="(problem, index) in problems"
            :key="index"
            class="flex items-start gap-3 rounded-xl border border-l-4 border-line border-l-warning bg-canvas p-3"
          >
            <AppIcon name="alert" :size="18" class="mt-1 text-warning" />
            <div class="min-w-0 space-y-1 break-words">
              <p class="font-semibold"><HelpText :text="problem.symptom" /></p>
              <p><HelpText :text="problem.remedy" /></p>
            </div>
          </li>
        </ul>
      </section>

      <section
        v-if="terms.length > 0"
        :aria-labelledby="sectionId('mots')"
        class="space-y-3 py-5 first:pt-0 last:pb-0"
      >
        <component :is="headingTag" :id="sectionId('mots')" class="section-title">
          Mots utiles
        </component>
        <ul role="list" class="flex flex-wrap gap-2">
          <li v-for="(term, index) in terms" :key="`${index}-${term}`" class="min-w-0 max-w-full">
            <RouterLink
              v-if="glossaryReachable"
              :to="glossaryTarget(term)"
              :aria-label="`${term} : voir la définition dans le glossaire`"
              class="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-field bg-surface px-3 font-medium text-primary hover:border-primary hover:bg-primary-soft"
              @click="onLinkClick"
            >
              <AppIcon name="tag" :size="16" class="text-gold" />
              <span class="min-w-0 break-words">{{ term }}</span>
            </RouterLink>
            <span
              v-else
              class="inline-flex min-h-11 max-w-full items-center gap-1.5 px-3 font-medium break-words"
              >{{ term }}</span
            >
          </li>
        </ul>
      </section>
    </div>

    <p v-if="hidden > 0" class="flex items-start gap-2 text-muted">
      <AppIcon name="lock" :size="16" class="mt-1" />
      <span>Des actions réservées à d’autres profils ne sont pas affichées.</span>
    </p>
  </div>
</template>
