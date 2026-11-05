import { inject, type InjectionKey } from 'vue'

import { ApiError, apiRequest, NetworkUnavailable, prepareSession } from '@/app/api'
import type { CommandName } from '@/domain/contracts/generated'
import { newUlid } from '@/domain/values/ulid'

import { commandContract, commandPath, type CommandContract } from './commandIndex'

/**
 * Répartiteur de mutations (fichier 23 : « Les composants Vue appellent un service d'application,
 * jamais une table Dexie directement ») : un écran décrit une commande du contrat F06 ; le
 * répartiteur choisit le chemin et rend une issue explicite.
 *
 * - Journal du poste préparé qui prend cette commande (O04 : facture dont le poste est propriétaire,
 *   droits préparés…) : commit local atomique, même en ligne (le poste est l'autorité temporaire de
 *   ses écritures ; la synchronisation suit).
 * - Sinon : route directe du contrat (même action serveur que la synchronisation). Corps conforme
 *   à `DirectRequest` : la charge, `expected_version` (nombre, ou null pour une commande sans
 *   version ou de nature « état »), et le champ de numéro à null (le serveur numérote). En-tête
 *   `Idempotency-Key` identique pour toutes les reprises d'une même intention.
 *
 * Aucune issue n'est devinée : sans réponse de l'application, la commande a pu être appliquée ;
 * elle se reprend avec la même clé.
 */
/**
 * Commande EN LIGNE seulement, hors catalogue F06 (aucune charge hors-ligne) : modification d'une prescription
 * brouillon (C04). Elle est toujours accompagnée d'une `route`.
 */
export type OnlineCommandName =
  | 'UpdatePrescriptionDraft'
  // Suppression d'un examen resté brouillon : en ligne seulement, version de la consultation attendue.
  | 'DeleteConsultationDraft'
  // Suppression d'un brouillon de prescription (jeton `expected_updated_at`), d'un brouillon de devis jamais émis (version
  // attendue) et annulation d'un contrôle recommandé encore actif (version attendue, motif) : en ligne seulement.
  | 'DeletePrescriptionDraft'
  | 'DeleteQuoteDraft'
  | 'CancelFollowUp'
  // Catalogue, règles fiscales et stock initial (B01, I00) : écritures de la gérante, en ligne seulement.
  | 'CreateCatalogItem'
  | 'UpdateCatalogItem'
  | 'CreateTaxRule'
  | 'UpdateTaxRule'
  | 'RegisterOpeningStock'
  // Import contrôlé du catalogue (X01) : aperçu sans écriture puis toutes les lignes ou aucune.
  | 'ImportCatalog'
  // Demande d'un export contrôlé (X02) : l'archive est produite par la tâche planifiée du serveur.
  | 'RequestExport'
  // Abandon d'un brouillon de facture (fichier 03) : en ligne seulement, version du brouillon attendue.
  | 'AbandonInvoiceDraft'
  // Annulation d'une visite avant l'examen (P03) : en ligne seulement, version de la visite attendue.
  | 'CancelVisit'
  // Fusion manuelle de deux fiches (L1D08) : gérante, mot de passe confirmé, version de la fiche absorbée.
  | 'MergePatients'
  // Caisse (L1D05) : dépenses et mouvements hors vente, catégories de dépenses, revue d'un écart de clôture.
  | 'RecordCashMovement'
  | 'SaveExpenseCategory'
  | 'ReviewCashVariance'
  // Devis versionnés (L1D07) : brouillon, émission, révision, réponse du client, conversion en brouillon de facture.
  | 'CreateQuoteDraft'
  | 'UpdateQuoteDraft'
  | 'IssueQuote'
  | 'ReviseQuote'
  | 'RecordQuoteDecision'
  | 'ConvertQuote'
  // Agenda (S01) : déplacement, annulation, absence d'un rendez-vous ; configuration de la gérante.
  | 'RescheduleAppointment'
  | 'CancelAppointment'
  | 'MarkAppointmentNoShow'
  | 'SaveSchedulingResource'
  | 'ReplaceOpeningHours'
  | 'AddResourceException'
  | 'SaveAppointmentService'

/**
 * Version attendue d'une route explicite : `none` (défaut : `expected_version: null` au corps), `entity`
 * (version de l'entité obligatoire, 409 si elle a changé : article, règle fiscale) ou `omitted` (corps
 * SANS `expected_version`, dont le schéma n'a pas ce champ : stock initial).
 */
export type RouteVersion = 'none' | 'entity' | 'omitted'

export interface MutationRequest {
  name: CommandName | OnlineCommandName
  /**
   * Route directe qui diffère de celle du contrat de la commande : variantes de `CreatePrescription`
   * (ordonnance externe, nouvelle version) ou commande en ligne seulement. Le chemin est concret (sans `{id}`),
   * relatif à `/api/v1`. Sans `expectedVersion`, la commande n'a pas de version attendue (null au corps).
   */
  route?: { method: 'POST' | 'PATCH'; path: string; expectedVersion?: RouteVersion }
  /** Paramètres du chemin de la route directe (`{id}`, `{step}`). */
  path?: Readonly<Record<string, string>>
  /** Charge du contrat F06, identifiants des effets compris (connus avant tout envoi). */
  payload: Readonly<Record<string, unknown>>
  /**
   * Version attendue : obligatoire pour une commande versionnée (brouillon, grand livre, entité),
   * absente ou null pour une commande sans version ou de nature « état ».
   */
  expectedVersion?: number | null
  /** Clé d'idempotence : la même pour toutes les reprises d'une même intention. */
  idempotencyKey: string
}

export type MutationOutcome =
  /** Appliquée et confirmée par le serveur (route directe). */
  | { kind: 'synced'; at: string; result: unknown }
  /** Commit local durable sur ce poste ; synchronisation à suivre (journal du poste). */
  | { kind: 'saved-local'; at: string }
  /** Le journal du poste a refusé le commit (atomique : rien n'est écrit). */
  | { kind: 'local-failed'; error: unknown }
  /** La pièce a changé entre-temps (version) ou la clé a déjà servi pour une autre charge. */
  | { kind: 'conflict'; error: ApiError }
  /** Refus du serveur : droits, validation, règle métier (avec valeurs actualisées). */
  | { kind: 'refused'; error: ApiError }
  /** Session expirée : saisie conservée, reprise après reconnexion avec la même clé. */
  | { kind: 'session-expired'; error: ApiError }
  /** Opération sensible : confirmation du mot de passe demandée (423), puis reprise. */
  | { kind: 'reauthentication-required'; error: ApiError }
  /** Refus temporaire avant toute exécution (trop de demandes, serveur occupé) : reprendre plus tard. */
  | { kind: 'retryable'; error: ApiError; retryAfterSeconds: number | null }
  /** Erreur du serveur ou page d'un hébergeur : la commande a pu être appliquée, rien n'est conclu. */
  | { kind: 'uncertain'; error: ApiError }
  /** Aucune réponse complète et aucun journal local pour cette commande : rien n'est conclu. */
  | { kind: 'unavailable' }
  /** Le compte connecté n'est plus celui qui a commencé la saisie (autre onglet) : rien n'est envoyé. */
  | { kind: 'account-changed' }

/** Journal du poste préparé (O04) : seul autorisé à écrire dans le coffre local. */
export interface LocalCommandEngine {
  /** Vrai si ce poste enregistre lui-même cette commande (propriété de la pièce, droits préparés). */
  handles(request: MutationRequest): boolean
  /** Commit local atomique (entités, séquence, audit, file de sortie) ; instant durable. */
  commit(request: MutationRequest): Promise<{ recordedAt: string }>
}

export interface MutationDispatcher {
  dispatch(request: MutationRequest): Promise<MutationOutcome>
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/

/** Nouvelle clé d'idempotence pour une nouvelle intention (ULID, comme l'identifiant de commande). */
export function newIdempotencyKey(): string {
  return newUlid()
}

/** Corps de la route directe conforme au `DirectRequest` du contrat de la commande. */
export function directBody(
  contract: CommandContract,
  request: MutationRequest,
): Record<string, unknown> {
  const versioned = contract.expectedVersion !== 'none' && contract.expectedVersion !== 'state'
  const version = request.expectedVersion ?? null
  if (versioned && version === null) {
    throw new Error(`Version attendue obligatoire pour ${request.name}.`)
  }
  if (!versioned && version !== null) {
    throw new Error(`${request.name} n'a pas de version attendue (null sur la route directe).`)
  }
  const body: Record<string, unknown> = { ...request.payload, expected_version: version }
  if (contract.directNumberField !== null) body[contract.directNumberField] = null
  if (request.route?.expectedVersion === 'omitted') delete body['expected_version']
  return body
}

/** Contrat d'une route explicite : aucune version attendue ni numéro de pièce (le corps porte `expected_version: null`). */
function routeContract(
  name: MutationRequest['name'],
  route: NonNullable<MutationRequest['route']>,
): CommandContract {
  return {
    name: name as CommandName,
    method: route.method,
    path: `/api/v1${route.path}`,
    permission: '',
    expectedVersion: route.expectedVersion === 'entity' ? 'entity' : 'none',
    entityType: '',
    entityIdField: '',
    numberType: null,
    directNumberField: null,
  }
}

function classify(error: ApiError): MutationOutcome {
  if (error.status === 401 || error.status === 419) return { kind: 'session-expired', error }
  if (error.code === 'REAUTHENTICATION_REQUIRED')
    return { kind: 'reauthentication-required', error }
  if (error.code === 'VERSION_CONFLICT' || error.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH') {
    return { kind: 'conflict', error }
  }
  // Refusées avant exécution par l'application elle-même : rien n'a été appliqué.
  if (error.fromApplication && (error.code === 'RATE_LIMITED' || error.code === 'SERVER_BUSY')) {
    return { kind: 'retryable', error, retryAfterSeconds: error.retryAfterSeconds }
  }
  if (!error.fromApplication || error.status >= 500) return { kind: 'uncertain', error }
  return { kind: 'refused', error }
}

export function createMutationDispatcher(
  options: { localEngine?: LocalCommandEngine | null; now?: () => Date } = {},
): MutationDispatcher {
  const localEngine = options.localEngine ?? null
  const now = options.now ?? (() => new Date())

  async function send(contract: CommandContract, request: MutationRequest): Promise<unknown> {
    return apiRequest<unknown>(
      contract.method,
      commandPath(contract, request.path ?? {}),
      directBody(contract, request),
      { 'Idempotency-Key': request.idempotencyKey },
    )
  }

  return {
    async dispatch(request: MutationRequest): Promise<MutationOutcome> {
      if (!IDEMPOTENCY_KEY.test(request.idempotencyKey)) {
        throw new Error(
          'Clé d’idempotence invalide (8 à 128 caractères : lettres, chiffres, . _ : -).',
        )
      }
      const contract =
        request.route === undefined
          ? commandContract(request.name as CommandName)
          : routeContract(request.name, request.route)

      if (localEngine?.handles(request) === true) {
        try {
          const { recordedAt } = await localEngine.commit(request)
          return { kind: 'saved-local', at: recordedAt }
        } catch (error) {
          return { kind: 'local-failed', error }
        }
      }

      // Contrôle du corps avant tout envoi : une erreur de programmation n'atteint pas le serveur.
      directBody(contract, request)
      try {
        let result: unknown
        try {
          result = await send(contract, request)
        } catch (error) {
          // Jeton CSRF périmé (419) : renouvelé une fois, même clé, avant de demander une reconnexion.
          if (!(error instanceof ApiError) || error.status !== 419) throw error
          await prepareSession()
          result = await send(contract, request)
        }
        return { kind: 'synced', at: now().toISOString(), result }
      } catch (error) {
        if (error instanceof NetworkUnavailable) return { kind: 'unavailable' }
        if (error instanceof ApiError) return classify(error)
        throw error
      }
    },
  }
}

/** Journal local fourni par le poste préparé (O04) ; absent : routes directes seulement. */
export const LOCAL_ENGINE_KEY: InjectionKey<LocalCommandEngine | null> = Symbol('eeo-local-engine')

export const MUTATION_DISPATCHER_KEY: InjectionKey<MutationDispatcher> =
  Symbol('eeo-mutation-dispatcher')

export function useMutationDispatcher(): MutationDispatcher {
  const provided = inject(MUTATION_DISPATCHER_KEY, null)
  if (provided !== null) return provided
  return createMutationDispatcher({ localEngine: inject(LOCAL_ENGINE_KEY, null) })
}
