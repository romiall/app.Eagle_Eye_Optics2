/**
 * Modèle de l'aide intégrée : le contenu que la gérante, l'accueil, le professionnel et la caissière
 * lisent dans l'application, sans formation. Deux familles de contenu, une seule mise en forme :
 *
 * - l'aide d'ÉCRAN (`PageHelp`) : une fiche par écran routé, toujours composée dans le même ordre
 *   (« Vous êtes ici », « Ce que vous pouvez faire », « Pas à pas », « Comment ça marche »,
 *   « Ensuite », « À savoir », « Si ça ne marche pas ») ; elle s'ouvre depuis le bouton « Aide » de
 *   l'en-tête sur l'écran concerné ET figure dans la « Référence des écrans » de la documentation ;
 * - la documentation GLOBALE (`HandbookPart` / `HandbookTopic`) : démarrer, parcours de bout en bout,
 *   guides par profil, notions et règles, glossaire, dépannage, mise en service.
 *
 * Règles pures : ni Vue, ni routeur, ni réseau, ni stockage (le frontend n'utilise ni localStorage ni
 * sessionStorage). Les textes suivent le guide de rédaction de `docs/implementation/help.md` :
 * vouvoiement, phrases courtes, un geste par étape, libellés des boutons et champs recopiés EXACTEMENT
 * entre guillemets français « … » (un test vérifie qu'ils existent dans l'application). Rien n'y est
 * présenté comme disponible si l'application ne le fait pas ou ne l'a pas prouvé.
 */

/** Les quatre profils du cabinet (codes de la table `roles`). */
export type ProfileCode = 'MANAGER' | 'RECEPTION' | 'CLINICIAN' | 'CASHIER'

/**
 * Qui voit une rubrique : mêmes règles que le menu et les routes (module livré ET ouvert par
 * l'exploitant, au moins un des droits). Pour une fiche d'écran, ces deux champs reprennent
 * `meta.module` et `meta.permissions` de la route : un test les compare.
 */
export interface HelpAccess {
  /** Module requis (comme `meta.module`) ; null : aucun module. */
  readonly module: string | null
  /** L'un de ces droits suffit ; liste vide : toute personne connectée. */
  readonly anyPermission: readonly string[]
}

/**
 * `available` : fonction ouverte et vérifiée. `validation` : écran codé mais pas encore ouvert à la
 * cliente (par exemple la préparation d'un poste pour le travail sans Internet) : la fiche le dit en
 * tête et ne promet rien.
 */
export type HelpMaturity = 'available' | 'validation'

/** Une action possible sur l'écran : le libellé EXACT du bouton ou du lien, et son effet. */
export interface HelpAction {
  /** Libellé affiché, sans guillemets (le rendu ajoute la mise en forme). */
  readonly label: string
  /** Ce qui se passe quand on l'utilise, en une phrase. */
  readonly effect: string
  /** Réservé aux comptes qui détiennent l'un de ces droits (absent : tout compte de l'écran). */
  readonly anyPermission?: readonly string[]
}

/** Un « Pas à pas » : une tâche complète, étape par étape, jusqu'à son résultat. */
export interface HelpTask {
  /** Identifiant stable (ancre), unique dans la fiche. */
  readonly id: string
  /** Verbe à l'infinitif : « Créer une fiche patient ». */
  readonly title: string
  /** Une action par ligne ; les libellés des boutons et champs sont écrits « comme à l'écran ». */
  readonly steps: readonly string[]
  /** Ce que la personne obtient ou voit à la fin. */
  readonly result?: string
  /** Réservé aux comptes qui détiennent l'un de ces droits (absent : tout compte de l'écran). */
  readonly anyPermission?: readonly string[]
}

/** Une suite possible : un autre écran (nom de route SANS paramètre) ou une rubrique de la documentation. */
export type HelpRef =
  | { readonly route: string; readonly label: string; readonly why?: string }
  | { readonly topic: string; readonly label: string; readonly why?: string }

/** Un problème fréquent et sa solution, dans les mots de l'écran. */
export interface HelpProblem {
  /** Ce que la personne voit ou constate (message exact entre « … » s'il s'affiche à l'écran). */
  readonly symptom: string
  /** Que faire. */
  readonly remedy: string
}

/** Fiche d'aide d'un écran (une par route nommée de `router.ts`). */
export interface PageHelp extends HelpAccess {
  /** Nom de la route (`name` dans `router.ts`). */
  readonly route: string
  /** Titre de l'écran tel que la personne le lit (le `h1`). */
  readonly title: string
  readonly maturity?: HelpMaturity
  /** « Vous êtes ici » : à quoi sert l'écran et quand on y vient, en une ou deux phrases. */
  readonly purpose: string
  /** « Ce que vous pouvez faire ici » : les actions de l'écran. */
  readonly actions: readonly HelpAction[]
  /** « Pas à pas » : les une à trois tâches principales. */
  readonly tasks: readonly HelpTask[]
  /** « Comment ça marche » : les règles à connaître, en langage simple. */
  readonly rules: readonly string[]
  /** « Ensuite » : où aller après. */
  readonly next: readonly HelpRef[]
  /** « À savoir » : conseils et limites. */
  readonly tips?: readonly string[]
  /** « Si ça ne marche pas » : problèmes fréquents. */
  readonly problems?: readonly HelpProblem[]
  /** Mots du glossaire utiles ici (`term` de la rubrique « Glossaire »). */
  readonly terms?: readonly string[]
}

/** Éléments de mise en page d'une rubrique de la documentation globale. */
export type HelpBlock =
  | { readonly kind: 'steps'; readonly title?: string; readonly items: readonly string[] }
  | { readonly kind: 'points'; readonly title?: string; readonly items: readonly string[] }
  | { readonly kind: 'note'; readonly tone?: 'info' | 'warning' | 'tip'; readonly text: string }
  | {
      readonly kind: 'flow'
      readonly title?: string
      readonly stages: readonly { readonly label: string; readonly text: string }[]
    }
  | {
      readonly kind: 'table'
      readonly title?: string
      readonly head: readonly string[]
      readonly rows: readonly (readonly string[])[]
    }
  | {
      readonly kind: 'faq'
      readonly title?: string
      readonly items: readonly { readonly q: string; readonly a: string }[]
    }
  | {
      readonly kind: 'terms'
      readonly title?: string
      readonly items: readonly { readonly term: string; readonly definition: string }[]
    }

/** Une rubrique de la documentation globale (une page de lecture). */
export interface HandbookTopic extends HelpAccess {
  /** Identifiant stable, unique dans toute la documentation (ancre `#/identifiant`). */
  readonly id: string
  readonly title: string
  /** Une phrase : ce que la personne y apprend (cartes, résultats de recherche). */
  readonly summary: string
  /** Profils pour qui la rubrique est écrite (absent : tous). */
  readonly audience?: readonly ProfileCode[]
  readonly maturity?: HelpMaturity
  readonly intro?: string
  readonly blocks: readonly HelpBlock[]
  /** Pour aller plus loin. */
  readonly related?: readonly HelpRef[]
  /** Mots que les gens cherchent (synonymes) ; ils ne sont pas affichés. */
  readonly keywords?: readonly string[]
}

/** Une partie de la documentation globale (un groupe de rubriques). */
export interface HandbookPart {
  readonly id: string
  readonly title: string
  /** Nom d'une icône d'`AppIcon`. */
  readonly icon: string
  readonly summary: string
  readonly topics: readonly HandbookTopic[]
}
