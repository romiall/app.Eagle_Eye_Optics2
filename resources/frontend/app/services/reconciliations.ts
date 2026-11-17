import { apiRequest, NetworkUnavailable } from '@/app/api'
import { sha256Hex } from '@/documents/engine/hash'
import type {
  AccountingExportReport,
  AccountingExportReportResponse,
  PaymentReconciliation,
  PaymentReconciliationCandidates,
  PaymentReconciliationCandidatesResponse,
  PaymentReconciliationPage,
  PaymentReconciliationResponse,
  PaymentReconciliationsMethod,
  PaymentReconciliationsStatus,
  StatementEvidence,
  StatementEvidenceResponse,
} from '@/domain/contracts/generated'
import { RuleViolation } from '@/domain/errors'

export const STATEMENT_EVIDENCE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const

function answered<T>(response: T): T {
  if (response === undefined) throw new NetworkUnavailable()
  return response
}

export async function listPaymentReconciliations(params: {
  method?: PaymentReconciliationsMethod
  status?: PaymentReconciliationsStatus
  page?: number
}): Promise<PaymentReconciliationPage> {
  const query = new URLSearchParams()
  if (params.method !== undefined) query.set('method', params.method)
  if (params.status !== undefined) query.set('status', params.status)
  if (params.page !== undefined) query.set('page', String(params.page))
  const suffix = query.toString()
  const path =
    suffix === '' ? '/api/v1/payment-reconciliations' : `/api/v1/payment-reconciliations?${suffix}`
  return answered(await apiRequest<PaymentReconciliationPage>('GET', path))
}

export async function getPaymentReconciliation(id: string): Promise<PaymentReconciliation> {
  const response = answered(
    await apiRequest<PaymentReconciliationResponse>(
      'GET',
      `/api/v1/payment-reconciliations/${encodeURIComponent(id)}`,
    ),
  )
  return response.data
}

export async function getPaymentReconciliationCandidates(params: {
  method: PaymentReconciliationsMethod
  periodStartsAt: string
  periodEndsAt: string
  reconciliationId?: string
}): Promise<PaymentReconciliationCandidates> {
  const query = new URLSearchParams({
    method: params.method,
    period_starts_at: params.periodStartsAt,
    period_ends_at: params.periodEndsAt,
  })
  if (params.reconciliationId !== undefined && params.reconciliationId !== '') {
    query.set('reconciliation_id', params.reconciliationId)
  }
  const response = answered(
    await apiRequest<PaymentReconciliationCandidatesResponse>(
      'GET',
      `/api/v1/payment-reconciliations/candidates?${query.toString()}`,
    ),
  )
  return response.data
}

export async function uploadStatementEvidence(file: File): Promise<StatementEvidence> {
  const type = (STATEMENT_EVIDENCE_TYPES as readonly string[]).includes(file.type) ? file.type : ''
  if (type === '') {
    throw RuleViolation.invalid(
      'content',
      'file.unsupported',
      'Déposez un PDF, une image JPEG ou PNG (relevé Mobile Money ou bancaire).',
    )
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const sha256 = await sha256Hex(bytes)
  const response = answered(
    await apiRequest<StatementEvidenceResponse>(
      'POST',
      '/api/v1/payment-reconciliations/statement-file',
      bytes,
      {
        'Content-Type': type,
        'X-Content-Sha256': sha256,
        'Idempotency-Key': `rec-ev-${sha256.slice(0, 32)}`,
      },
    ),
  )
  return response.data
}

export function statementFileUrl(fileId: string): string {
  return `/api/v1/payment-reconciliations/statement-file/${encodeURIComponent(fileId)}`
}

export async function getAccountingExport(
  from: string,
  to: string,
): Promise<AccountingExportReport> {
  const query = new URLSearchParams({ from, to })
  const response = answered(
    await apiRequest<AccountingExportReportResponse>(
      'GET',
      `/api/v1/reports/accounting-export?${query.toString()}`,
    ),
  )
  return response.data
}

export function accountingExportDownloadUrl(from: string, to: string): string {
  const query = new URLSearchParams({ from, to })
  return `/api/v1/reports/accounting-export/download?${query.toString()}`
}
