import { PAGES_ACCES } from './content/pages-acces'
import { PAGES_AGENDA } from './content/pages-agenda'
import { PAGES_AUJOURDHUI } from './content/pages-aujourdhui'
import { PAGES_CAISSE } from './content/pages-caisse'
import { PAGES_CONSULTATIONS } from './content/pages-consultations'
import { PAGES_DEVIS_CATALOGUE } from './content/pages-devis-catalogue'
import { PAGES_FACTURE_DETAIL } from './content/pages-facture-detail'
import { PAGES_FACTURES } from './content/pages-factures'
import { PAGES_PATIENTS } from './content/pages-patients'
import { PAGES_PILOTAGE } from './content/pages-pilotage'
import { PAGES_STOCK } from './content/pages-stock'
import type { PageHelp } from './model'

/**
 * Les fiches d'aide de tous les écrans, assemblées. Ce module est chargé À LA DEMANDE (import
 * dynamique du bouton « Aide » et de l'écran « Documentation ») : il n'alourdit pas le démarrage.
 */
export const PAGE_HELP: readonly PageHelp[] = [
  ...PAGES_ACCES,
  ...PAGES_PATIENTS,
  ...PAGES_AUJOURDHUI,
  ...PAGES_CONSULTATIONS,
  ...PAGES_FACTURES,
  ...PAGES_FACTURE_DETAIL,
  ...PAGES_DEVIS_CATALOGUE,
  ...PAGES_CAISSE,
  ...PAGES_STOCK,
  ...PAGES_AGENDA,
  ...PAGES_PILOTAGE,
]

const BY_ROUTE: ReadonlyMap<string, PageHelp> = new Map(PAGE_HELP.map((page) => [page.route, page]))

/** Fiche de l'écran dont la route porte ce nom (absente : undefined). */
export function pageHelpFor(route: unknown): PageHelp | undefined {
  return typeof route === 'string' ? BY_ROUTE.get(route) : undefined
}
