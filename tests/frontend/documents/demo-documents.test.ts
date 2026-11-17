// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { isClinicalDocument } from '@/documents/access'
import { DEMO_DOCUMENTS } from '@/documents/demo/catalog'
import type { Block, DocumentModel } from '@/documents/engine/model'

import { FORBIDDEN_WORDS, layout, outOfBounds, printedText } from './support'

/** Toutes les tables du modèle, groupes compris. */
function tables(blocks: readonly Block[]): Extract<Block, { kind: 'table' }>[] {
  return blocks.flatMap((block) => {
    if (block.kind === 'table') return [block]
    if (block.kind === 'group') return tables(block.blocks)
    return []
  })
}

describe.each(DEMO_DOCUMENTS.map((entry) => [entry.id, entry] as const))(
  'document de démonstration « %s »',
  (_id, entry) => {
    const model: DocumentModel = entry.build()
    const plan = layout(model)
    const text = printedText(plan)

    it('est un document de test marqué : bandeau, filigrane ou ticket, pied de page versionné', () => {
      expect(text).toContain('DOCUMENT DE TEST')
      expect(model.watermark).not.toBeNull()
      expect(text).toContain('Modèle TEST-1')
      expect(model.meta.test).toBe(true)
    })

    it('ne dit jamais « payé », « soldé », « acquitté », « gratuit » ni « réglé »', () => {
      for (const pattern of FORBIDDEN_WORDS) expect(text).not.toMatch(pattern)
    })

    it('imprime ses montants avec des espaces insécables, jamais d’espace ordinaire avant FCFA', () => {
      expect(text).not.toMatch(/\d FCFA/)
      expect(text).not.toMatch(/\d \d{3}\u{A0}FCFA/u)
      expect(text).not.toContain('\u{202F}')
    })

    it('tient dans les marges de la page', () => {
      expect(outOfBounds(plan)).toEqual([])
    })

    it('chaque ligne de tableau a exactement une cellule par colonne', () => {
      for (const block of tables(model.body)) {
        for (const row of block.rows) {
          expect(row.cells.length, `${block.caption}`).toBe(block.columns.length)
        }
      }
    })

    it('la propriété « Titre » du PDF ne contient aucun nom de personne ni numéro de dossier', () => {
      expect(model.title).not.toMatch(/PATIENT|Élodie|FICTIF|TEST-P-/i)
    })

    it('est reproductible : même entrée, même modèle', () => {
      expect(entry.build()).toEqual(model)
    })

    it('sépare les mondes : une pièce financière sans donnée clinique, un document clinique sans montant', () => {
      if (isClinicalDocument(entry.kind)) {
        expect(text).not.toContain('FCFA')
      } else if (entry.kind === 'WORKSHOP') {
        expect(text).not.toContain('FCFA')
        for (const word of [
          'Antécédents',
          'Symptômes',
          'Réfraction',
          'urgence',
          'PATIENT FICTIF',
        ]) {
          expect(text, word).not.toContain(word)
        }
      } else {
        for (const word of ['Antécédents', 'Symptômes', 'Réfraction', 'Sphère', 'Acuité']) {
          expect(text, word).not.toContain(word)
        }
        expect(text).not.toContain('urgence')
      }
    })

    it('numérote ses pages (sauf le ticket continu)', () => {
      if (model.format === 'TICKET_80') {
        expect(plan.pages).toHaveLength(1)
        expect(text).not.toContain('Page 1/')
      } else {
        expect(text).toContain(`Page 1/${plan.pages.length}`)
      }
    })
  },
)

describe('jeu de démonstration : couverture', () => {
  it('couvre tous les types de documents du moteur', () => {
    const kinds = new Set(DEMO_DOCUMENTS.map((entry) => entry.kind))

    for (const kind of [
      'INVOICE',
      'QUOTE',
      'RECEIPT',
      'CREDIT_NOTE',
      'REFUND',
      'ACCOUNT_STATEMENT',
      'CASH_SESSION_REPORT',
      'OPTICAL_PRESCRIPTION',
      'MEDICATION_ORDER',
      'REFERRAL_LETTER',
      'CLINICAL_RECORD',
    ]) {
      expect(kinds.has(kind as never), kind).toBe(true)
    }
  })

  it('contient une facture longue sur plusieurs pages et un ticket sur une page', () => {
    const long = layout(DEMO_DOCUMENTS.find((entry) => entry.id === 'facture-longue')!.build())
    const ticket = layout(DEMO_DOCUMENTS.find((entry) => entry.id === 'recu-ticket')!.build())

    expect(long.pages.length).toBeGreaterThan(1)
    expect(ticket.pages).toHaveLength(1)
  })
})
