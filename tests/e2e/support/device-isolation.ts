import { test, type TestInfo } from '@playwright/test'

import { blockingDevices, retireDevices } from './database'

/**
 * Isolation des parcours qui préparent un poste (O05, O07, G1, G2, P04…) : UNE SEULE caisse hors ligne principale détient
 * les numéros financiers à la fois (`FINANCIAL_DEVICE_ELSEWHERE`). Un parcours qui tombe avant d'avoir rendu les ressources
 * de son poste ferait donc échouer tous les parcours suivants ET sa propre reprise (la CI rejoue une fois un test échoué).
 * Constaté le 2026-11-10 (vérification unique, premier passage) : un seul échec isolé de `device-recovery.spec.ts` a laissé
 * sa caisse réservée ; les huit parcours suivants qui préparent un poste ont échoué deux fois chacun (9 échecs, 1,1 h au
 * lieu de 47 min).
 *
 * Deux mécanismes, un seul registre (les postes préparés par chaque essai de parcours) :
 *
 *  1. À LA FIN d'un parcours qui n'a pas réussi (échec, délai dépassé, interruption), la fixture automatique de
 *     `support/test.ts` sort les postes que CE parcours a préparés (`retireDevicesOf`). Elle passe aussi après un délai
 *     dépassé, ce que le `finally` d'un parcours ne garantit pas : le corps d'un test expiré n'est pas interrompu.
 *  2. AVANT de préparer un poste, `prepareThisDevice` sort tout poste qui détient encore une ressource financière sans avoir
 *     été préparé par le parcours en cours (`retireStrayDevices`) : processus de test tué, parcours qui n'importe pas le
 *     `test` commun, base laissée par une exécution précédente. Jamais un poste que le parcours a lui-même préparé : un
 *     parcours peut en préparer deux (reprise sur un poste neuf, O07).
 *
 * Le nettoyage vient APRÈS l'échec et ne touche à aucune assertion : un parcours échoué reste échoué avec son message. Les
 * postes sortis passent à l'état REPLACED (voir `database.php`) ; leurs ressources restent ouvertes, ce que les diagnostics
 * finaux (`zz-diagnostics-sql.spec.ts`) admettent comme une alerte « poste à synchroniser », jamais comme une anomalie.
 */

/** Codes des postes préparés par chaque essai de parcours (clé : identifiant du test et numéro d'essai). */
const preparedByTest = new Map<string, Set<string>>()

function keyOf(info: Pick<TestInfo, 'testId' | 'retry'>): string {
  return `${info.testId}#${String(info.retry)}`
}

/** Note qu'un poste vient d'être préparé par le parcours en cours : il lui appartient jusqu'à la fin de ce parcours. */
export function rememberDevice(code: string): void {
  const key = keyOf(test.info())
  const codes = preparedByTest.get(key) ?? new Set<string>()
  codes.add(code)
  preparedByTest.set(key, codes)
}

/**
 * Oublie les postes du parcours en cours : un processus de test tué perd sa mémoire, la base garde ses postes. Réservé au
 * test de garde (`isolation-postes.spec.ts`), qui prouve ainsi le filet de `retireStrayDevices`.
 */
export function forgetDevicesOfThisTest(): void {
  preparedByTest.delete(keyOf(test.info()))
}

/**
 * Fin d'un parcours qui n'a pas réussi : sort les postes qu'il a préparés (même ceux qu'il a déjà fait remplacer ou rendre :
 * l'opération est idempotente). Rend leurs codes.
 */
export function retireDevicesOf(info: Pick<TestInfo, 'testId' | 'retry'>): string[] {
  const key = keyOf(info)
  const codes = [...(preparedByTest.get(key) ?? [])]
  preparedByTest.delete(key)
  retireDevices(codes)
  return codes
}

/**
 * Avant de préparer un poste : sort tout poste qui détient encore une ressource financière sans avoir été préparé par le
 * parcours en cours, sinon la préparation serait refusée (`FINANCIAL_DEVICE_ELSEWHERE`) après 60 s d'attente sans message.
 * Le retrait est signalé (annotation du test et journal), jamais silencieux. Rend les codes retirés.
 */
export function retireStrayDevices(): string[] {
  const info = test.info()
  const mine = preparedByTest.get(keyOf(info)) ?? new Set<string>()
  const strays = blockingDevices().filter((device) => !mine.has(device.code))
  if (strays.length === 0) return []
  const codes = strays.map((device) => device.code)
  retireDevices(codes)
  const description = strays.map((device) => `${device.code} (${device.status})`).join(', ')
  info.annotations.push({ type: 'poste résiduel retiré', description })
  console.warn(`Poste(s) résiduel(s) retiré(s) avant la préparation d'un poste : ${description}`)
  return codes
}
