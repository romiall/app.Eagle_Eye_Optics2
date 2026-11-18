// @vitest-environment node
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { commandContract, commandNames } from '@/app/services/commandIndex'
import { directBody } from '@/app/services/mutations'

import {
  CONTRACTS_BASE_URI,
  CONTRACTS_ROOT,
  contractValidator,
  loadJson,
} from '../support/contracts'

/**
 * Le corps que le répartiteur envoie à la route directe est validé contre le `DirectRequest` du
 * contrat F06 de chaque commande, à partir des fixtures acceptées de sa charge (revue de F10 :
 * 16 commandes sur 26 auraient reçu un 422). La même charge part au journal du poste avec son numéro
 * et, sur la route directe, avec le numéro à null : le serveur numérote.
 */
interface Fixture {
  schema: string
  valid: boolean
  description: string
  data?: Record<string, unknown>
}

const FIXTURES = join(CONTRACTS_ROOT, 'fixtures', 'commands')

function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

/**
 * Charges acceptées de la commande : fixtures de son schéma de charge, et fixtures acceptées de sa
 * route directe (dont on retire `expected_version` pour retrouver la charge).
 */
function acceptedPayloads(name: string): { file: string; data: Record<string, unknown> }[] {
  return readdirSync(FIXTURES)
    .filter((file) => file.startsWith(`${kebab(name)}.`) && file.endsWith('.valid.json'))
    .sort()
    .flatMap((file) => {
      const fixture = loadJson(join(FIXTURES, file)) as Fixture
      if (!fixture.valid || !fixture.data) return []
      if (fixture.schema === `commands/${name}.v1.json`) return [{ file, data: fixture.data }]
      if (fixture.schema === `commands/${name}.v1.json#/$defs/DirectRequest`) {
        const payload = { ...fixture.data }
        delete payload['expected_version']
        return [{ file, data: payload }]
      }
      return []
    })
}

const ajv = contractValidator()

describe('corps des routes directes : conformes au DirectRequest du contrat', () => {
  it('couvre les 27 commandes', () => {
    expect(commandNames()).toHaveLength(27)
  })

  it.each(commandNames())('%s : charge acceptée → corps accepté', (name) => {
    const contract = commandContract(name)
    const validate = ajv.getSchema(
      `${CONTRACTS_BASE_URI}commands/${name}.v1.json#/$defs/DirectRequest`,
    )
    expect(validate, `DirectRequest de ${name}`).toBeTypeOf('function')

    const payloads = acceptedPayloads(name)
    expect(payloads.length, `fixture acceptée pour ${name}`).toBeGreaterThan(0)
    const versioned = contract.expectedVersion !== 'none' && contract.expectedVersion !== 'state'
    for (const { file, data } of payloads) {
      const body = directBody(contract, {
        name,
        payload: data,
        ...(versioned ? { expectedVersion: 3 } : {}),
        idempotencyKey: '01J9ZXK4M2Q8R7S6T5V4W3K001',
      })
      expect(validate?.(body), `${file} ${JSON.stringify(validate?.errors ?? [])}`).toBe(true)
      expect(body['expected_version']).toBe(versioned ? 3 : null)
      if (contract.directNumberField !== null) {
        expect(
          body[contract.directNumberField],
          `${file} numéro null sur la route directe`,
        ).toBeNull()
      }
    }
  })

  it('refuse une version sur une commande qui n’en a pas, et son absence sur les autres', () => {
    const payload = { anything: 1 }
    const key = '01J9ZXK4M2Q8R7S6T5V4W3K001'
    expect(() =>
      directBody(commandContract('CreatePatient'), {
        name: 'CreatePatient',
        payload,
        expectedVersion: 1,
        idempotencyKey: key,
      }),
    ).toThrow(/pas de version attendue/)
    expect(() =>
      directBody(commandContract('CloseCashSession'), {
        name: 'CloseCashSession',
        payload,
        expectedVersion: 1,
        idempotencyKey: key,
      }),
    ).toThrow(/pas de version attendue/)
    expect(() =>
      directBody(commandContract('UpdatePatient'), {
        name: 'UpdatePatient',
        payload,
        idempotencyKey: key,
      }),
    ).toThrow(/Version attendue obligatoire/)
  })

  it('le champ de numéro de chaque type de numéro est celui du DirectRequest (nul)', () => {
    const fields = new Map<string, string>()
    for (const name of commandNames()) {
      const contract = commandContract(name)
      if (contract.numberType !== null) {
        expect(contract.directNumberField, name).not.toBeNull()
        fields.set(name, `${contract.numberType}:${contract.directNumberField}`)
      } else {
        expect(contract.directNumberField, name).toBeNull()
      }
    }
    expect([...fields.entries()].sort()).toEqual([
      ['CreatePatient', 'PATIENT:record_number'],
      ['IssueCreditNote', 'CREDIT_NOTE:number'],
      ['IssueInvoice', 'INVOICE:number'],
      ['RefundCredit', 'REFUND:number'],
      ['RegisterPayment', 'RECEIPT:receipt_number'],
    ])
  })
})
