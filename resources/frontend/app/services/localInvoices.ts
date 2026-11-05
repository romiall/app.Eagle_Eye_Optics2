import { session } from '@/app/session'
import {
  foldLocalInvoices,
  isUnconsolidatedInvoice,
  type LocalInvoice,
  type LocalInvoiceContext,
} from '@/domain/billing/localInvoices'
import type { InvoiceClinicSnapshot } from '@/domain/contracts/generated'

import { localCatalog } from './localCatalog'
import { localPatients } from './localPatients'
import { localFinancialFacts } from './vault'

export { isUnconsolidatedInvoice }
export type { LocalInvoice }

/**
 * En-tête du cabinet figé à l'émission d'une facture du poste : le seul résumé du cabinet que le poste connaît (nom, fuseau,
 * monnaie, document de test) ; adresse, contacts, identifiant fiscal et mentions restent absents tant que le poste ne les a
 * pas reçus, jamais inventés (comme `clinicFromSummary` pour les documents).
 */
function clinicSnapshotOf(clinic: {
  id: string
  name: string
  timezone: string
  currency: 'XAF'
  production_documents_enabled: boolean
}): InvoiceClinicSnapshot {
  return {
    clinic_id: clinic.id,
    name: clinic.name,
    address: null,
    phone: null,
    email: null,
    tax_identifier: null,
    professional_mentions: null,
    document_settings: null,
    currency: clinic.currency,
    timezone: clinic.timezone,
    test_document: !clinic.production_documents_enabled,
  }
}

/**
 * Factures CRÉÉES sur CE poste (brouillons et factures émises), reconstruites par rejeu des faits financiers du journal
 * local (`domain/billing/localInvoices`) : vide tant que le coffre est fermé, que le module hors-ligne l'est, ou que le
 * profil n'a pas le compartiment financier. Lecture seule, jamais le réseau.
 */
export async function localInvoices(): Promise<Map<string, LocalInvoice>> {
  const records = await localFinancialFacts()
  const drafts = records.filter((record) => record.fact.commandName === 'CreateInvoiceDraft')
  if (drafts.length === 0) return new Map()
  // Identité des patients des factures du poste : fiches créées ici ou fiches du serveur reçues par le pull (celles-là seules).
  const patientIds = new Set<string>()
  for (const { fact } of drafts) {
    const patientId = fact.payload['patient_id']
    if (typeof patientId === 'string') patientIds.add(patientId)
  }
  const [catalog, patients] = await Promise.all([
    localCatalog(),
    localPatients({ ids: [...patientIds] }),
  ])
  const account = session.account
  const context: LocalInvoiceContext = {
    catalog,
    patient: (patientId) => {
      const known = patients.get(patientId)?.patient
      return known === undefined
        ? null
        : {
            patient_id: known.id,
            record_number: known.record_number,
            last_name: known.last_name,
            first_names: known.first_names,
          }
    },
    clinic: account === null ? null : clinicSnapshotOf(account.clinic),
    issuer: account === null ? null : { userId: account.id, displayName: account.display_name },
  }
  return foldLocalInvoices(records, context)
}
