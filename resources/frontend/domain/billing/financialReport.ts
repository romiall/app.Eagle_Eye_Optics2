import type { FinancialReport } from '@/domain/contracts/generated'

import type { DayMethodRow } from './cashReport'

/**
 * Finance du cabinet sur une période (R01 ; fichier 03 « Caisse et indicateurs » ; fichier 19 « Dashboard distant ») :
 * règles pures qui préparent l'affichage. Aucun montant n'est recalculé autrement qu'à partir des faits rendus par le
 * serveur : chiffre d'affaires et encaissements restent des indicateurs DISTINCTS, les créances et les crédits à rembourser
 * restent à part, et aucun état « payé » n'est déduit.
 */

/** Poste de caisse hors ligne tel que le serveur le décrit pour la fraîcheur des totaux. */
export type FinancialDevice = FinancialReport['freshness']['devices'][number]

/** Ligne d'un mode de règlement : mêmes champs que la caisse du jour (encaissé, contre-écritures, remboursements, net). */
export function collectionRows(report: FinancialReport): DayMethodRow[] {
  return report.collections.by_method.map((entry) => ({
    method: entry.method,
    count: entry.payments_count,
    collected: entry.payments_amount,
    reversed: entry.reversals_amount,
    refunded: entry.refunds_amount,
    net: entry.net_amount,
  }))
}

/** Espèces nettes de la période (tiroir), distinctes des autres modes rapprochés à part. */
export function periodCashNet(report: FinancialReport): number {
  return report.collections.by_method.find((entry) => entry.method === 'CASH')?.net_amount ?? 0
}

/** Somme nette des modes hors espèces (mobile money, virement, chèque, autre). */
export function periodOtherNet(report: FinancialReport): number {
  return report.collections.by_method
    .filter((entry) => entry.method !== 'CASH')
    .reduce((total, entry) => total + entry.net_amount, 0)
}

/** Auteur affichable : le nom rendu par le serveur, sinon un identifiant court, sinon « Auteur inconnu » (jamais inventé). */
export function authorLabel(name: string | null, userId: string | null): string {
  if (name !== null && name.trim() !== '') return name
  return userId === null ? 'Auteur inconnu' : `Compte …${userId.slice(-6)}`
}

function plural(count: number, singular: string, pluralForm: string = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`
}

/**
 * Phrase lue par la gérante pour un poste dont les totaux ne sont pas garantis ; null pour un poste à jour.
 * `lastSeen` est la dernière pièce reçue de ce poste, déjà mise en forme (heure du cabinet), ou null s'il n'a rien
 * transmis. La phrase dit ce qui est SU (commandes reçues qui attendent) et ce qui est INCONNU (ce qu'un poste silencieux
 * détient) : le serveur ne compte jamais une opération restée sur un poste.
 */
export function deviceNotice(
  device: FinancialDevice,
  silenceHours: number,
  lastSeen: string | null,
): string | null {
  switch (device.state) {
    case 'UP_TO_DATE':
      return null
    case 'WAITING': {
      const parts: string[] = []
      if (device.commands_pending > 0) {
        parts.push(
          `${plural(device.commands_pending, 'commande reçue', 'commandes reçues')} en attente d’une pièce liée`,
        )
      }
      if (device.commands_in_conflict > 0) {
        parts.push(
          `${plural(device.commands_in_conflict, 'commande')} en conflit à décider par la gérante`,
        )
      }
      return `${device.name} : ${parts.join(' et ')}. Les montants de ces commandes ne sont pas encore dans ces totaux.`
    }
    case 'SILENT':
      return lastSeen === null
        ? `${device.name} : n’a encore rien transmis au serveur. Ce que ce poste détient est inconnu du serveur et ne figure pas dans ces totaux.`
        : `${device.name} : rien reçu depuis le ${lastSeen} (plus de ${silenceHours} h avant la fin de la période ou la lecture). Ce que ce poste a enregistré depuis est inconnu du serveur et ne figure pas dans ces totaux.`
  }
}

/** Titre de la fraîcheur : complète, sans poste hors ligne, ou incomplète. `tone` choisit l'icône et la couleur. */
export function freshnessHeadline(freshness: FinancialReport['freshness']): {
  tone: 'ok' | 'warn'
  text: string
} {
  if (freshness.devices.length === 0) {
    return {
      tone: 'ok',
      text: 'Aucun poste hors ligne ne détient de pièces financières : ces totaux sont complets à l’instant de la lecture.',
    }
  }
  if (freshness.complete) {
    return {
      tone: 'ok',
      text: `Totaux à jour : ${plural(freshness.devices.length, 'poste hors ligne a', 'postes hors ligne ont')} transmis récemment et aucune commande reçue n’attend.`,
    }
  }
  return {
    tone: 'warn',
    text: 'Totaux possiblement incomplets : au moins un poste hors ligne n’est pas à jour. Les opérations restées sur un poste ne sont visibles qu’après sa synchronisation.',
  }
}

/** Libellé court de l'état d'un poste pour sa pastille. */
export function deviceStateLabel(state: FinancialDevice['state']): string {
  switch (state) {
    case 'UP_TO_DATE':
      return 'À jour'
    case 'WAITING':
      return 'Commandes en attente'
    case 'SILENT':
      return 'Sans nouvelle'
  }
}

/** Écart de caisse dit avec son signe (« +500 » : compté supérieur à l'attendu). */
export function signedAmount(amount: number, format: (value: number) => string): string {
  return amount > 0 ? `+${format(amount)}` : format(amount)
}
