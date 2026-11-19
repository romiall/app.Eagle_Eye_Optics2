import type { CashSessionReportData } from '../../data/financial'
import { paymentMethodLabel } from '../../data/labels'
import { invalid } from '../../engine/errors'
import { formatDateFr, formatDateTimeFr, formatNumberFr, formatXaf } from '../../engine/format'
import {
  type Block,
  type DocumentModel,
  type FieldRow,
  fields,
  heading,
  notice,
  paragraph,
  row,
  signature,
  table,
  type TableColumn,
  totalRow,
  totals,
} from '../../engine/model'
import {
  assembleModel,
  type BuildOptions,
  requireInstant,
  requireMoney,
  resolveOptions,
} from '../common'

function column(
  key: string,
  header: string,
  width: TableColumn['width'],
  align: TableColumn['align'],
): TableColumn {
  return { key, header, width, align }
}

/**
 * Relevé de caisse et clôture (fichier 03, « Caisse et indicateurs »). Caisse espèces théorique =
 * ouverture + encaissements espèces + entrées autorisées − remboursements espèces − sorties
 * autorisées ; la clôture compare le comptage physique, exige un motif d'écart, puis fige la session.
 * Mobile money, virements et chèques sont rapprochés à part : ils n'entrent pas dans le tiroir. Une
 * session non clôturée donne un relevé PROVISOIRE (jamais un comptage ni un écart inventés).
 *
 * Format A4 uniquement. Pièce propre au poste : pas de `document_type` côté serveur pour l'instant.
 */
export function buildCashSessionReport(
  data: CashSessionReportData,
  options?: BuildOptions,
): DocumentModel {
  const resolved = resolveOptions({ ...options, format: 'A4' })
  requireInstant(data.openedAt, 'opened_at')
  requireMoney(data.openingAmount, 'opening_amount')
  requireMoney(data.cashReceived, 'cash_received')
  requireMoney(data.cashRefunded, 'cash_refunded')
  requireMoney(data.cashIn, 'cash_in')
  requireMoney(data.cashOut, 'cash_out')
  const closed = data.closedAt !== null
  const expected =
    data.openingAmount + data.cashReceived - data.cashRefunded + data.cashIn - data.cashOut
  if (expected !== data.expectedAmount) {
    throw invalid(
      'cash.expected_mismatch',
      'expected_amount',
      'Les espèces attendues ne correspondent pas aux mouvements de la session.',
    )
  }
  if (closed) {
    requireInstant(data.closedAt, 'closed_at')
    if (data.countedAmount === null || data.variance === null) {
      throw invalid('cash.count_missing', 'counted_amount', 'Une session clôturée a un comptage.')
    }
    if (data.variance !== data.countedAmount - data.expectedAmount) {
      throw invalid('cash.variance_mismatch', 'variance', 'L’écart ne correspond pas au comptage.')
    }
  } else if (data.countedAmount !== null || data.variance !== null) {
    throw invalid(
      'cash.count_before_close',
      'counted_amount',
      'Une session ouverte n’a ni comptage ni écart figés.',
    )
  }
  const timeZone = data.clinic.timezone

  const headerFields: FieldRow[] = [
    { label: 'Caissier(ère)', value: data.cashierName },
    { label: 'Ouverture', value: formatDateTimeFr(data.openedAt, timeZone) },
    {
      label: 'Clôture',
      value: data.closedAt === null ? 'Non clôturée' : formatDateTimeFr(data.closedAt, timeZone),
    },
  ]

  const drawer = [
    totalRow('Fond de caisse à l’ouverture', formatXaf(data.openingAmount, 'opening_amount')),
    totalRow('Encaissements en espèces', formatXaf(data.cashReceived, 'cash_received')),
    totalRow(
      'Remboursements en espèces (à déduire)',
      formatXaf(data.cashRefunded, 'cash_refunded'),
    ),
    totalRow('Entrées autorisées', formatXaf(data.cashIn, 'cash_in')),
    totalRow('Sorties autorisées (à déduire)', formatXaf(data.cashOut, 'cash_out')),
    totalRow('Espèces attendues', formatXaf(data.expectedAmount, 'expected_amount'), true),
  ]
  if (data.countedAmount !== null && data.variance !== null) {
    drawer.push(
      totalRow('Espèces comptées', formatXaf(data.countedAmount, 'counted_amount')),
      totalRow('Écart (comptées - attendues)', formatXaf(data.variance, 'variance'), true),
    )
  }

  const warnings: string[] = []
  const body: Block[] = []
  if (!closed) {
    body.push(
      notice(
        'warning',
        'RELEVÉ PROVISOIRE : la session n’est pas clôturée. Le comptage et l’écart ne sont pas encore figés.',
      ),
    )
  }
  body.push(heading('Tiroir espèces', 2), totals(drawer))
  if (data.variance !== null && data.variance !== 0) {
    const reason = data.varianceReason?.trim() ?? ''
    if (reason === '') warnings.push('Écart de caisse sans motif enregistré.')
    body.push(
      fields([{ label: 'Motif de l’écart', value: reason === '' ? 'Non renseigné' : reason }], 1),
    )
  }

  if (data.otherMethods.length > 0) {
    body.push(
      heading('Autres modes de règlement', 2),
      paragraph('Rapprochés à part : ces montants n’entrent pas dans le tiroir espèces.', {
        muted: true,
        sizePt: 8.5,
      }),
      table(
        'Règlements hors espèces',
        [
          column('method', 'Mode', { fr: 1 }, 'left'),
          column('count', 'Reçus', { mm: 24 }, 'right'),
          column('amount', 'Montant (FCFA)', { mm: 36 }, 'right'),
        ],
        data.otherMethods.map((entry) =>
          row([
            paymentMethodLabel(entry.method),
            String(entry.count),
            formatNumberFr(entry.amount, 'amount'),
          ]),
        ),
      ),
    )
  }

  if (data.movements.length > 0) {
    body.push(
      heading('Mouvements de caisse autorisés', 2),
      table(
        'Mouvements',
        [
          column('date', 'Date et heure', { mm: 38 }, 'left'),
          column('label', 'Libellé', { fr: 1 }, 'left'),
          column('amount', 'Montant (FCFA)', { mm: 36 }, 'right'),
        ],
        data.movements.map((movement) =>
          row([
            formatDateTimeFr(movement.at, timeZone),
            movement.label,
            formatNumberFr(movement.amount, 'amount'),
          ]),
        ),
      ),
    )
  }

  if (data.receipts.length > 0) {
    body.push(
      heading('Reçus de la session', 2),
      table(
        'Reçus',
        [
          column('receipt', 'Reçu n°', { fr: 1 }, 'left'),
          column('date', 'Date', { mm: 22 }, 'left'),
          column('invoice', 'Facture', { mm: 36 }, 'left'),
          column('method', 'Mode', { mm: 34 }, 'left'),
          column('amount', 'Montant (FCFA)', { mm: 30 }, 'right'),
        ],
        data.receipts.map((receipt) =>
          row([
            receipt.receiptNumber,
            formatDateFr(receipt.effectiveAt, timeZone),
            receipt.invoiceNumber,
            paymentMethodLabel(receipt.method),
            formatNumberFr(receipt.amount, 'amount'),
          ]),
        ),
        { sizePt: 8.5 },
      ),
    )
  }

  if (data.journal && data.journal.length > 0) {
    body.push(
      heading('Journal chronologique de la caisse', 2),
      table(
        'Journal chronologique',
        [
          column('date', 'Date et heure', { mm: 34 }, 'left'),
          column('label', 'Opération', { mm: 42 }, 'left'),
          column('detail', 'Patient / détail', { fr: 1 }, 'left'),
          column('method', 'Mode', { mm: 28 }, 'left'),
          column('amount', 'Montant (FCFA)', { mm: 30 }, 'right'),
        ],
        data.journal.map((entry) =>
          row([
            formatDateTimeFr(entry.at, timeZone),
            entry.label,
            entry.detail ?? '—',
            paymentMethodLabel(entry.method),
            formatNumberFr(entry.amount, 'amount'),
          ]),
        ),
        { sizePt: 8.5 },
      ),
    )
  }

  body.push(
    signature([
      { label: 'Caissier(ère)', heightMm: 20 },
      { label: closed ? 'Gérante (contrôle de clôture)' : 'Gérante', heightMm: 20 },
    ]),
  )

  return assembleModel({
    kind: 'CASH_SESSION_REPORT',
    templateVersion: data.templateVersion,
    clinic: data.clinic,
    options: resolved,
    family: 'financial',
    heading: closed ? 'CLÔTURE DE CAISSE' : 'RELEVÉ DE CAISSE',
    subtitle: closed ? 'Session clôturée' : 'Relevé provisoire',
    number: null,
    documentAt: data.closedAt ?? data.openedAt,
    draft: false,
    headerFields,
    pdfTitle: `Releve de caisse - ${formatDateFr(data.closedAt ?? data.openedAt, timeZone)}`,
    body,
    warnings,
  })
}
