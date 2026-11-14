// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { DEMO_DOCUMENTS } from '@/documents/demo/catalog'
import { demoInvoice, demoPrescription, demoReceiptDeposit } from '@/documents/demo/fixtures'
import { DocumentDataError } from '@/documents/engine/errors'
import { DOCUMENT_KIND_LABELS, type DocumentKind } from '@/documents/engine/model'
import {
  buildDocument,
  CLINICAL_TEMPLATE_VERSIONS,
  DOCUMENT_KINDS,
  hasTemplate,
  serverDocumentType,
  templateCompatibility,
  TEMPLATE_VERSION,
  templateVersionsOf,
} from '@/documents/templates/registry'

const ROOT = join(import.meta.dirname, '..', '..', '..')

describe('registre des modèles versionnés', () => {
  it('chaque type de document a le modèle TEST-1', () => {
    expect(DOCUMENT_KINDS.slice().sort()).toEqual(
      (Object.keys(DOCUMENT_KIND_LABELS) as DocumentKind[]).sort(),
    )
    for (const kind of DOCUMENT_KINDS) {
      expect(templateVersionsOf(kind), kind).toContain(TEMPLATE_VERSION)
      expect(hasTemplate(kind, TEMPLATE_VERSION), kind).toBe(true)
    }
  })

  it('accepte les noms de version déjà écrits par le serveur (invoice.v1, receipt.v1) comme alias', () => {
    expect(templateVersionsOf('INVOICE')).toEqual(['TEST-1', 'invoice.v1'])
    expect(templateVersionsOf('RECEIPT')).toEqual(['TEST-1', 'receipt.v1'])
    expect(templateVersionsOf('CREDIT_NOTE')).toEqual(['TEST-1', 'credit_note.v1'])
    expect(templateVersionsOf('REFUND')).toEqual(['TEST-1', 'refund.v1'])
    const receipt = buildDocument('RECEIPT', {
      ...demoReceiptDeposit(),
      templateVersion: 'receipt.v1',
    })
    const invoice = buildDocument('INVOICE', { ...demoInvoice(), templateVersion: 'invoice.v1' })

    expect(receipt.templateVersion).toBe('receipt.v1')
    expect(receipt.footerLines.at(-1)).toBe(
      'Modèle receipt.v1 · TEST-REC-000001 · DOCUMENT DE TEST',
    )
    expect(invoice.footerLines.at(-1)).toBe(
      'Modèle invoice.v1 · TEST-FAC-000001 · DOCUMENT DE TEST',
    )
  })

  it('construit une pièce avec la version de modèle de ses données', () => {
    const model = buildDocument('RECEIPT', demoReceiptDeposit())

    expect(model.kind).toBe('RECEIPT')
    expect(model.templateVersion).toBe(TEMPLATE_VERSION)
  })

  it('refuse une version de modèle inconnue : on ne régénère pas une pièce avec un autre modèle', () => {
    for (const build of [
      () => buildDocument('INVOICE', { ...demoInvoice(), templateVersion: 'TEST-0' }),
      () => buildDocument('OPTICAL_PRESCRIPTION', { ...demoPrescription(), templateVersion: '2' }),
      () => buildDocument('RECEIPT', { ...demoReceiptDeposit(), templateVersion: '__proto__' }),
      () => buildDocument('RECEIPT', { ...demoReceiptDeposit(), templateVersion: 'toString' }),
    ]) {
      try {
        build()
        throw new Error('Une erreur était attendue.')
      } catch (error) {
        expect(error).toBeInstanceOf(DocumentDataError)
        expect((error as DocumentDataError).code).toBe('template.unknown_version')
      }
    }
  })

  it('une ancienne version ajoutée plus tard resterait disponible à côté de la nouvelle', () => {
    // Le registre indexe par version : ajouter « 1 » n’efface pas « TEST-1 ». Contrôle de la structure.
    expect(templateVersionsOf('RECEIPT')).toContain('TEST-1')
    expect(new Set(templateVersionsOf('RECEIPT')).size).toBe(templateVersionsOf('RECEIPT').length)
  })
})

describe('correspondance avec le serveur', () => {
  it('les types propres au poste n’ont pas de document_type serveur', () => {
    expect(serverDocumentType('MEDICATION_ORDER')).toBeNull()
    expect(serverDocumentType('REFERRAL_LETTER')).toBeNull()
    expect(serverDocumentType('CASH_SESSION_REPORT')).toBeNull()
    expect(serverDocumentType('RECEIPT')).toBe('RECEIPT')
    expect(serverDocumentType('CLINICAL_RECORD')).toBe('CLINICAL_RECORD')
  })

  it('contracts/compatibility.json déclare exactement les modèles du registre connus du serveur', () => {
    const declared = (
      JSON.parse(readFileSync(join(ROOT, 'contracts', 'compatibility.json'), 'utf8')) as {
        document_templates: { document_type: string; template_version: string }[]
      }
    ).document_templates
    const key = (entry: { document_type: string; template_version: string }): string =>
      `${entry.document_type}|${entry.template_version}`

    expect(declared.map(key).sort()).toEqual(templateCompatibility().map(key).sort())
    // 9 types serveur en TEST-1, invoice.v1, receipt.v1, credit_note.v1, refund.v1, quote.v1, workshop.v1,
    // optical_prescription.v1, clinical_record.v1.
    expect(declared.length).toBe(17)
  })
})

describe('documents cliniques : convention <type>.v<n>', () => {
  it('chaque document clinique a sa version nommée d’après son type, à côté de TEST-1', () => {
    expect(CLINICAL_TEMPLATE_VERSIONS).toEqual({
      OPTICAL_PRESCRIPTION: 'optical_prescription.v1',
      CLINICAL_RECORD: 'clinical_record.v1',
      MEDICATION_ORDER: 'medication_order.v1',
      REFERRAL_LETTER: 'referral_letter.v1',
    })
    for (const [kind, version] of Object.entries(CLINICAL_TEMPLATE_VERSIONS)) {
      expect(templateVersionsOf(kind as DocumentKind)).toEqual([TEMPLATE_VERSION, version])
      expect(version).toMatch(/^[a-z_]+\.v[0-9]+$/)
      expect(version.split('.')[0]).toBe(kind.toLowerCase())
    }
  })

  it('le serveur écrit exactement la version de la prescription que le registre connaît', () => {
    const handler = readFileSync(
      join(ROOT, 'app', 'Domain', 'Clinical', 'Handlers', 'ValidatePrescriptionHandler.php'),
      'utf8',
    )
    const written = /public const TEMPLATE_VERSION = '([^']+)';/.exec(handler)?.[1]

    expect(written).toBe(CLINICAL_TEMPLATE_VERSIONS.OPTICAL_PRESCRIPTION)
    expect(hasTemplate('OPTICAL_PRESCRIPTION', written ?? '')).toBe(true)
  })

  it('la mention « test » n’est pas dans le nom : elle vient du cabinet (clinic.test_document)', () => {
    const model = buildDocument('OPTICAL_PRESCRIPTION', {
      ...demoPrescription(),
      templateVersion: CLINICAL_TEMPLATE_VERSIONS.OPTICAL_PRESCRIPTION,
    })

    expect(model.templateVersion).toBe('optical_prescription.v1')
    expect(model.meta.test).toBe(true)
    for (const version of Object.values(CLINICAL_TEMPLATE_VERSIONS)) {
      expect(version).not.toMatch(/demo|test/i)
    }
  })
})

describe('jeu de démonstration', () => {
  it('construit chaque document de démonstration sans erreur et donne un modèle cohérent', () => {
    expect(DEMO_DOCUMENTS.length).toBeGreaterThanOrEqual(15)
    expect(new Set(DEMO_DOCUMENTS.map((entry) => entry.id)).size).toBe(DEMO_DOCUMENTS.length)
    for (const entry of DEMO_DOCUMENTS) {
      const model = entry.build()
      expect(model.kind, entry.id).toBe(entry.kind)
      expect(model.schema, entry.id).toBe(1)
      expect(model.title, entry.id).not.toBe('')
      expect(model.meta.test, entry.id).toBe(true)
    }
  })

  it('le titre du PDF ne contient jamais le nom du patient fictif', () => {
    for (const entry of DEMO_DOCUMENTS) {
      const title = entry.build().title
      expect(title, entry.id).not.toMatch(/PATIENT|Élodie|FICTIF/i)
    }
  })

  it('les documents cliniques sont marqués comme tels pour le contrôle d’accès', () => {
    const clinical = DEMO_DOCUMENTS.filter((entry) => entry.clinical).map((entry) => entry.kind)

    expect(new Set(clinical)).toEqual(
      new Set(['OPTICAL_PRESCRIPTION', 'MEDICATION_ORDER', 'REFERRAL_LETTER', 'CLINICAL_RECORD']),
    )
  })
})
