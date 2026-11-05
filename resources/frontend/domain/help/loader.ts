import type * as HandbookModule from './handbook'
import type * as PagesModule from './pages'

/**
 * Chargement À LA DEMANDE du contenu de l'aide : le bouton « Aide » de l'en-tête et l'écran
 * « Documentation » importent les fiches et la documentation seulement quand on les ouvre (ce contenu
 * pèse plusieurs centaines de Ko de texte : il n'alourdit pas le démarrage de l'application). Les tests
 * remplacent ces deux fonctions par des fiches fictives (`vi.mock('@/domain/help/loader')`).
 */
export function loadPageHelp(): Promise<typeof PagesModule> {
  return import('./pages')
}

export function loadHandbook(): Promise<typeof HandbookModule> {
  return import('./handbook')
}
