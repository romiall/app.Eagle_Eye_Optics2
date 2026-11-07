import { CommandJournal } from '../command-journal/journal'
import type { Compartment } from '../compartments'
import type { CommandState } from '../vault/db'
import type { Vault } from '../vault/vault'

import { pullChanges, type PullReport } from './pull'
import { PUSH_MAX_COMMANDS, pushJournal, type PushReport } from './push'
import type { SyncTransport } from './transport'

/**
 * Moteur de synchronisation du poste préparé (O05) : push du journal puis pull des changements, avec un seul échange à
 * la fois par onglet. Les états affichés restent HONNÊTES : une commande « Enregistrée sur ce poste » ne devient
 * « Consolidée sur le serveur » qu'à son ACK final enregistré localement ; un échec d'échange est dit, et rien n'est
 * retiré du journal.
 *
 * Reprise : tout est dans IndexedDB (journal, états, curseurs). Après une coupure, une fermeture du navigateur ou un
 * redémarrage, le prochain échange renvoie les MÊMES commandes non finalisées et reprend le pull au curseur commité.
 */
export interface SyncReport {
  push: PushReport
  pull: PullReport | null
  serverTime: string | null
}

export interface JournalSyncSummary {
  /** Commits locaux pas encore envoyés (profil ouvert). */
  local: number
  /** Envoyés sans ACK final. */
  pending: number
  waitingDependency: number
  conflicts: number
  rejected: number
  /** Non finalisées d'un compartiment que ce profil n'ouvre pas : elles partent à l'ouverture de leur profil. */
  otherProfiles: number
  /** Les mêmes pièces, par compartiment : l'écran dit quel profil doit s'ouvrir (P04), sans lire leur contenu. */
  otherCompartments: Partial<Record<Compartment, number>>
  lastExchangeAt: string | null
  lastAttemptFailed: boolean
}

/** Commande du poste qui attend une décision ou une pièce, ou rejetée après revue (sans donnée de la charge). */
export interface LocalSyncIssue {
  commandId: string
  commandName: string
  deviceSequence: number
  state: Extract<CommandState, 'WAITING_DEPENDENCY' | 'CONFLICT_REQUIRES_REVIEW' | 'REJECTED'>
  conflictId: string | null
  errorCode: string | null
  reason: string | null
  recordedAt: string
}

export interface SyncEngineOptions {
  transport: SyncTransport
  now?: () => number
  maxCommands?: number
  maxBytes?: number
  maxPages?: number
  /** Nombre maximal de lots poussés par échange (les suivants partent au prochain). */
  maxRounds?: number
}

const ISSUE_STATES: ReadonlySet<CommandState> = new Set([
  'WAITING_DEPENDENCY',
  'CONFLICT_REQUIRES_REVIEW',
  'REJECTED',
])

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

export class SyncEngine {
  private readonly now: () => number
  private running: Promise<SyncReport> | null = null

  constructor(
    private readonly vault: Vault,
    private readonly options: SyncEngineOptions,
  ) {
    this.now = options.now ?? (() => Date.now())
  }

  /** Un échange complet (push puis pull) ; un appel pendant un échange en cours attend le même. */
  syncNow(): Promise<SyncReport> {
    this.running ??= this.exchange().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async exchange(): Promise<SyncReport> {
    const previous = await this.vault.syncStatus()
    // Un push réussi est un échange réussi, même si le pull qui suit échoue (l'échec est dit à part).
    let serverTime: string | null = null
    try {
      const maxCommands = this.options.maxCommands ?? PUSH_MAX_COMMANDS
      let push = await pushJournal(this.vault, this.options.transport, {
        now: this.now,
        maxCommands,
        ...(this.options.maxBytes === undefined ? {} : { maxBytes: this.options.maxBytes }),
      })
      serverTime = push.serverTime
      // Lots suivants seulement si le précédent est entièrement finalisé (sinon le serveur s'est arrêté à un non finalisé).
      for (let round = 1; round < (this.options.maxRounds ?? 10); round += 1) {
        if (push.sent < maxCommands || push.acknowledged + push.rejected < push.sent) break
        push = await pushJournal(this.vault, this.options.transport, {
          now: this.now,
          maxCommands,
          ...(this.options.maxBytes === undefined ? {} : { maxBytes: this.options.maxBytes }),
        })
        serverTime = push.serverTime ?? serverTime
      }
      const pull = await pullChanges(this.vault, this.options.transport, {
        now: this.now,
        ...(this.options.maxPages === undefined ? {} : { maxPages: this.options.maxPages }),
      })
      serverTime = pull.serverTime ?? serverTime
      await this.vault.noteSyncStatus({
        lastExchangeAt: serverTime ?? previous.lastExchangeAt,
        lastAttemptFailed: false,
      })
      return { push, pull, serverTime }
    } catch (error) {
      await this.vault.noteSyncStatus({
        lastExchangeAt: serverTime ?? previous.lastExchangeAt,
        lastAttemptFailed: true,
      })
      throw error
    }
  }

  /** Compteurs du journal pour l'état de synchronisation (F10). */
  async summary(): Promise<JournalSyncSummary> {
    const session = this.vault.session()
    const compartments: readonly string[] = session?.compartments ?? []
    const journal = new CommandJournal(this.vault)
    const pending = await journal.pending(Number.MAX_SAFE_INTEGER)
    const statuses = await journal.statuses()
    const status = await this.vault.syncStatus()
    const summary: JournalSyncSummary = {
      local: 0,
      pending: 0,
      waitingDependency: 0,
      conflicts: 0,
      rejected: [...statuses.values()].filter((row) => row.state === 'REJECTED').length,
      otherProfiles: 0,
      otherCompartments: {},
      lastExchangeAt: status.lastExchangeAt,
      lastAttemptFailed: status.lastAttemptFailed,
    }
    for (const item of pending) {
      if (!compartments.includes(item.row.compartment)) {
        summary.otherProfiles += 1
        summary.otherCompartments[item.row.compartment] =
          (summary.otherCompartments[item.row.compartment] ?? 0) + 1
      } else if (item.state === 'LOCAL') summary.local += 1
      else if (item.state === 'SENT') summary.pending += 1
      else if (item.state === 'WAITING_DEPENDENCY') summary.waitingDependency += 1
      else if (item.state === 'CONFLICT_REQUIRES_REVIEW') summary.conflicts += 1
    }
    return summary
  }

  /** Commandes en attente d'une pièce, en conflit ou rejetées, dans l'ordre du journal (aucune donnée de la charge). */
  async issues(): Promise<LocalSyncIssue[]> {
    const tables = this.vault.localTables()
    const statuses = new CommandJournal(this.vault)
    const byId = await statuses.statuses()
    const rows = await tables.command_journal.orderBy('deviceSequence').toArray()
    const issues: LocalSyncIssue[] = []
    for (const row of rows) {
      const status = byId.get(row.commandId)
      if (status === undefined || !ISSUE_STATES.has(status.state)) continue
      const references = status.references ?? {}
      issues.push({
        commandId: row.commandId,
        commandName: row.commandName,
        deviceSequence: row.deviceSequence,
        state: status.state as LocalSyncIssue['state'],
        conflictId: text(references['conflict_id']),
        errorCode: text(references['error_code']),
        reason: text(references['reason']),
        recordedAt: row.recordedAt,
      })
    }
    return issues
  }
}
