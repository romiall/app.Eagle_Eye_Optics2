import { COMPARTMENTS, type Compartment } from '../compartments'

/**
 * Changement de profil sur le poste principal (P04 ; fichier 19 : « le flux L0 complet peut se faire sur le poste principal
 * avec changement de profil et compartiments autorisés »).
 *
 * Le journal du poste est COMMUN aux profils, mais chaque commande est scellée dans UN compartiment : le profil ouvert
 * n'envoie que ce qu'il sait déchiffrer et le lot s'arrête à la première commande d'un autre compartiment (O05). Ces pièces
 * ne sont pas perdues : elles partent à l'ouverture d'un profil qui détient la clé de leur compartiment. Ce module dit, en
 * clair et sans rien lire de leur contenu, QUEL profil doit s'ouvrir, d'après les seuls compartiments (rôles du
 * référentiel : accueil → administratif ; professionnel → administratif et clinique ; caisse → administratif et
 * financier ; gérante → les quatre).
 */

/** Pièces non finalisées que le profil ouvert ne sait pas lire, par compartiment (nombre de commandes, jamais leur contenu). */
export type WaitingByCompartment = Readonly<Partial<Record<Compartment, number>>>

interface Owner {
  /** Complément de « pièce » au singulier et au pluriel (l'adjectif s'accorde) : à quoi se rattachent ces pièces. */
  one: string
  many: string
  /** Qui ouvre un profil capable de les envoyer. */
  opener: string
}

const OWNERS: Readonly<Record<Compartment, Owner>> = Object.freeze({
  ADMINISTRATIVE: { one: 'de l’accueil', many: 'de l’accueil', opener: 'd’un profil d’accueil' },
  CLINICAL: {
    one: 'clinique',
    many: 'cliniques',
    opener: 'd’un profil professionnel ou de la gérante',
  },
  FINANCIAL: {
    one: 'de la caisse',
    many: 'de la caisse',
    opener: 'd’un profil de caisse ou de la gérante',
  },
  MANAGER: { one: 'de la gérante', many: 'de la gérante', opener: 'du profil de la gérante' },
})

/** Singulier ou pluriel d'un compte de pièces (« 1 pièce clinique », « 3 pièces cliniques »). */
function counted(count: number, owner: Owner): string {
  return count > 1 ? `${count} pièces ${owner.many}` : `${count} pièce ${owner.one}`
}

/** Nombre total de pièces qui attendent l'ouverture d'un autre profil. */
export function waitingTotal(waiting: WaitingByCompartment): number {
  return COMPARTMENTS.reduce((total, compartment) => total + (waiting[compartment] ?? 0), 0)
}

/**
 * Une phrase par compartiment en attente, dans l'ordre fixe des compartiments (administratif, clinique, financier,
 * gérante) : « 3 pièces de la caisse : à envoyer à l’ouverture d’un profil de caisse ou de la gérante ». Vide si rien
 * n'attend.
 */
export function waitingSentences(waiting: WaitingByCompartment): string[] {
  const sentences: string[] = []
  for (const compartment of COMPARTMENTS) {
    const count = waiting[compartment] ?? 0
    if (count <= 0) continue
    const owner = OWNERS[compartment]
    sentences.push(`${counted(count, owner)} : à envoyer à l’ouverture ${owner.opener}`)
  }
  return sentences
}
