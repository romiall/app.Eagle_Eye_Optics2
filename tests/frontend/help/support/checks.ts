import type { RouteRecordNormalized } from 'vue-router'

import type { HandbookTopic, HelpAccess, HelpBlock, HelpRef, PageHelp } from '@/domain/help/model'
import { normalizeText } from '@/domain/help/search'

import { normalizeLabel } from './sources'

/**
 * Contrôles du contenu de l'aide : fonctions pures qui reçoivent UNE fiche ou UNE rubrique et un
 * contexte (libellés de l'application, routes, droits, glossaire…) et rendent la liste des constats.
 * Le contrat sur le vrai contenu est dans `content-guards.test.ts` ; les mécanismes eux-mêmes sont
 * éprouvés sur du contenu d'exemple dans `content-checks.test.ts`.
 *
 * Deux niveaux, comme le vérificateur de rédaction dont ce fichier est le port : `error` bloque,
 * `warning` demande une correction « si possible » (dépassement modéré d'une limite de longueur,
 * titre différent de celui de la route, typographie).
 */

export interface Problem {
  readonly level: 'error' | 'warning'
  /** Champ de l'entrée (`actions[2].effect`). */
  readonly field: string
  readonly message: string
  /** Texte fautif, tronqué. */
  readonly value?: string
}

export interface LabelLookup {
  has(label: string): boolean
  looselyHas(label: string): boolean
}

export interface RouteFacts {
  readonly name: string
  /** L'adresse porte un paramètre (identifiant) : aucun lien direct n'est possible. */
  readonly hasParams: boolean
  readonly isPublic: boolean
  /** Titre de l'onglet (`meta.title`). */
  readonly title: string | null
  readonly module: string | null
  /** `meta.permissions` (liste vide : toute personne connectée). */
  readonly permissions: readonly string[]
}

export interface CheckContext {
  readonly labels: LabelLookup
  /** Libellés admis sans exister dans le code (clé normalisée → raison). */
  readonly labelExceptions: ReadonlyMap<string, string>
  readonly routes: ReadonlyMap<string, RouteFacts>
  /** Rubriques qui existent (cibles des liens `topic`). */
  readonly topicIds: ReadonlySet<string>
  readonly permissionCodes: ReadonlySet<string>
  /** Termes définis par les rubriques du glossaire. */
  readonly glossaryTerms: ReadonlySet<string>
  readonly knownModules: ReadonlySet<string>
  readonly profileCodes: ReadonlySet<string>
}

/** Limites du guide de rédaction (docs/implementation/help.md). */
export const LIMITS = {
  purposeWords: 45,
  actions: 10,
  effectWords: 25,
  tasks: 3,
  invoiceTasks: 8,
  steps: 8,
  stepWords: 30,
  rules: 6,
  ruleWords: 35,
  next: 4,
  tips: 5,
  problems: 5,
  related: 6,
  summaryWords: 35,
  /** Au-delà de limite × tolérance, le dépassement bloque ; en deçà, il avertit. */
  tolerance: 1.5,
  /** Rubrique « longue » : deux écrans au plus (taille du JSON des blocs, tableaux et glossaires exceptés). */
  topicJsonLength: 6500,
} as const

export const INVOICE_ROUTE = 'facture'

/**
 * Statuts que l'application n'affirme jamais. Les participes seulement : « solde » (le reste d'une
 * facture) et « payer » sont des mots de l'application. Frontières de mots par Unicode : `\b` ne
 * voit pas « é » comme une lettre et laisserait passer « payé » en fin de mot.
 */
export const BANNED_WORDS =
  /(?<![\p{L}\p{N}])(?:payé|payée|payés|payées|soldé|soldée|soldés|soldées|gratuit|gratuite|gratuits|gratuites|gratuitement)(?![\p{L}\p{N}])|acquitt[ée]/iu

const UNFINISHED = /\bTODO\b|\bFIXME\b|\bXXX\b|\bTBD\b|\?{3,}|à compléter|a completer|lorem/i
const HTML_TAG = /<\/?[a-z][a-z0-9]*(?:\s[^>]*)?>/i
const TASK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const TOPIC_ID = TASK_ID
const MATURITIES: readonly string[] = ['available', 'validation']
const NOTE_TONES: readonly string[] = ['info', 'warning', 'tip']

function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

export function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

function excerpt(text: string, max = 110): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function around(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30)
  return `${start > 0 ? '…' : ''}${text.slice(start, index + length + 40)}`
}

// --- Promesses que l'application ne tient pas -----------------------------------------------

interface PromiseRule {
  readonly message: string
  /** Une fiche ou rubrique en maturité « validation » peut en parler (écran codé, pas encore ouvert). */
  readonly exemptWhenValidation: boolean
  /** Formules qui promettent à coup sûr, quelle que soit la phrase. */
  readonly unconditional: readonly RegExp[]
  /** Mentions qui promettent, sauf si la phrase les nie ou les reporte (voir REFUSAL). */
  readonly mentions: readonly RegExp[]
}

const OFFLINE_RULE: PromiseRule = {
  message:
    "promesse de travail sans Internet (ou « enregistré sur ce poste ») : réservée aux fiches en maturity 'validation' ; sinon dire que l’écran demande une connexion",
  exemptWhenValidation: true,
  unconditional: [/\bpas besoin d(?:e|')\s*(?:la |une |l')?(?:connexion|internet|reseau)\b/],
  mentions: [
    /\benregistre(?:e|s|es)? sur ce poste\b/,
    /\bsans (?:connexion|internet|reseau|wifi|wi-fi)\b/,
    /\bhors[ -]?ligne\b/,
    /\bmode (?:avion|deconnecte)\b/,
  ],
}

const MESSAGES_RULE: PromiseRule = {
  message:
    'promesse d’envoi automatique de messages (SMS, WhatsApp, rappels) : l’application n’en envoie aucun, ne pas le présenter comme disponible',
  exemptWhenValidation: false,
  unconditional: [],
  mentions: [
    /\b(?:sms|whatsapp)\b/,
    /\b(?:rappels?|messages?|notifications?|relances?) automatiques?\b/,
    /\benvoi\w* automatiques?\b/,
    /\bautomatiquement (?:un |des |le |les )?(?:sms|messages?|rappels?|notifications?)/,
  ],
}

/** Mots qui nient, reportent ou conditionnent : une mention accompagnée de l'un d'eux ne promet rien. */
const REFUSAL =
  /\b(?:pas|plus|jamais|aucun|aucune|rien|impossible|indisponible|ferme|fermee|fermes|fermees|validation|bientot|prevu|prevue|futur|futurs|venir|prochain|prochaine|prochains|prochaines|ulterieur|ulterieure|besoin|necessite|exige|requiert|demande|faut)\b/

export interface FoundPromise {
  readonly rule: PromiseRule
  readonly sentence: string
}

/** Promesses d'un texte. Les libellés « … » sont écartés : ils citent l'écran, ils ne promettent rien. */
export function findPromises(text: string): FoundPromise[] {
  const sentences = normalizeText(text.replace(/«[^»]*»/g, ' '))
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence !== '')
  const found: FoundPromise[] = []
  for (const sentence of sentences) {
    for (const rule of [OFFLINE_RULE, MESSAGES_RULE]) {
      const promised =
        rule.unconditional.some((pattern) => pattern.test(sentence)) ||
        (rule.mentions.some((pattern) => pattern.test(sentence)) && !REFUSAL.test(sentence))
      if (promised) found.push({ rule, sentence })
    }
  }
  return found
}

// --- Rapport d'une entrée -----------------------------------------------------------------

class Report {
  readonly problems: Problem[] = []
  /** Tous les textes lus, pour chercher les promesses une fois la maturité connue. */
  readonly texts: { field: string; text: string }[] = []
  readonly ctx: CheckContext

  constructor(ctx: CheckContext) {
    this.ctx = ctx
  }

  error(field: string, message: string, value?: string): void {
    this.add('error', field, message, value)
  }

  warning(field: string, message: string, value?: string): void {
    this.add('warning', field, message, value)
  }

  private add(
    level: Problem['level'],
    field: string,
    message: string,
    value: string | undefined,
  ): void {
    this.problems.push(
      value === undefined
        ? { level, field, message }
        : { level, field, message, value: excerpt(value) },
    )
  }

  /** Champ obligatoire : chaîne non vide. */
  filled(field: string, value: unknown): boolean {
    if (isFilled(value)) return true
    this.error(field, 'champ obligatoire absent ou vide')
    return false
  }

  /** Un libellé d'écran existe dans l'application (ou fait l'objet d'une exception déclarée). */
  label(field: string, label: string, what: string): void {
    const wanted = normalizeLabel(label)
      .replace(/(?:…|\.\.\.)$/, '')
      .trim()
    if (wanted === '' || this.ctx.labelExceptions.has(wanted) || this.ctx.labels.has(wanted)) return
    const hint = this.ctx.labels.looselyHas(wanted)
      ? 'une forme proche existe (casse ou accents différents) : recopier le libellé exact'
      : 'copier-coller depuis l’écran, ou déclarer l’exception dans LABEL_EXCEPTIONS avec sa raison'
    this.error(field, `${what} introuvable dans l’application (${hint})`, `« ${label.trim()} »`)
  }

  /** Contrôles communs à tout texte affiché : mots interdits, travail inachevé, guillemets, balises, libellés. */
  text(field: string, value: unknown, allowEmpty = false): void {
    if (typeof value !== 'string') {
      this.error(field, 'texte attendu', String(value))
      return
    }
    if (value.trim() === '') {
      if (!allowEmpty) this.error(field, 'texte vide')
      return
    }
    this.texts.push({ field, text: value })
    const text = value.normalize('NFC')
    const banned = BANNED_WORDS.exec(text)
    if (banned !== null) {
      this.error(
        field,
        `mot interdit « ${banned[0]} » (payé, soldé, acquitté, gratuit) : dire « encaissé », « reste à encaisser », « émise »`,
        around(text, banned.index, banned[0].length),
      )
    }
    const unfinished = UNFINISHED.exec(text)
    if (unfinished !== null) {
      this.error(
        field,
        'marque de travail inachevé',
        around(text, unfinished.index, unfinished[0].length),
      )
    }
    if (HTML_TAG.test(text)) {
      this.error(field, 'balise HTML : le texte est affiché tel quel, sans mise en forme', text)
    }
    const opening = (text.match(/«/g) ?? []).length
    const closing = (text.match(/»/g) ?? []).length
    if (opening !== closing || /«[^»]*«/.test(text)) {
      this.error(field, 'guillemets français « » non appariés ou imbriqués', text)
    } else if (/«(?!\s)|(?<!\s)»/.test(text)) {
      this.warning(field, 'guillemets français sans espace (écrire « libellé »)', text)
    }
    for (const match of text.matchAll(/«\s*([^»]+?)\s*»/g)) {
      this.label(field, match[1] ?? '', 'libellé cité')
    }
  }

  /** Longueur en mots : avertissement au-dessus de la limite, erreur au-delà de la tolérance. */
  limit(field: string, value: string, max: number, what: string): void {
    if (typeof value !== 'string') return // déjà signalé par `text`
    const count = countWords(value)
    if (count > max * LIMITS.tolerance) {
      this.error(field, `${what} trop long (${count} mots, limite ${max})`, value)
    } else if (count > max) {
      this.warning(field, `${what} un peu long (${count} mots, limite ${max})`, value)
    }
  }

  /** Dépassement du nombre d'éléments d'une liste. */
  count(field: string, actual: number, max: number, what: string): void {
    if (actual > max) this.warning(field, `${actual} ${what} (limite ${max})`)
  }

  permissions(field: string, codes: readonly string[] | undefined): void {
    if (codes === undefined) {
      this.error(field, 'liste de droits obligatoire (vide : toute personne connectée)')
      return
    }
    for (const code of codes) {
      if (!this.ctx.permissionCodes.has(code)) {
        this.error(field, 'droit absent du semis database/02_reference_data.sql', code)
      }
    }
  }

  access(entry: HelpAccess): void {
    if (entry.module === undefined) {
      this.error('module', 'champ obligatoire absent (écrire null si aucun module)')
    } else if (entry.module !== null && !this.ctx.knownModules.has(entry.module)) {
      this.error('module', 'module inconnu (voir KNOWN_MODULES de profiles.ts)', entry.module)
    }
    this.permissions('anyPermission', entry.anyPermission)
  }

  maturity(entry: {
    readonly maturity?: string | undefined
    readonly module?: string | null
  }): void {
    if (entry.maturity !== undefined && !MATURITIES.includes(entry.maturity)) {
      this.error('maturity', "valeur inconnue ('available' ou 'validation')", entry.maturity)
    }
    if (entry.module === 'offline' && entry.maturity !== 'validation') {
      this.error(
        'maturity',
        "le module « offline » est fermé en production : maturity 'validation' obligatoire",
      )
    }
  }

  refs(field: string, refs: readonly HelpRef[] | undefined, max: number): void {
    if (refs === undefined) return
    this.count(field, refs.length, max, 'liens')
    refs.forEach((ref, index) => {
      const at = `${field}[${index}]`
      if (this.filled(`${at}.label`, ref.label)) this.text(`${at}.label`, ref.label)
      if ('route' in ref) {
        const route = this.ctx.routes.get(ref.route)
        if (route === undefined) {
          this.error(`${at}.route`, 'route inconnue du routeur (router.ts)', ref.route)
        } else if (route.hasParams) {
          this.error(
            `${at}.route`,
            'route à paramètre : aucun lien direct possible (il faudrait un identifiant)',
            ref.route,
          )
        }
      } else if ('topic' in ref) {
        if (!this.ctx.topicIds.has(ref.topic)) {
          this.error(`${at}.topic`, 'rubrique inconnue de la documentation', ref.topic)
        }
      } else {
        this.error(at, 'lien sans route ni topic')
      }
      if (ref.why !== undefined) this.text(`${at}.why`, ref.why)
    })
  }

  block(field: string, block: HelpBlock): void {
    switch (block.kind) {
      case 'steps':
      case 'points':
        if (block.title !== undefined) this.text(`${field}.title`, block.title)
        if (block.items.length === 0) this.error(`${field}.items`, 'au moins un élément')
        block.items.forEach((item, index) => this.text(`${field}.items[${index}]`, item))
        break
      case 'note':
        if (block.tone !== undefined && !NOTE_TONES.includes(block.tone)) {
          this.error(`${field}.tone`, "ton inconnu ('info', 'warning' ou 'tip')", block.tone)
        }
        this.text(`${field}.text`, block.text)
        break
      case 'flow':
        if (block.title !== undefined) this.text(`${field}.title`, block.title)
        if (block.stages.length === 0) this.error(`${field}.stages`, 'au moins une étape')
        block.stages.forEach((stage, index) => {
          this.text(`${field}.stages[${index}].label`, stage.label)
          this.text(`${field}.stages[${index}].text`, stage.text)
        })
        break
      case 'table':
        if (block.title === undefined) {
          this.warning(field, 'tableau sans titre : il n’aura pas de légende accessible')
        } else {
          this.text(`${field}.title`, block.title)
        }
        if (block.head.length === 0 || block.rows.length === 0) {
          this.error(field, 'tableau sans en-têtes de colonnes ou sans lignes')
        }
        block.head.forEach((cell, index) => this.text(`${field}.head[${index}]`, cell))
        block.rows.forEach((row, index) => {
          if (row.length !== block.head.length) {
            this.error(
              `${field}.rows[${index}]`,
              `nombre de cellules (${row.length}) ≠ nombre de colonnes (${block.head.length})`,
            )
          }
          row.forEach((cell, column) => this.text(`${field}.rows[${index}][${column}]`, cell, true))
        })
        break
      case 'faq':
        if (block.title !== undefined) this.text(`${field}.title`, block.title)
        if (block.items.length === 0) this.error(`${field}.items`, 'au moins une question')
        block.items.forEach((item, index) => {
          this.text(`${field}.items[${index}].q`, item.q)
          this.text(`${field}.items[${index}].a`, item.a)
        })
        break
      case 'terms':
        if (block.title !== undefined) this.text(`${field}.title`, block.title)
        if (block.items.length === 0) this.error(`${field}.items`, 'au moins un terme')
        block.items.forEach((item, index) => {
          this.text(`${field}.items[${index}].term`, item.term)
          this.text(`${field}.items[${index}].definition`, item.definition)
        })
        break
      default:
        this.error(field, 'type de bloc inconnu', JSON.stringify(block))
    }
  }

  /** Promesses non tenues, une fois tous les textes lus. */
  promises(maturity: string | undefined): void {
    for (const { field, text } of this.texts) {
      for (const { rule, sentence } of findPromises(text)) {
        if (rule.exemptWhenValidation && maturity === 'validation') continue
        this.error(field, rule.message, sentence)
      }
    }
  }
}

/** Exécute un contrôle ; une entrée mal formée (qui ferait lever une erreur) devient un constat. */
function run(ctx: CheckContext, body: (report: Report) => void): Problem[] {
  const report = new Report(ctx)
  try {
    body(report)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    report.error('(entrée)', `contenu mal formé, contrôle interrompu : ${reason}`)
  }
  return report.problems
}

// --- Fiche d'écran -------------------------------------------------------------------------

export function checkPage(page: PageHelp, ctx: CheckContext): Problem[] {
  return run(ctx, (r) => {
    r.filled('route', page.route)
    if (r.filled('title', page.title)) r.text('title', page.title)
    if (r.filled('purpose', page.purpose)) {
      r.text('purpose', page.purpose)
      r.limit('purpose', page.purpose, LIMITS.purposeWords, 'purpose')
    }
    r.access(page)
    r.maturity(page)

    const route = ctx.routes.get(page.route)
    if (route === undefined) {
      r.error('route', 'aucune route nommée ainsi dans le routeur (router.ts)', page.route)
    } else {
      if (route.title !== null && page.title !== route.title) {
        r.warning(
          'title',
          `titre différent du titre de la route « ${route.title} » (sans gravité si le h1 de l’écran diffère de l’onglet)`,
          page.title,
        )
      }
      if ((route.module ?? null) !== (page.module ?? null)) {
        r.error(
          'module',
          `module « ${page.module} » ≠ module de la route « ${route.module} » (meta.module)`,
        )
      }
      const expected = [...route.permissions].sort().join(', ')
      const actual = [...page.anyPermission].sort().join(', ')
      if (expected !== actual) {
        r.error(
          'anyPermission',
          `droits [${actual}] ≠ droits de la route [${expected}] (meta.permissions)`,
        )
      }
    }

    if (page.actions.length + page.tasks.length === 0) {
      r.error('actions', 'ni action ni tâche : une fiche en a au moins une')
    }
    r.count('actions', page.actions.length, LIMITS.actions, 'actions')
    page.actions.forEach((action, index) => {
      const at = `actions[${index}]`
      if (r.filled(`${at}.label`, action.label))
        r.label(`${at}.label`, action.label, 'libellé d’action')
      if (r.filled(`${at}.effect`, action.effect)) {
        r.text(`${at}.effect`, action.effect)
        r.limit(`${at}.effect`, action.effect, LIMITS.effectWords, 'effect')
      }
      if (action.anyPermission !== undefined)
        r.permissions(`${at}.anyPermission`, action.anyPermission)
    })

    const maxTasks = page.route === INVOICE_ROUTE ? LIMITS.invoiceTasks : LIMITS.tasks
    r.count('tasks', page.tasks.length, maxTasks, 'tâches')
    const taskIds = new Set<string>()
    page.tasks.forEach((task, index) => {
      const at = `tasks[${index}]`
      if (!isFilled(task.id)) {
        r.error(`${at}.id`, 'identifiant obligatoire')
      } else if (!TASK_ID.test(task.id)) {
        r.error(
          `${at}.id`,
          'identifiant en minuscules sans accent, mots séparés par des tirets',
          task.id,
        )
      } else if (taskIds.has(task.id)) {
        r.error(`${at}.id`, 'identifiant de tâche en double dans la fiche', task.id)
      } else {
        taskIds.add(task.id)
      }
      if (r.filled(`${at}.title`, task.title)) r.text(`${at}.title`, task.title)
      if (task.steps.length === 0) r.error(`${at}.steps`, 'au moins une étape')
      r.count(`${at}.steps`, task.steps.length, LIMITS.steps, 'étapes')
      task.steps.forEach((step, stepIndex) => {
        r.text(`${at}.steps[${stepIndex}]`, step)
        r.limit(`${at}.steps[${stepIndex}]`, step, LIMITS.stepWords, 'étape')
      })
      if (task.result !== undefined) r.text(`${at}.result`, task.result)
      if (task.anyPermission !== undefined) r.permissions(`${at}.anyPermission`, task.anyPermission)
    })

    r.count('rules', page.rules.length, LIMITS.rules, 'règles')
    page.rules.forEach((rule, index) => {
      r.text(`rules[${index}]`, rule)
      r.limit(`rules[${index}]`, rule, LIMITS.ruleWords, 'règle')
    })
    r.refs('next', page.next, LIMITS.next)

    r.count('tips', (page.tips ?? []).length, LIMITS.tips, 'conseils')
    ;(page.tips ?? []).forEach((tip, index) => r.text(`tips[${index}]`, tip))
    r.count('problems', (page.problems ?? []).length, LIMITS.problems, 'problèmes')
    ;(page.problems ?? []).forEach((problem, index) => {
      r.text(`problems[${index}].symptom`, problem.symptom)
      r.text(`problems[${index}].remedy`, problem.remedy)
    })

    const seenTerms = new Set<string>()
    ;(page.terms ?? []).forEach((term, index) => {
      if (!ctx.glossaryTerms.has(term)) {
        r.error(
          `terms[${index}]`,
          'terme non défini par glossaire-optique ni glossaire-gestion',
          term,
        )
      } else if (seenTerms.has(term)) {
        r.warning(`terms[${index}]`, 'terme répété dans la fiche', term)
      }
      seenTerms.add(term)
    })

    r.promises(page.maturity)
  })
}

// --- Rubrique de la documentation -----------------------------------------------------------

export function checkTopic(topic: HandbookTopic, ctx: CheckContext): Problem[] {
  return run(ctx, (r) => {
    if (r.filled('id', topic.id) && !TOPIC_ID.test(topic.id)) {
      r.error('id', 'identifiant en minuscules sans accent, mots séparés par des tirets', topic.id)
    }
    if (r.filled('title', topic.title)) r.text('title', topic.title)
    if (r.filled('summary', topic.summary)) {
      r.text('summary', topic.summary)
      r.limit('summary', topic.summary, LIMITS.summaryWords, 'résumé')
    }
    r.access(topic)
    r.maturity(topic)
    for (const code of topic.audience ?? []) {
      if (!ctx.profileCodes.has(code)) {
        r.error('audience', 'profil inconnu (MANAGER, RECEPTION, CLINICIAN ou CASHIER)', code)
      }
    }
    if (topic.intro !== undefined) r.text('intro', topic.intro)
    if (topic.blocks.length === 0) r.error('blocks', 'au moins un bloc')
    topic.blocks.forEach((block, index) => r.block(`blocks[${index}]`, block))
    r.refs('related', topic.related, LIMITS.related)
    ;(topic.keywords ?? []).forEach((word, index) => r.filled(`keywords[${index}]`, word))

    const textLength = JSON.stringify(topic.blocks).length
    const dense = topic.blocks.some((block) => block.kind === 'terms' || block.kind === 'table')
    if (textLength > LIMITS.topicJsonLength && !dense) {
      r.warning(
        'blocks',
        `rubrique longue (environ ${Math.round(textLength / 6)} mots) : deux écrans au plus, la couper si possible`,
      )
    }
    r.promises(topic.maturity)
  })
}

/** Contrôles de textes isolés (titres et résumés des parties du plan, par exemple). */
export function checkTexts(fields: Readonly<Record<string, string>>, ctx: CheckContext): Problem[] {
  return run(ctx, (r) => {
    for (const [field, value] of Object.entries(fields)) r.text(field, value)
    r.promises(undefined)
  })
}

// --- Aides au contrat -----------------------------------------------------------------------

export const errorsOf = (problems: readonly Problem[]): Problem[] =>
  problems.filter((problem) => problem.level === 'error')

export const warningsOf = (problems: readonly Problem[]): Problem[] =>
  problems.filter((problem) => problem.level === 'warning')

/** Une ligne par constat : fichier › entrée › champ : message — valeur. */
export function formatProblem(origin: string, entry: string, problem: Problem): string {
  const value = problem.value === undefined ? '' : ` — valeur : ${problem.value}`
  return `${origin} › ${entry} › ${problem.field} : ${problem.message}${value}`
}

/** Exceptions de libellés, clés ramenées à la forme de comparaison. */
export function normalizeExceptions(
  exceptions: Readonly<Record<string, string>>,
): Map<string, string> {
  return new Map(
    Object.entries(exceptions).map(([label, reason]) => [normalizeLabel(label), reason] as const),
  )
}

/** Routes nommées du routeur, avec ce que la fiche d'aide doit reprendre. */
export function routeFacts(
  records: readonly Pick<RouteRecordNormalized, 'name' | 'path' | 'meta'>[],
): Map<string, RouteFacts> {
  const facts = new Map<string, RouteFacts>()
  for (const record of records) {
    if (typeof record.name !== 'string') continue
    facts.set(record.name, {
      name: record.name,
      hasParams: record.path.includes(':'),
      isPublic: record.meta.public === true,
      title: record.meta.title ?? null,
      module: record.meta.module ?? null,
      permissions: record.meta.permissions ?? [],
    })
  }
  return facts
}

/** Termes définis par les blocs `terms` des rubriques données : terme → rubriques qui le définissent. */
export function glossaryDefinitions(
  topics: readonly HandbookTopic[],
  topicIds: readonly string[],
): Map<string, string[]> {
  const definitions = new Map<string, string[]>()
  for (const id of topicIds) {
    const topic = topics.find((candidate) => candidate.id === id)
    for (const block of topic?.blocks ?? []) {
      if (block.kind !== 'terms') continue
      for (const item of block.items) {
        definitions.set(item.term, [...(definitions.get(item.term) ?? []), id])
      }
    }
  }
  return definitions
}
