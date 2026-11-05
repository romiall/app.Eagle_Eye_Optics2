import { apiRequest, NetworkUnavailable } from '@/app/api'
import { sha256Hex } from '@/documents/engine/hash'
import type {
  CashDayReport,
  CashDayReportResponse,
  CashRegister,
  CashRegisterList,
  CashSession,
  CashSessionMovements,
  CashSessionMovementsResponse,
  CashSessionPage,
  CashSessionReport,
  CashSessionReportResponse,
  CatalogPage,
  CreditNote,
  CreditNoteResponse,
  CurrentCashSessionResponse,
  ExpenseCategory,
  ExpenseCategoryList,
  Invoice,
  InvoicePage,
  InvoiceResponse,
  InvoicesStatus,
  Receipt,
  ReceiptResponse,
  Refund,
  RefundResponse,
  SalesSettings,
  SalesSettingsResponse,
  StockAvailabilityPage,
  StockLocation,
  StockLocationList,
  TaxRule,
  TaxRuleList,
} from '@/domain/contracts/generated'
import { displayedLinesFingerprint } from '@/domain/billing/issueInvoice'
import { searchLocalCatalog } from '@/domain/billing/localCatalog'
import { isUlid } from '@/domain/values/ulid'

import { localCatalog } from './localCatalog'
import { isUnconsolidatedInvoice, localInvoices } from './localInvoices'
import type { ReadOutcome } from './reads'

/**
 * Lectures du serveur pour les écrans de vente, de caisse et de stock (B01 à B05, I00), EN LIGNE
 * seulement. Comme pour les patients, chaque lecture rend la donnée avec sa fraîcheur (`serverAsOf` :
 * l'heure de la réponse du serveur à CET appel) et `live` vrai : seul un vide `live` devient « aucun
 * résultat » (`useRead`). Une erreur du serveur est propagée telle quelle (404 d'un module fermé ou
 * d'une pièce inconnue, 403, 422) ; un réseau coupé reste `NetworkUnavailable`, jamais une liste vide.
 *
 * Aucun solde n'est calculé ici : la projection (`balance`, `ledger_version`) vient du serveur.
 *
 * Deux lectures seulement savent aussi répondre depuis CE poste (coffre ouvert, module hors-ligne ouvert), et le disent
 * (fraîcheur « ce poste », `live` faux : jamais une absence affirmée) : le catalogue figé pour le choix d'un article
 * (`includeLocal`, jamais pour la gestion du catalogue) et une facture CRÉÉE sur ce poste (`getInvoice`).
 */
function answered<T>(data: T): ReadOutcome<T> {
  return { data, freshness: { serverAsOf: new Date().toISOString(), complete: true }, live: true }
}

/** Donnée lue sur CE poste seulement : fraîcheur « ce poste », jamais un vide affirmé (`live` faux). */
function fromThisDevice<T>(data: T): ReadOutcome<T> {
  return { data, freshness: { serverAsOf: null, complete: false }, live: false }
}

function assertId(id: string, what: string): void {
  if (!isUlid(id)) throw new RangeError(`Identifiant de ${what} invalide.`)
}

function assertPage(page: number): void {
  if (!Number.isSafeInteger(page) || page < 1) throw new RangeError('Page invalide.')
}

/** Jour civil `AAAA-MM-JJ` (fuseau du cabinet) : seul format accepté par le serveur. */
function assertCivilDate(day: string, what: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
    throw new RangeError(`${what} invalide (AAAA-MM-JJ attendu).`)
}

// --- Règles de vente du compte ----------------------------------------------------------------------

/**
 * Règles de vente du compte connecté (autorité de prix, plafond de remise effectif, modes de règlement
 * à référence obligatoire) : servent à DIRE la limite avant l'envoi ; le serveur reste seul juge.
 */
export async function getSalesSettings(): Promise<ReadOutcome<SalesSettings>> {
  const response = await apiRequest<SalesSettingsResponse>('GET', '/api/v1/sales/settings')
  return answered(response.data)
}

// --- Catalogue et règles fiscales -----------------------------------------------------------------

/**
 * Recherche du catalogue (référence, nom, marque ou modèle, 2 caractères au moins ; sans texte : les
 * articles actifs). `includeInactive` n'a d'effet que pour la gérante (le serveur l'ignore sinon). `includeLocal`
 * (choix d'un article de facture) : serveur injoignable, le catalogue FIGÉ du poste répond (articles actifs, prix et
 * règles fiscales de sa préparation) ; sans catalogue sur le poste, le réseau coupé reste signalé tel quel.
 */
export async function searchCatalog(
  query: string,
  page = 1,
  options: { includeInactive?: boolean; includeLocal?: boolean } = {},
): Promise<ReadOutcome<CatalogPage>> {
  assertPage(page)
  const text = query.trim()
  if (text !== '' && text.length < 2) {
    throw new RangeError('La recherche demande 2 caractères au moins.')
  }
  const parameters = new URLSearchParams({ page: String(page) })
  if (text !== '') parameters.set('query', text)
  if (options.includeInactive === true) parameters.set('include_inactive', 'true')
  try {
    return answered(await apiRequest<CatalogPage>('GET', `/api/v1/catalog?${parameters}`))
  } catch (error) {
    if (!(options.includeLocal === true && error instanceof NetworkUnavailable)) throw error
    const catalog = await localCatalog()
    if (catalog === null) throw error
    return fromThisDevice(searchLocalCatalog(catalog, text, page))
  }
}

export async function listTaxRules(): Promise<ReadOutcome<TaxRule[]>> {
  const response = await apiRequest<TaxRuleList>('GET', '/api/v1/tax-rules')
  return answered(response.data)
}

// --- Factures et reçus ----------------------------------------------------------------------------

export interface InvoiceFilters {
  status?: Extract<InvoicesStatus, 'DRAFT' | 'ISSUED' | 'ABANDONED'> | null
  patientId?: string | null
  /** Jour civil d'émission `AAAA-MM-JJ` au fuseau du cabinet (filtre du SERVEUR, toutes pages). */
  issuedOn?: string | null
  page?: number
}

/**
 * Factures, les plus récentes d'abord (25 par page), avec leur reste dû projeté par le serveur et
 * l'identité de base du patient. Le jour d'émission est filtré par le serveur (fuseau du cabinet).
 */
export async function listInvoices(
  filters: InvoiceFilters = {},
): Promise<ReadOutcome<InvoicePage>> {
  const page = filters.page ?? 1
  assertPage(page)
  const parameters = new URLSearchParams({ page: String(page) })
  if (filters.status !== undefined && filters.status !== null) {
    parameters.set('status', filters.status)
  }
  if (filters.patientId !== undefined && filters.patientId !== null) {
    assertId(filters.patientId, 'patient')
    parameters.set('patient_id', filters.patientId)
  }
  if (filters.issuedOn !== undefined && filters.issuedOn !== null) {
    assertCivilDate(filters.issuedOn, 'Jour d’émission')
    parameters.set('issued_on', filters.issuedOn)
  }
  return answered(await apiRequest<InvoicePage>('GET', `/api/v1/invoices?${parameters}`))
}

/**
 * Facture, lignes, encaissements et solde projeté ; snapshots figés pour une facture émise. Une facture CRÉÉE sur ce poste
 * et pas encore consolidée PRIME sur le serveur, qui ne la connaît pas encore (F10, AT42) ; consolidée, le serveur fait foi
 * quand il répond et la copie du poste répond quand il ne répond pas. Une erreur du serveur n'est jamais remplacée.
 */
export async function getInvoice(id: string): Promise<ReadOutcome<Invoice>> {
  assertId(id, 'facture')
  const local = (await localInvoices()).get(id) ?? null
  if (local !== null && isUnconsolidatedInvoice(local.state)) return fromThisDevice(local.invoice)
  try {
    const response = await apiRequest<InvoiceResponse>(
      'GET',
      `/api/v1/invoices/${encodeURIComponent(id)}`,
    )
    return answered(response.data)
  } catch (error) {
    if (local !== null && error instanceof NetworkUnavailable) return fromThisDevice(local.invoice)
    throw error
  }
}

/** Reçu d'un encaissement : pièce immuable, snapshot figé (source de son PDF). */
export async function getReceipt(id: string): Promise<ReadOutcome<Receipt>> {
  assertId(id, 'reçu')
  const response = await apiRequest<ReceiptResponse>(
    'GET',
    `/api/v1/receipts/${encodeURIComponent(id)}`,
  )
  return answered(response.data)
}

/** Avoir (B07) : lignes créditées, part déjà remboursée, snapshot figé (source de son PDF). */
export async function getCreditNote(id: string): Promise<ReadOutcome<CreditNote>> {
  assertId(id, 'avoir')
  const response = await apiRequest<CreditNoteResponse>(
    'GET',
    `/api/v1/credit-notes/${encodeURIComponent(id)}`,
  )
  return answered(response.data)
}

/** Remboursement (B08) : pièce liée à un avoir, snapshot figé (source de son PDF). */
export async function getRefund(id: string): Promise<ReadOutcome<Refund>> {
  assertId(id, 'remboursement')
  const response = await apiRequest<RefundResponse>(
    'GET',
    `/api/v1/refunds/${encodeURIComponent(id)}`,
  )
  return answered(response.data)
}

/**
 * Empreinte SHA-256 (hexadécimal) des lignes affichées au moment de l'émission. Elle part avec
 * `IssueInvoice` (`catalog_snapshot_sha256`) et le serveur la consigne dans l'audit à côté de la sienne.
 */
export async function displayedLinesSha256(invoice: Invoice): Promise<string> {
  return sha256Hex(new TextEncoder().encode(displayedLinesFingerprint(invoice)))
}

// --- Caisse -----------------------------------------------------------------------------------------

export async function listCashRegisters(): Promise<ReadOutcome<CashRegister[]>> {
  const response = await apiRequest<CashRegisterList>('GET', '/api/v1/cash-registers')
  return answered(response.data)
}

/** Session de caisse ouverte du compte connecté, ou null (aucune session ouverte). */
export async function getCurrentCashSession(): Promise<ReadOutcome<CashSession | null>> {
  const response = await apiRequest<CurrentCashSessionResponse>(
    'GET',
    '/api/v1/cash-sessions/current',
  )
  return answered(response.data)
}

/**
 * Sessions de toutes les caisses et caissières (gérante, `cash.manage`) : ouvertes d'abord, avec les
 * noms actuels de la caissière et de qui a clôturé.
 */
export async function listCashSessions(
  filters: { state?: 'open' | 'closed' | null; page?: number } = {},
): Promise<ReadOutcome<CashSessionPage>> {
  const page = filters.page ?? 1
  assertPage(page)
  const parameters = new URLSearchParams({ page: String(page) })
  if (filters.state !== undefined && filters.state !== null) parameters.set('state', filters.state)
  return answered(await apiRequest<CashSessionPage>('GET', `/api/v1/cash-sessions?${parameters}`))
}

/**
 * Relevé d'une session : la sienne (caissière) ou toute session (gérante). Tiroir espèces, mouvements,
 * encaissements ; relevé PROVISOIRE tant que la session est ouverte. Source du PDF du relevé.
 */
export async function getCashSessionReport(id: string): Promise<ReadOutcome<CashSessionReport>> {
  assertId(id, 'session de caisse')
  const response = await apiRequest<CashSessionReportResponse>(
    'GET',
    `/api/v1/cash-sessions/${encodeURIComponent(id)}/report`,
  )
  return answered(response.data)
}

/**
 * Mouvements hors vente d'une session (L1D05) et revue de son écart : la sienne (caissière) ou toute
 * session (gérante).
 */
export async function getCashSessionMovements(
  id: string,
): Promise<ReadOutcome<CashSessionMovements>> {
  assertId(id, 'session de caisse')
  const response = await apiRequest<CashSessionMovementsResponse>(
    'GET',
    `/api/v1/cash-sessions/${encodeURIComponent(id)}/movements`,
  )
  return answered(response.data)
}

/** Catégories de dépenses du cabinet (actives seulement sans `cash.manage`). */
export async function listExpenseCategories(): Promise<ReadOutcome<ExpenseCategory[]>> {
  const response = await apiRequest<ExpenseCategoryList>('GET', '/api/v1/expense-categories')
  return answered(response.data)
}

/**
 * « Caisse du jour » : encaissements nets par mode du jour civil du cabinet (aujourd'hui sans date). La
 * portée vient des droits du compte (`CLINIC` pour la gérante, `OWN` pour une caissière).
 */
export async function getCashDayReport(
  date: string | null = null,
): Promise<ReadOutcome<CashDayReport>> {
  const parameters = new URLSearchParams()
  if (date !== null) {
    assertCivilDate(date, 'Jour')
    parameters.set('date', date)
  }
  const query = parameters.toString()
  const response = await apiRequest<CashDayReportResponse>(
    'GET',
    `/api/v1/reports/cash-day${query === '' ? '' : `?${query}`}`,
  )
  return answered(response.data)
}

// --- Stock ------------------------------------------------------------------------------------------

/** Emplacements de stock actifs du cabinet (choix de l'emplacement du stock initial). */
export async function listStockLocations(): Promise<ReadOutcome<StockLocation[]>> {
  const response = await apiRequest<StockLocationList>('GET', '/api/v1/stock/locations')
  return answered(response.data)
}

/** Disponibilités par position (physique, réservé, quotas locaux) ; aucun coût ni valeur. */
export async function getStockAvailability(
  filters: { itemId?: string | null; page?: number } = {},
): Promise<ReadOutcome<StockAvailabilityPage>> {
  const page = filters.page ?? 1
  assertPage(page)
  const parameters = new URLSearchParams({ page: String(page) })
  if (filters.itemId !== undefined && filters.itemId !== null) {
    assertId(filters.itemId, 'article')
    parameters.set('item_id', filters.itemId)
  }
  return answered(
    await apiRequest<StockAvailabilityPage>('GET', `/api/v1/stock/availability?${parameters}`),
  )
}
