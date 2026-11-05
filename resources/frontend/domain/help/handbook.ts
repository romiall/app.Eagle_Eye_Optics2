import { TOPICS_DEMARRER } from './content/handbook-demarrer'
import { TOPICS_GLOSSAIRE_DEPANNAGE } from './content/handbook-glossaire-depannage'
import { TOPICS_GUIDES_PROFILS } from './content/handbook-guides-profils'
import { TOPICS_MISE_EN_SERVICE } from './content/handbook-mise-en-service'
import { TOPICS_NOTIONS_BASE } from './content/handbook-notions-base'
import { TOPICS_NOTIONS_FINANCE } from './content/handbook-notions-finance'
import { TOPICS_PARCOURS_CLINIQUE } from './content/handbook-parcours-clinique'
import { TOPICS_PARCOURS_GESTION } from './content/handbook-parcours-gestion'
import type { HandbookPart, HandbookTopic } from './model'

/**
 * La documentation globale : sept parties, des rubriques à identifiants fixes (les fiches d'écran et les
 * rubriques se renvoient les unes aux autres par ces identifiants ; voir docs/implementation/help.md).
 * Chargé À LA DEMANDE, comme `pages.ts`.
 */
interface PartPlan {
  readonly id: string
  readonly title: string
  readonly icon: string
  readonly summary: string
  readonly topicIds: readonly string[]
}

export const PART_PLANS: readonly PartPlan[] = [
  {
    id: 'demarrer',
    title: 'Démarrer',
    icon: 'home',
    summary: 'Ce que fait l’application, comment s’y connecter et s’y repérer.',
    topicIds: ['bienvenue', 'se-connecter', 'se-reperer', 'profils', 'principes', 'journee-type'],
  },
  {
    id: 'parcours',
    title: 'Parcours pas à pas',
    icon: 'list',
    summary: 'Les tâches du cabinet, de bout en bout, dans l’ordre du travail réel.',
    topicIds: [
      'parcours-accueillir',
      'parcours-rendez-vous',
      'parcours-examen',
      'parcours-ordonnance',
      'parcours-suivi',
      'parcours-vente',
      'parcours-devis',
      'parcours-remise-article',
      'parcours-correction',
      'parcours-caisse',
      'parcours-stock',
      'parcours-gestion',
    ],
  },
  {
    id: 'guides-profils',
    title: 'Guides par profil',
    icon: 'users',
    summary: 'Votre journée avec l’application : gérante, accueil, professionnel, caissière.',
    topicIds: ['guide-accueil', 'guide-professionnel', 'guide-caisse', 'guide-gerante'],
  },
  {
    id: 'notions',
    title: 'Notions et règles',
    icon: 'info',
    summary:
      'Comment l’application raisonne : identité, examen, facture, encaissement, caisse, stock.',
    topicIds: [
      'notion-patient',
      'notion-visite-examen',
      'notion-examen-prescription',
      'notion-documents',
      'notion-securite',
      'notion-modules',
      'notion-facture',
      'notion-encaissement',
      'notion-caisse',
      'notion-stock',
      'notion-approbations',
    ],
  },
  {
    id: 'glossaire',
    title: 'Glossaire',
    icon: 'tag',
    summary: 'Le sens des mots d’optique et de gestion utilisés dans l’application.',
    topicIds: ['glossaire-optique', 'glossaire-gestion'],
  },
  {
    id: 'depannage',
    title: 'Dépannage',
    icon: 'alert',
    summary:
      'Les messages de l’application, les questions fréquentes et les limites de cette version.',
    topicIds: ['depannage-messages', 'depannage-questions', 'depannage-limites'],
  },
  {
    id: 'mise-en-service',
    title: 'Mise en service',
    icon: 'settings',
    summary: 'Préparer, configurer et vérifier l’outil avant l’ouverture chez la cliente.',
    topicIds: [
      'avant-installation',
      'premiere-configuration',
      'repetition-generale',
      'exploitation',
    ],
  },
]

const ALL_TOPICS: readonly HandbookTopic[] = [
  ...TOPICS_DEMARRER,
  ...TOPICS_PARCOURS_CLINIQUE,
  ...TOPICS_PARCOURS_GESTION,
  ...TOPICS_GUIDES_PROFILS,
  ...TOPICS_NOTIONS_BASE,
  ...TOPICS_NOTIONS_FINANCE,
  ...TOPICS_GLOSSAIRE_DEPANNAGE,
  ...TOPICS_MISE_EN_SERVICE,
]

const TOPIC_BY_ID: ReadonlyMap<string, HandbookTopic> = new Map(
  ALL_TOPICS.map((topic) => [topic.id, topic]),
)

/** Les parties, leurs rubriques dans l'ordre du plan (une rubrique absente du contenu est ignorée). */
export const HANDBOOK_PARTS: readonly HandbookPart[] = PART_PLANS.map((plan) => ({
  id: plan.id,
  title: plan.title,
  icon: plan.icon,
  summary: plan.summary,
  topics: plan.topicIds.flatMap((id) => {
    const topic = TOPIC_BY_ID.get(id)
    return topic === undefined ? [] : [topic]
  }),
}))

/** Toutes les rubriques écrites, y compris celles que le plan ne range dans aucune partie. */
export const HANDBOOK_TOPICS: readonly HandbookTopic[] = ALL_TOPICS

export function topicById(id: string): HandbookTopic | undefined {
  return TOPIC_BY_ID.get(id)
}

/** Partie qui range cette rubrique. */
export function partOfTopic(id: string): HandbookPart | undefined {
  return HANDBOOK_PARTS.find((part) => part.topics.some((topic) => topic.id === id))
}
