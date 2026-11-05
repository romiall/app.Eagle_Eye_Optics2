// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { syncFailureMessage } from '@/app/services/syncFailure'
import { SyncRefused } from '@/offline/api'

/** Message d'un échange manqué : serveur injoignable (réessai utile) ou refus explicite (dit, avec la démarche). */
describe('syncFailureMessage', () => {
  it('serveur injoignable : les pièces repartiront au prochain essai', () => {
    expect(syncFailureMessage(new TypeError('Failed to fetch'))).toContain(
      'repartiront au prochain essai',
    )
  })

  it('poste remplacé : le refus du serveur est dit, jamais « sans réponse »', () => {
    const message = syncFailureMessage(
      new SyncRefused(
        403,
        'ACTION_FORBIDDEN',
        'Ce poste est déclaré perdu ou remplacé : il ne reçoit plus de données.',
      ),
    )
    expect(message).toContain('Le serveur refuse l’échange')
    expect(message).toContain('Ce poste est déclaré perdu ou remplacé')
    expect(message).not.toContain('prochain essai')
  })

  it('autorisation expirée : renvoie vers la préparation du profil', () => {
    const message = syncFailureMessage(
      new SyncRefused(403, 'GRANT_EXPIRED_OR_REVOKED', 'Aucune autorisation active.'),
    )
    expect(message).toContain('préparez de nouveau le profil en ligne (étape 3)')
  })
})
