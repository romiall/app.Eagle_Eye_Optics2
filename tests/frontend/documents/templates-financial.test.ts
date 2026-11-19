// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { EMPTY_DOCUMENT_SETTINGS } from '@/documents/data/clinic'
import {
  demoCashSession,
  demoClinic,
  demoDraftInvoice,
  demoInvoice,
  demoLongInvoice,
  demoQuote,
  demoReceiptDeposit,
  demoReceiptSettlement,
} from '@/documents/demo/fixtures'
import { NBSP } from '@/documents/engine/charset'
import { DocumentDataError } from '@/documents/engine/errors'
import { planPageLines } from '@/documents/engine/preview'
import { buildCashSessionReport } from '@/documents/templates/financial/cashSession'
import { buildInvoice } from '@/documents/templates/financial/invoice'
import { buildQuote } from '@/documents/templates/financial/quote'
import { buildReceipt } from '@/documents/templates/financial/receipt'

import { FORBIDDEN_WORDS, layout, outOfBounds, printedText } from './support'

const FCFA = (amount: string): string => `${amount.replace(/ /g, NBSP)}${NBSP}FCFA`
const NOW = '2026-10-22T09:00:00.000Z'

function failure(action: () => unknown): DocumentDataError {
  try {
    action()
  } catch (error) {
    if (error instanceof DocumentDataError) return error
    throw error
  }
  throw new Error('Une DocumentDataError était attendue.')
}

describe('facture (fichier 11)', () => {
  const model = buildInvoice(demoInvoice())
  const plan = layout(model)
  const text = printedText(plan)

  it('imprime l’en-tête du cabinet, le numéro, la date d’émission et l’identité facturée minimale', () => {
    // Le nom du cabinet fictif est plus large que la colonne de l'en-tête (13 pt gras) : il passe sur
    // deux lignes consécutives, sans rien perdre. Il se lit lignes jointes.
    expect(model.letterhead.organization).toBe('CABINET DE DÉMONSTRATION — DONNÉES FICTIVES')
    expect(text.replace(/\n/g, ' ')).toContain('CABINET DE DÉMONSTRATION — DONNÉES FICTIVES')
    expect(text).toContain('FACTURE')
    expect(text).toContain('Numéro | TEST-FAC-000001')
    expect(text).toContain('Date d’émission | 14/10/2026')
    expect(text).toContain('Facturé à | PATIENT FICTIF Élodie Marie')
    expect(text).toContain('Dossier n° | TEST-P-000001')
    expect(text).toContain('Établie par | Caisse (démonstration)')
  })

  it('imprime chaque ligne : référence, désignation, quantité, unité, prix, remise, total', () => {
    expect(text).toContain(
      `EX-001 | Examen de vue (fictif) | 1${NBSP}Prestation | 15${NBSP}000 | 0 | 15${NBSP}000`,
    )
    expect(text).toContain(
      `MT-001 | Monture fictive modèle Alpha | 1${NBSP}Unité | 25${NBSP}000 | 0 | 25${NBSP}000`,
    )
    expect(text).toContain(
      `VR-001 | Verres progressifs 1.60 (fictifs) | 1${NBSP}Paire | 45${NBSP}000 | 5${NBSP}000 | 40${NBSP}000`,
    )
  })

  it('imprime le total exact en FCFA et la mention du régime de taxe non configuré', () => {
    expect(text).toContain(`Total | ${FCFA('80 000')}`)
    expect(text).toContain(
      'Régime de taxe non configuré : aucune taxe n’est détaillée sur ce document.',
    )
    expect(text).not.toContain('Dont taxe')
  })

  it('porte le bandeau et le filigrane de TEST tant que les mentions ne sont pas validées', () => {
    expect(text).toContain('DOCUMENT DE TEST')
    expect(model.watermark).toBe('DONNÉES DE TEST')
    expect(model.meta.test).toBe(true)
    expect(text).toContain('Adresse du cabinet : à renseigner')
    expect(text).toContain('Identifiant fiscal : à renseigner')
    expect(text).toContain('Modèle TEST-1 · TEST-FAC-000001 · DOCUMENT DE TEST')
  })

  it('n’imprime jamais d’antécédent, de symptôme ni de réfraction sur une pièce financière', () => {
    for (const word of ['Antécédents', 'Symptômes', 'Réfraction', 'Sphère', 'Cylindre', 'Acuité']) {
      expect(text).not.toContain(word)
    }
  })

  it('ne dit jamais « payée », « soldée » ni « gratuit »', () => {
    for (const pattern of FORBIDDEN_WORDS) expect(text).not.toMatch(pattern)
  })

  it('tient dans la page et la propriété « Titre » du PDF ne contient aucun nom', () => {
    expect(outOfBounds(plan)).toEqual([])
    expect(model.title).toBe('Facture TEST-FAC-000001')
    expect(model.title).not.toContain('PATIENT')
  })

  it('mentionne l’état de paiement à l’émission seulement avec ses reçus', () => {
    const withReceipt = buildInvoice(
      demoInvoice({
        paymentAtIssue: {
          paidNet: 30000,
          balance: 50000,
          asOf: '2026-10-14T09:30:00.000Z',
          receiptNumbers: ['TEST-REC-000001'],
        },
      }),
    )
    const rendered = printedText(layout(withReceipt))

    expect(rendered).toContain(`Versé à l’émission | ${FCFA('30 000')} (reçus : TEST-REC-000001)`)
    expect(rendered).toContain(`Reste à régler à l’émission | ${FCFA('50 000')}`)
    expect(rendered).toContain('Situation à l’émission, au 14/10/2026 à 10h30')

    const error = failure(() =>
      buildInvoice(
        demoInvoice({
          paymentAtIssue: {
            paidNet: 30000,
            balance: 50000,
            asOf: '2026-10-14T09:30:00.000Z',
            receiptNumbers: [],
          },
        }),
      ),
    )
    expect(error.code).toBe('invoice.payment_without_receipt')

    const none = buildInvoice(
      demoInvoice({
        paymentAtIssue: {
          paidNet: 0,
          balance: 80000,
          asOf: '2026-10-14T09:30:00.000Z',
          receiptNumbers: [],
        },
      }),
    )
    expect(printedText(layout(none))).toContain('Aucun versement enregistré')
  })

  it('imprime l’échéance et les conditions de règlement seulement si elles sont définies', () => {
    expect(text).not.toContain('Échéance')
    expect(text).not.toContain('Conditions')
    const clinic = demoClinic({
      settings: {
        ...EMPTY_DOCUMENT_SETTINGS,
        paymentTerms: 'Conditions de règlement de démonstration.',
      },
    })
    const rendered = printedText(
      layout(buildInvoice(demoInvoice({ dueDate: '2026-11-14', clinic }))),
    )

    expect(rendered).toContain('Échéance | 14/11/2026')
    expect(rendered).toContain('Conditions | Conditions de règlement de démonstration.')
  })

  it('ventile la taxe seulement si un régime a été validé (aucune taxe inventée)', () => {
    const invoice = demoInvoice({
      tax: {
        regime: 'VALIDATED_RULES',
        rules: [
          {
            code: 'TAXE_DEMO',
            label: 'Taxe de démonstration',
            ratePercent: '10.0000',
            validatedAt: '2026-10-01T08:00:00.000Z',
            legalNote: 'Mention légale de démonstration.',
          },
        ],
      },
      lines: [
        {
          position: 1,
          reference: 'EX-001',
          description: 'Examen de vue (fictif)',
          unitCode: 'SERVICE',
          quantity: '1.000',
          unitPriceGross: 11000,
          discountGross: 0,
          lineTotalGross: 11000,
          taxCode: 'TAXE_DEMO',
          taxRatePercent: '10.0000',
          taxAmount: 1000,
        },
      ],
      totalGross: 11000,
    })
    const rendered = printedText(layout(buildInvoice(invoice)))

    expect(rendered).toContain('Dont taxe')
    expect(rendered).toContain(`dont Taxe de démonstration (10${NBSP}%) | ${FCFA('1 000')}`)
    expect(rendered).toContain('Taxe de démonstration : Mention légale de démonstration.')
    expect(rendered).not.toContain('Régime de taxe non configuré')
  })

  it('signale un écart entre une ligne et le calcul quantité × prix − remise, sans le cacher', () => {
    const invoice = demoInvoice()
    const lines = invoice.lines.map((line, index) =>
      index === 0 ? { ...line, lineTotalGross: 14000 } : line,
    )
    const rendered = buildInvoice({ ...invoice, lines, totalGross: 79000 })

    expect(rendered.warnings.join('\n')).toContain('Ligne n° 1')
  })

  it('refuse un total qui diffère de la somme des lignes', () => {
    expect(failure(() => buildInvoice(demoInvoice({ totalGross: 81000 }))).code).toBe(
      'invoice.total_mismatch',
    )
  })

  it('refuse une facture émise sans numéro, sans date ou sans ligne', () => {
    expect(failure(() => buildInvoice(demoInvoice({ number: null }))).code).toBe('text.required')
    expect(failure(() => buildInvoice(demoInvoice({ issuedAt: null }))).code).toBe(
      'instant.required',
    )
    expect(failure(() => buildInvoice(demoInvoice({ lines: [], totalGross: 0 }))).code).toBe(
      'invoice.no_lines',
    )
  })

  it('refuse un montant décimal ou négatif plutôt que de l’arrondir', () => {
    expect(failure(() => buildInvoice(demoInvoice({ totalGross: 80000.5 }))).code).toBe(
      'amount.invalid',
    )
    expect(failure(() => buildInvoice(demoInvoice({ totalGross: -1 }))).code).toBe(
      'amount.negative',
    )
  })

  it('imprime les cabinets en production sans bandeau de test, avec leurs mentions', () => {
    const clinic = demoClinic({
      testDocument: false,
      name: 'Cabinet de production fictif',
      address: 'Rue fictive, Ville fictive',
      phone: '+000 000 000',
      email: 'contact@exemple.invalid',
      taxIdentifier: 'IDENTIFIANT-FICTIF-1',
      professionalMentions: 'Mention professionnelle fictive',
      settings: {
        ...EMPTY_DOCUMENT_SETTINGS,
        headerLines: ['Ligne d’en-tête fictive'],
        footerLines: ['Pied fictif'],
      },
    })
    const model = buildInvoice(demoInvoice({ clinic }))
    const rendered = printedText(layout(model))

    expect(rendered).not.toContain('DOCUMENT DE TEST')
    expect(model.watermark).toBeNull()
    expect(model.warnings).toEqual([])
    for (const expected of [
      'Rue fictive, Ville fictive',
      'Tél. : +000 000 000',
      'Courriel : contact@exemple.invalid',
      'Identifiant fiscal : IDENTIFIANT-FICTIF-1',
      'Ligne d’en-tête fictive',
      'Mention professionnelle fictive',
      'Pied fictif',
    ]) {
      expect(rendered, expected).toContain(expected)
    }
    expect(rendered).not.toContain('à renseigner')
  })

  it('signale, sans les inventer, les mentions absentes d’un cabinet non marqué test', () => {
    const model = buildInvoice(demoInvoice({ clinic: demoClinic({ testDocument: false }) }))

    expect(model.warnings).toEqual([
      'Adresse du cabinet absente de la configuration.',
      'Identifiant fiscal du cabinet absent de la configuration.',
      'Mentions professionnelles du cabinet absentes de la configuration.',
    ])
    expect(printedText(layout(model))).not.toContain('à renseigner')
  })

  it('place le logo fourni par le cabinet à l’en-tête, jamais une image distante', () => {
    const logo = {
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      format: 'PNG' as const,
      widthMm: 60,
      heightMm: 30,
    }
    const plan = layout(buildInvoice(demoInvoice({ clinic: demoClinic({ logo }) })))
    const image = plan.pages[0]?.ops.find((op) => op.op === 'image')

    expect(image).toBeDefined()
    expect(image?.op === 'image' && image.logo.dataUrl.startsWith('data:')).toBe(true)
    expect(printedText(plan)).not.toContain('LOGO À FOURNIR')
  })

  it('réimpression : filigrane Duplicata et mention, le numéro de la pièce reste le même', () => {
    const model = buildInvoice(demoInvoice(), {
      copy: { kind: 'DUPLICATA', reprintNumber: 2, reprintedAt: '2026-10-22T08:30:00.000Z' },
    })
    const rendered = printedText(layout(model))

    expect(model.watermark).toBe('DUPLICATA')
    expect(rendered).toContain('DUPLICATA : réimpression n° 2 du 22/10/2026 à 09h30.')
    expect(rendered).toContain('Numéro | TEST-FAC-000001')
  })

  it('une facture en A5 ou en ticket garde un tableau compact lisible', () => {
    for (const format of ['A5', 'TICKET_80'] as const) {
      const compact = layout(buildInvoice(demoInvoice(), { format }))
      const rendered = printedText(compact)

      expect(rendered, format).toContain('Désignation | Qté | Total (FCFA)')
      expect(rendered, format).toContain(`40${NBSP}000`)
      expect(outOfBounds(compact), format).toEqual([])
    }
  })
})

describe('facture brouillon', () => {
  it('porte le filigrane BROUILLON, sans numéro définitif', () => {
    const model = buildInvoice(demoDraftInvoice(), { now: NOW })
    const text = printedText(layout(model))

    expect(model.watermark).toBe('BROUILLON')
    expect(model.meta.documentNumber).toBeNull()
    expect(text).toContain('Numéro | Non attribué (brouillon)')
    expect(text).toContain('Date du brouillon | 22/10/2026')
    expect(text).toContain('BROUILLON : sans numéro définitif')
    expect(text).not.toMatch(/FAC-\d/)
  })

  it('demande l’instant de génération (aucune date inventée)', () => {
    expect(failure(() => buildInvoice(demoDraftInvoice())).code).toBe('instant.required')
  })

  it('refuse un brouillon qui porte déjà un numéro définitif', () => {
    expect(failure(() => buildInvoice(demoInvoice({ status: 'DRAFT' }), { now: NOW })).code).toBe(
      'invoice.draft_with_number',
    )
  })

  it('refuse un duplicata de brouillon', () => {
    expect(
      failure(() =>
        buildInvoice(demoDraftInvoice(), {
          now: NOW,
          copy: { kind: 'DUPLICATA', reprintNumber: 1, reprintedAt: NOW },
        }),
      ).code,
    ).toBe('duplicate.draft')
  })
})

describe('facture longue (pagination, fichier 11)', () => {
  const invoice = demoLongInvoice(48)
  const plan = layout(buildInvoice(invoice))

  it('s’étend sur plusieurs pages avec l’en-tête des colonnes répété et tout dans les marges', () => {
    expect(plan.pages.length).toBeGreaterThan(1)
    plan.pages.forEach((page, index) => {
      expect(planPageLines(page).join('\n'), `page ${index + 1}`).toContain('Réf. | Désignation')
    })
    expect(outOfBounds(plan)).toEqual([])
  })

  it('imprime chaque ligne exactement une fois, sans ligne coupée', () => {
    const text = printedText(plan)
    for (const line of invoice.lines) {
      const reference = line.reference ?? ''
      expect(text.split(`${reference} |`).length - 1, reference).toBe(1)
    }
  })

  it('ne laisse jamais le total seul sur sa page : une ligne du tableau l’accompagne', () => {
    const last = plan.pages[plan.pages.length - 1]
    const lines = planPageLines(last ?? { ops: [] })

    expect(lines.some((line) => line.startsWith('Total | '))).toBe(true)
    expect(lines.some((line) => /^ART-\d{3} \|/.test(line))).toBe(true)
  })

  it('imprime un nom de patient très long sans le tronquer', () => {
    const text = printedText(plan)

    for (const word of ['AUX', 'NOMS', 'COMPOSÉS', 'TRÈS', 'LONGS', 'DISPONIBLE', 'Joséphine']) {
      expect(text).toContain(word)
    }
  })
})

describe('devis préparatoire', () => {
  it('ne vaut ni facture ni reçu et ne contient aucun règlement', () => {
    const model = buildQuote(demoQuote(), { now: NOW })
    const text = printedText(layout(model))

    expect(text).toContain('DEVIS (brouillon)')
    expect(text).toContain('Valable jusqu’au | 14/11/2026')
    expect(text).toContain('Ce devis n’est ni une facture ni un reçu')
    expect(text).toContain(`Total du devis | ${FCFA('80 000')}`)
    for (const pattern of FORBIDDEN_WORDS) expect(text).not.toMatch(pattern)
  })

  it('refuse un total qui ne correspond pas aux lignes', () => {
    expect(failure(() => buildQuote({ ...demoQuote(), totalGross: 1 }, { now: NOW })).code).toBe(
      'quote.total_mismatch',
    )
  })
})

describe('reçu de paiement (fichier 11)', () => {
  it('acompte : numéro, patient, facture, versement, mode, référence, cumul, reste, utilisateur', () => {
    const model = buildReceipt(demoReceiptDeposit())
    const text = printedText(layout(model))

    expect(text).toContain('REÇU DE PAIEMENT')
    expect(text).toContain('Acompte')
    expect(text).toContain('Numéro | TEST-REC-000001')
    expect(text).toContain('Reçu de | PATIENT FICTIF Élodie Marie')
    expect(text).toContain('Facture n° | TEST-FAC-000001')
    expect(text).toContain(`Montant du versement | ${FCFA('30 000')}`)
    expect(text).toContain('Mode de règlement | Mobile money MTN')
    expect(text).toContain('Référence | REFERENCE_FICTIVE')
    expect(text).toContain(`Total facturé | ${FCFA('80 000')}`)
    expect(text).toContain(`Cumul encaissé net avant ce versement | ${FCFA('0')}`)
    expect(text).toContain(`Cumul encaissé net après ce versement | ${FCFA('30 000')}`)
    expect(text).toContain(`Reste après ce versement | ${FCFA('50 000')}`)
    expect(text).toContain('Encaissé par | Caisse (démonstration)')
    expect(text).not.toContain('Règlement du solde')
    expect(model.meta.documentNumber).toBe('TEST-REC-000001')
  })

  it('règlement du solde : nature calculée, reste zéro, date du versement et date d’émission distinctes', () => {
    const text = printedText(layout(buildReceipt(demoReceiptSettlement())))

    expect(text).toContain('Règlement du solde')
    expect(text).not.toContain('Acompte')
    expect(text).toContain(`Reste après ce versement | ${FCFA('0')}`)
    expect(text).toContain('Versement du | 16/10/2026 à 14h58')
    expect(text).toContain('Émis le | 16/10/2026 à 15h05')
    expect(text).toContain(`Cumul encaissé net après ce versement | ${FCFA('80 000')}`)
  })

  it('une seule date quand le versement et l’émission coïncident', () => {
    const text = printedText(layout(buildReceipt(demoReceiptDeposit())))

    expect(text).toContain('Date | 14/10/2026 à 10h30')
    expect(text).not.toContain('Émis le')
  })

  it('ne dit jamais « payé », « soldé » ni « acquitté » : ni acompte ni solde ne l’affirment', () => {
    for (const data of [demoReceiptDeposit(), demoReceiptSettlement()]) {
      const text = printedText(layout(buildReceipt(data)))
      for (const pattern of FORBIDDEN_WORDS) expect(text).not.toMatch(pattern)
    }
  })

  it('rappelle qu’une réimpression restitue le même reçu sans nouvel encaissement', () => {
    expect(printedText(layout(buildReceipt(demoReceiptDeposit())))).toContain(
      'Une réimpression restitue ce même reçu, avec le même numéro ; elle n’enregistre aucun nouvel encaissement.',
    )
  })

  it('refuse un reçu incohérent : nature contredite, cumul faux, versement nul ou solde négatif', () => {
    const deposit = demoReceiptDeposit()
    expect(failure(() => buildReceipt({ ...deposit, kind: 'BALANCE_SETTLEMENT' })).code).toBe(
      'receipt.kind_mismatch',
    )
    expect(failure(() => buildReceipt({ ...deposit, paidNetAfter: 40000 })).code).toBe(
      'receipt.cumulative_mismatch',
    )
    expect(
      failure(() =>
        buildReceipt({
          ...deposit,
          payment: { ...deposit.payment, amount: 0 },
          paidNetAfter: 0,
        }),
      ).code,
    ).toBe('amount.not_positive')
    expect(
      failure(() => buildReceipt({ ...deposit, balanceAfter: -5, kind: 'DEPOSIT' })).code,
    ).toBe('receipt.negative_balance')
  })

  it('la référence absente n’imprime pas de ligne vide (espèces)', () => {
    const text = printedText(layout(buildReceipt(demoReceiptSettlement())))

    expect(text).toContain('Mode de règlement | Espèces')
    expect(text).not.toContain('Référence |')
  })

  it('ticket 80 mm : une page continue, mêmes montants, rien hors des marges', () => {
    const plan = layout(buildReceipt(demoReceiptDeposit(), { format: 'TICKET_80' }))
    const text = printedText(plan)

    expect(plan.pages).toHaveLength(1)
    expect(plan.format.widthMm).toBe(80)
    expect(text).toContain(FCFA('30 000'))
    expect(text).toContain(FCFA('50 000'))
    expect(text).toContain('TEST-REC-000001')
    expect(outOfBounds(plan)).toEqual([])
  })

  it('la même pièce donne le même modèle (aucune horloge dans le modèle d’une pièce émise)', () => {
    expect(buildReceipt(demoReceiptDeposit())).toEqual(buildReceipt(demoReceiptDeposit()))
    expect(buildInvoice(demoInvoice())).toEqual(buildInvoice(demoInvoice()))
  })
})

describe('relevé de caisse et clôture', () => {
  it('session clôturée : tiroir espèces, écart motivé, autres modes à part', () => {
    const text = printedText(layout(buildCashSessionReport(demoCashSession(true))))

    expect(text).toContain('CLÔTURE DE CAISSE')
    expect(text).toContain(`Fond de caisse à l’ouverture | ${FCFA('20 000')}`)
    expect(text).toContain(`Espèces attendues | ${FCFA('85 000')}`)
    expect(text).toContain(`Espèces comptées | ${FCFA('84 500')}`)
    expect(text).toContain(`Écart (comptées - attendues) | -500${NBSP}FCFA`)
    expect(text).toContain('Motif de l’écart | Erreur de rendu de monnaie (motif fictif).')
    expect(text).toContain('Autres modes de règlement')
    expect(text).toContain('Mobile money MTN')
    expect(text).toContain('Rapprochés à part')
    expect(text).not.toContain('RELEVÉ PROVISOIRE')
  })

  it('session ouverte : relevé provisoire, ni comptage ni écart inventés', () => {
    const text = printedText(layout(buildCashSessionReport(demoCashSession(false))))

    expect(text).toContain('RELEVÉ PROVISOIRE')
    expect(text).toContain('Clôture | Non clôturée')
    expect(text).not.toContain('Espèces comptées')
    expect(text).not.toContain('Écart')
  })

  it('refuse des espèces attendues qui ne suivent pas les mouvements', () => {
    expect(
      failure(() => buildCashSessionReport({ ...demoCashSession(true), expectedAmount: 86000 }))
        .code,
    ).toBe('cash.expected_mismatch')
    expect(
      failure(() => buildCashSessionReport({ ...demoCashSession(true), variance: 0 })).code,
    ).toBe('cash.variance_mismatch')
    expect(
      failure(() =>
        buildCashSessionReport({ ...demoCashSession(false), countedAmount: 85000, variance: 0 }),
      ).code,
    ).toBe('cash.count_before_close')
  })

  it('signale un écart sans motif', () => {
    const model = buildCashSessionReport({ ...demoCashSession(true), varianceReason: null })

    expect(model.warnings).toContain('Écart de caisse sans motif enregistré.')
    expect(printedText(layout(model))).toContain('Motif de l’écart | Non renseigné')
  })

  it('reste en A4 même si un autre format est demandé', () => {
    expect(buildCashSessionReport(demoCashSession(true), { format: 'TICKET_80' }).format).toBe('A4')
  })

  it('imprime le journal chronologique unifié (factures encaissées et dépenses) lorsque fourni', () => {
    const text = printedText(
      layout(
        buildCashSessionReport({
          ...demoCashSession(false),
          journal: [
            {
              at: '2026-10-16T08:15:00.000Z',
              entryType: 'PAYMENT',
              label: 'Facture TEST-FAC-000001',
              detail: 'Reçu TEST-REC-000001',
              method: 'CASH',
              amount: 25000,
            },
            {
              at: '2026-10-16T09:10:00.000Z',
              entryType: 'CASH_MOVEMENT',
              label: 'Dépense',
              detail: 'Fournitures · Papier A4',
              method: 'CASH',
              amount: -3500,
            },
          ],
        }),
      ),
    )

    expect(text).toContain('Journal chronologique de la caisse')
    expect(text).toContain('Date et heure | Opération | Patient / détail | Mode | Montant (FCFA)')
    expect(text).toContain(
      '16/10/2026 à 09h15 | Facture TEST-FAC-000001 | Reçu TEST-REC-000001 | Espèces | 25\u00a0000',
    )
    expect(text).toContain(
      '16/10/2026 à 10h10 | Dépense | Fournitures · Papier A4 | Espèces | -3\u00a0500',
    )
  })
})
