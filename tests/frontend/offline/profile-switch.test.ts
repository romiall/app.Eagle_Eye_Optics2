import { describe, expect, it } from 'vitest'

import { waitingSentences, waitingTotal } from '@/offline/profile-switch/waiting'

/**
 * Pièces d'un autre profil sur le poste principal (P04) : le journal est commun, chaque commande est scellée dans UN
 * compartiment, le profil ouvert n'envoie que ce qu'il sait lire. L'écran nomme le profil qui doit s'ouvrir à partir des
 * seuls compartiments (aucun contenu n'est lu). Données fictives.
 */
describe('pièces en attente de l’ouverture d’un autre profil', () => {
  it('rien n’attend : aucune phrase et un total nul', () => {
    expect(waitingSentences({})).toEqual([])
    expect(waitingSentences({ FINANCIAL: 0, CLINICAL: 0 })).toEqual([])
    expect(waitingTotal({})).toBe(0)
  })

  it('dit quel profil doit s’ouvrir, au singulier et au pluriel', () => {
    expect(waitingSentences({ FINANCIAL: 1 })).toEqual([
      '1 pièce de la caisse : à envoyer à l’ouverture d’un profil de caisse ou de la gérante',
    ])
    expect(waitingSentences({ FINANCIAL: 3 })).toEqual([
      '3 pièces de la caisse : à envoyer à l’ouverture d’un profil de caisse ou de la gérante',
    ])
    expect(waitingSentences({ CLINICAL: 1 })).toEqual([
      '1 pièce clinique : à envoyer à l’ouverture d’un profil professionnel ou de la gérante',
    ])
    expect(waitingSentences({ CLINICAL: 2 })).toEqual([
      '2 pièces cliniques : à envoyer à l’ouverture d’un profil professionnel ou de la gérante',
    ])
    expect(waitingSentences({ ADMINISTRATIVE: 1 })).toEqual([
      '1 pièce de l’accueil : à envoyer à l’ouverture d’un profil d’accueil',
    ])
    expect(waitingSentences({ MANAGER: 1 })).toEqual([
      '1 pièce de la gérante : à envoyer à l’ouverture du profil de la gérante',
    ])
  })

  it('une phrase par compartiment, dans l’ordre fixe du contrat, quel que soit l’ordre des comptes', () => {
    const sentences = waitingSentences({ MANAGER: 1, FINANCIAL: 2, CLINICAL: 4, ADMINISTRATIVE: 1 })
    expect(sentences.map((sentence) => sentence.split(' : ')[0])).toEqual([
      '1 pièce de l’accueil',
      '4 pièces cliniques',
      '2 pièces de la caisse',
      '1 pièce de la gérante',
    ])
    expect(waitingTotal({ MANAGER: 1, FINANCIAL: 2, CLINICAL: 4, ADMINISTRATIVE: 1 })).toBe(8)
  })

  it('ne lit jamais un contenu : le texte ne dépend que du compartiment et du nombre', () => {
    for (const sentence of waitingSentences({ FINANCIAL: 5, CLINICAL: 5 })) {
      expect(sentence).toMatch(
        /^5 pièces (de la caisse|cliniques) : à envoyer à l’ouverture d’un profil /,
      )
    }
  })
})
