import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetDocumentStoreForTests } from '@/app/services/documents'
import type {
  WorkshopEligibleLines,
  WorkshopOrder,
  WorkshopOrderSummary,
  WorkshopOrdersStatus,
} from '@/domain/contracts/generated'

import {
  apiError,
  buttonByName,
  callsTo,
  click,
  dialogButton,
  forbiddenWordsIn,
  INVOICE_ID,
  json,
  MANAGER,
  openApp,
  PATIENT_ID,
  resetSales,
  selectInto,
  settle,
  stubSalesApi,
  textOf,
  typeInto,
} from '../billing/support'

vi.mock('@/documents/engine/pdf', async () => {
  const support = await import('../documents/support')
  return {
    renderDocument: (model: Parameters<typeof support.layout>[0]) => {
      const plan = support.layout(model)
      return {
        bytes: new TextEncoder().encode(`%PDF-fictif\n${support.printedText(plan)}`),
        pageCount: plan.pages.length,
        warnings: [...plan.warnings],
        plan,
      }
    },
  }
})

const WORKSHOP_PERMISSIONS = [...MANAGER, 'workshop.manage']

const ORDER_ID = '01J9ZXK4M2Q8R7S6T5V4W00001'
const ORDER_OVERDUE_ID = '01J9ZXK4M2Q8R7S6T5V4W00002'
const INVOICE_LINE_ID = '01J9ZXK4M2Q8R7S6T5V4W00010'
const LENS_ITEM_ID = '01J9ZXK4M2Q8R7S6T5V4W00011'
const RX_ID = '01J9ZXK4M2Q8R7S6T5V4W00020'
const SERIES_ID = '01J9ZXK4M2Q8R7S6T5V4W00021'
const LAB_ID = '01J9ZXK4M2Q8R7S6T5V4W00030'
const LAB_2_ID = '01J9ZXK4M2Q8R7S6T5V4W00031'
const FRAME_ID = '01J9ZXK4M2Q8R7S6T5V4W00040'
const DOC_ID = '01J9ZXK4M2Q8R7S6T5V4W00050'
const DELIVERY_LINE_ID = '01J9ZXK4M2Q8R7S6T5V4W00060'
const EVENT_ID = '01J9ZXK4M2Q8R7S6T5V4W00070'
const USER_ID = '01J9ZXK4M2Q8R7S6T5V4W00080'

const PAGE_META = { current_page: 1, last_page: 1, per_page: 25, total: 1 }

function makeSummary(overrides: Partial<WorkshopOrderSummary> = {}): WorkshopOrderSummary {
  return {
    id: ORDER_ID,
    reference: 'TEST-ATL-2026-000001',
    lab_reference: 'LAB-EXT-99',
    status: 'ORDERED',
    ready_revision: 0,
    version: 1,
    quantity: '1.000',
    ordered_at: '2026-10-20T09:00:00.000Z',
    expected_at: '2026-10-25T17:00:00.000Z',
    received_at: null,
    is_overdue: false,
    patient: {
      id: PATIENT_ID,
      record_number: 'TEST-P-000001',
      last_name: 'NDONGMO',
      first_names: 'Chantal',
    },
    supplier_id: LAB_ID,
    supplier_name: 'Labo Central Fictif',
    invoice_id: INVOICE_ID,
    invoice_number: 'TEST-FAC-2026-000001',
    invoice_line_id: INVOICE_LINE_ID,
    invoice_line_description: 'Verres progressifs Essilor (fictifs)',
    prescription_id: RX_ID,
    prescription_version_no: 1,
    frame_item_id: FRAME_ID,
    frame_reference: 'FR-001 — Monture fictive',
    document: {
      document_id: DOC_ID,
      document_status: 'PENDING',
    },
    ...overrides,
  }
}

function makeOrder(overrides: Partial<WorkshopOrder> = {}): WorkshopOrder {
  const { notes: overrideNotes, ...summaryOverrides } = overrides
  const base = makeSummary(summaryOverrides)
  const notes = overrideNotes !== undefined ? overrideNotes : 'Montage fin'
  return {
    ...base,
    notes,
    created_by: USER_ID,
    created_by_name: 'Opticienne Fictive',
    patient_id: PATIENT_ID,
    prescription: {
      id: RX_ID,
      series_id: SERIES_ID,
      version_no: 1,
      origin: 'INTERNAL',
      validated_at: '2026-10-19T14:00:00.000Z',
      usage_code: 'PERMANENT',
      lens_type_code: 'PROGRESSIVE',
      lens_index: '1.60',
      pd_total: '62.00',
      pd_od: '31.00',
      pd_og: '31.00',
    },
    supplier: {
      id: LAB_ID,
      name: 'Labo Central Fictif',
      reference: 'LAB-01',
      phone: '+237 699 00 00 01',
      email: 'labo@example.test',
    },
    frame: {
      id: FRAME_ID,
      reference: 'FR-001',
      name: 'Monture fictive',
      brand: 'OPTIX',
      model: 'M1',
    },
    snapshot: {
      schema: 1,
      workshop_order_id: base.id,
      reference: base.reference,
      lab_reference: base.lab_reference,
      ordered_at: base.ordered_at,
      expected_at: base.expected_at,
      quantity: base.quantity,
      notes,
      clinic: {
        clinic_id: '01J9ZXK4M2Q8R7S6T5V4W30069',
        name: 'CABINET DE DÉMONSTRATION — DONNÉES FICTIVES',
        address: 'Douala, Cameroun',
        phone: '+237 600 00 00 00',
        email: null,
        tax_identifier: null,
        professional_mentions: null,
        document_settings: null,
        currency: 'XAF',
        timezone: 'Africa/Douala',
        test_document: true,
      },
      patient: {
        patient_id: PATIENT_ID,
        record_number: 'TEST-P-000001',
      },
      supplier: {
        supplier_id: LAB_ID,
        name: 'Labo Central Fictif',
        reference: 'LAB-01',
        phone: '+237 699 00 00 01',
        email: 'labo@example.test',
      },
      frame: {
        frame_item_id: FRAME_ID,
        reference: 'FR-001',
        name: 'Monture fictive',
        brand: 'OPTIX',
        model: 'M1',
      },
      invoice_line: {
        invoice_id: INVOICE_ID,
        invoice_number: 'TEST-FAC-2026-000001',
        invoice_line_id: INVOICE_LINE_ID,
        description: 'Verres progressifs Essilor (fictifs)',
      },
      prescription: {
        prescription_id: RX_ID,
        series_id: SERIES_ID,
        version_no: 1,
        origin: 'INTERNAL',
        validated_at: '2026-10-19T14:00:00.000Z',
        external_prescriber: null,
        external_prescribed_on: null,
        usage_code: 'PERMANENT',
        usage_label: 'Port permanent',
        lens_type_code: 'PROGRESSIVE',
        lens_type_label: 'Progressif',
        lens_index: '1.60',
        lens_index_label: '1.60',
        pd_total: '62.00',
        pd_od: '31.00',
        pd_og: '31.00',
        pd_inconsistency_reason: null,
        notes: 'Centrage haut conseillé (fictif)',
        treatments: ['Anti-reflet'],
        eyes: [
          {
            eye: 'OD',
            sphere: '-1.25',
            cylinder: '-0.50',
            axis: 90,
            addition: '2.00',
            pd: '31.50',
            fitting_height: '21.00',
            lens_type: 'Progressif',
            lens_index: '1.60',
            treatments_snapshot: ['Anti-reflet'],
            frame_reference_snapshot: 'FR-001 — OPTIX M1',
          },
          {
            eye: 'OG',
            sphere: '-1.50',
            cylinder: null,
            axis: null,
            addition: '2.00',
            pd: '30.50',
            fitting_height: '21.50',
            lens_type: 'Progressif',
            lens_index: '1.60',
            treatments_snapshot: ['Anti-reflet'],
            frame_reference_snapshot: 'FR-001 — OPTIX M1',
          },
        ],
      },
      created_by: {
        user_id: USER_ID,
        display_name: 'Opticienne Fictive',
      },
      template_version: 'TEST-1',
    },
    eyes: [
      {
        id: '01J9ZXK4M2Q8R7S6T5V4W00071',
        eye: 'OD',
        sphere: '-1.25',
        cylinder: '-0.50',
        axis: 90,
        addition: '2.00',
        pd: '31.50',
        fitting_height: '21.00',
        lens_type: 'Progressif',
        lens_index: '1.60',
        treatments_snapshot: ['Anti-reflet'],
        frame_reference_snapshot: 'FR-001 — OPTIX M1',
      },
      {
        id: '01J9ZXK4M2Q8R7S6T5V4W00072',
        eye: 'OG',
        sphere: '-1.50',
        cylinder: null,
        axis: null,
        addition: '2.00',
        pd: '30.50',
        fitting_height: '21.50',
        lens_type: 'Progressif',
        lens_index: '1.60',
        treatments_snapshot: ['Anti-reflet'],
        frame_reference_snapshot: 'FR-001 — OPTIX M1',
      },
    ],
    events: [
      {
        id: EVENT_ID,
        sequence_no: 1,
        event_type: 'STATUS_CHANGE',
        previous_status: null,
        new_status: base.status,
        quality_result: 'NOT_APPLICABLE',
        observations: 'Création commande laboratoire',
        occurred_at: '2026-10-20T09:00:00.000Z',
        actor_id: USER_ID,
        actor_name: 'Opticienne Fictive',
        delivery_line_id: null,
      },
    ],
    eligible_delivery_lines: [],
    ...overrides,
  }
}

function makeEligible(): WorkshopEligibleLines {
  return {
    lines: [
      {
        invoice_line_id: INVOICE_LINE_ID,
        invoice_id: INVOICE_ID,
        invoice_number: 'TEST-FAC-2026-000001',
        issued_at: '2026-10-19T15:00:00.000Z',
        item_id: LENS_ITEM_ID,
        item_reference: 'DEMO-VERRES',
        category_code: 'LENS',
        description: 'Verres progressifs Essilor (fictifs)',
        quantity: '2.000',
        ordered_quantity: '1.000',
        remaining_quantity: '1.000',
        linked_prescription_id: RX_ID,
        patient: {
          id: PATIENT_ID,
          record_number: 'TEST-P-000001',
          last_name: 'NDONGMO',
          first_names: 'Chantal',
        },
      },
    ],
    prescriptions: [
      {
        id: RX_ID,
        series_id: SERIES_ID,
        patient_id: PATIENT_ID,
        version_no: 1,
        origin: 'INTERNAL',
        validated_at: '2026-10-19T14:00:00.000Z',
        usage_code: 'PERMANENT',
        usage_other: null,
        lens_type_code: 'PROGRESSIVE',
        lens_type_other: null,
        lens_index: '1.60',
        pd_total: '62.00',
        pd_od: '31.00',
        pd_og: '31.00',
        treatments: [{ term_code: 'ANTI_REFLECTIVE', other_text: null }],
        eyes: [
          {
            eye: 'OD',
            no_correction: false,
            sphere: '-1.25',
            cylinder: '-0.50',
            axis: 90,
            addition: '2.00',
            fitting_height: '21.00',
          },
          {
            eye: 'OG',
            no_correction: false,
            sphere: '-1.50',
            cylinder: null,
            axis: null,
            addition: '2.00',
            fitting_height: '21.50',
          },
        ],
      },
    ],
    suppliers: [
      {
        id: LAB_ID,
        name: 'Labo Central Fictif',
        reference: 'LAB-01',
        phone: '+237 699 00 00 01',
        email: 'labo@example.test',
      },
      {
        id: LAB_2_ID,
        name: 'Labo Express Fictif',
        reference: 'LAB-02',
        phone: null,
        email: null,
      },
    ],
    frames: [
      {
        id: FRAME_ID,
        reference: 'FR-001',
        name: 'Monture fictive',
        brand: 'OPTIX',
        model: 'M1',
      },
    ],
  }
}

beforeEach(() => {
  resetSales()
  resetDocumentStoreForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
  resetSales()
  resetDocumentStoreForTests()
})

describe('écrans de l’atelier optique (L1D04)', () => {
  it('liste les commandes, filtre par retard et par état sans exposer aucun montant financier', async () => {
    const api = stubSalesApi({ permissions: WORKSHOP_PERMISSIONS })
    const allOrders = [
      makeSummary({
        id: ORDER_ID,
        reference: 'TEST-ATL-2026-000001',
        status: 'READY',
        ready_revision: 2,
        document: { document_id: DOC_ID, document_status: 'READY' },
      }),
      makeSummary({
        id: ORDER_OVERDUE_ID,
        reference: 'TEST-ATL-2026-000002',
        status: 'ORDERED',
        is_overdue: true,
        expected_at: '2026-10-10T17:00:00.000Z',
        document: { document_id: DOC_ID, document_status: 'PENDING' },
      }),
    ]
    api.on('GET', /^\/api\/v1\/workshop-orders$/, (req) => {
      const overdue = req.query.get('overdue') === '1'
      const status = req.query.get('status') as WorkshopOrdersStatus | null
      const filtered = allOrders.filter(
        (order) => (!overdue || order.is_overdue) && (status === null || order.status === status),
      )
      return json(200, {
        data: filtered,
        meta: { ...PAGE_META, total: filtered.length },
      })
    })

    const { root, unmount } = await openApp('/atelier')
    const rendered = textOf(root)
    expect(rendered).toContain('Atelier optique')
    expect(rendered).toContain('TEST-ATL-2026-000001')
    expect(rendered).toContain('Prête révision 2')
    expect(rendered).toContain('Bon labo archivé')
    expect(rendered).toContain('En retard')
    expect(rendered).not.toMatch(/fcfa|xaf|60\s*000|40\s*000/i)
    expect(forbiddenWordsIn(root)).toEqual([])

    const overdueCheckbox = root.querySelector<HTMLInputElement>('#atelier-filtre-retard')
    expect(overdueCheckbox).not.toBeNull()
    overdueCheckbox!.checked = true
    overdueCheckbox!.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()

    await selectInto(root, 'atelier-filtre-statut', 'ORDERED')
    const listCalls = callsTo(api, 'GET', /^\/api\/v1\/workshop-orders$/)
    const lastQuery = listCalls[listCalls.length - 1]?.query
    expect(lastQuery?.get('overdue')).toBe('1')
    expect(lastQuery?.get('status')).toBe('ORDERED')
    expect(textOf(root)).toContain('TEST-ATL-2026-000002')
    expect(textOf(root)).not.toContain('TEST-ATL-2026-000001')
    unmount()
  })

  it('contrôle la saisie à la création, recherche une ligne éligible et crée la commande atelier', async () => {
    const api = stubSalesApi({ permissions: WORKSHOP_PERMISSIONS })
    const createdOrder = makeOrder()
    api.on('GET', /^\/api\/v1\/workshop-orders\/eligible-lines$/, () =>
      json(200, { data: makeEligible() }),
    )
    api.on('POST', /^\/api\/v1\/workshop-orders$/, () => json(201, { data: createdOrder }))
    api.on('GET', new RegExp(`^/api/v1/workshop-orders/${ORDER_ID}$`), () =>
      json(200, { data: createdOrder }),
    )

    const { root, unmount } = await openApp('/atelier/nouveau')
    expect(textOf(root)).toContain('Nouvelle commande atelier')

    // Envoi à vide -> résumé d'erreurs focusable sans aucun appel POST.
    await click(buttonByName(root, 'Créer la commande atelier'))
    expect(textOf(root)).toContain('Sélectionnez une ligne de facture admissible.')
    expect(callsTo(api, 'POST', /^\/api\/v1\/workshop-orders$/)).toHaveLength(0)

    // Recherche explicite côté serveur.
    await typeInto(root, 'atelier-recherche-ligne', 'TEST-FAC-2026-000001')
    await click(buttonByName(root, 'Rechercher'))
    const searchCalls = callsTo(api, 'GET', /^\/api\/v1\/workshop-orders\/eligible-lines$/)
    expect(searchCalls[searchCalls.length - 1]?.query.get('q')).toBe('TEST-FAC-2026-000001')

    // Sélection de la ligne -> affiche l'ordonnance validée et pré-remplit les défauts.
    const lineRadio = root.querySelector<HTMLInputElement>('input[name="atelier-invoice-line"]')
    expect(lineRadio).not.toBeNull()
    await click(lineRadio)
    expect(textOf(root)).toContain('2. Ordonnance optique validée')
    expect(textOf(root)).toContain('v1 (interne)')

    await selectInto(root, 'atelier-laboratoire', LAB_ID)
    await typeInto(root, 'atelier-dp-od', '31,5')
    await typeInto(root, 'atelier-date-prevue', '25/10/2026')
    await typeInto(root, 'atelier-reference-labo', 'LAB-EXT-99')
    await typeInto(root, 'atelier-notes', 'Montage fin')

    await click(buttonByName(root, 'Créer la commande atelier'))
    const posts = callsTo(api, 'POST', /^\/api\/v1\/workshop-orders$/)
    expect(posts).toHaveLength(1)
    expect(posts[0]?.headers['Idempotency-Key']).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(posts[0]?.body).toMatchObject({
      expected_version: null,
      invoice_line_id: INVOICE_LINE_ID,
      prescription_id: RX_ID,
      supplier_id: LAB_ID,
      quantity: '1.000',
      pd_od: '31.50',
      lab_reference: 'LAB-EXT-99',
      notes: 'Montage fin',
    })
    expect(textOf(root)).toContain('Commande atelier TEST-ATL-2026-000001 enregistrée.')
    expect(textOf(root)).toContain('Paramètres optiques figés')
    unmount()
  })

  it('génère le bon laboratoire anonymisé PDF puis déroule QC échoué, QC réussi, reprise et clôture sur remise physique', async () => {
    const api = stubSalesApi({ permissions: WORKSHOP_PERMISSIONS })
    let current = makeOrder({ status: 'QUALITY_CHECK', version: 4 })
    let deliveryCandidateAttached = false

    api.on('GET', new RegExp(`^/api/v1/workshop-orders/${ORDER_ID}$`), () =>
      json(200, { data: current }),
    )
    api.on('POST', new RegExp(`^/api/v1/documents/${DOC_ID}/content$`), () => {
      current = { ...current, document: { document_id: DOC_ID, document_status: 'READY' } }
      return json(200, {
        data: {
          id: DOC_ID,
          document_type: 'WORKSHOP',
          status: 'READY',
          sha256: 'a'.repeat(64),
        },
      })
    })
    api.on('POST', new RegExp(`^/api/v1/workshop-orders/${ORDER_ID}/advance$`), (req) => {
      const body = req.body ?? {}
      const eventType = String(body['event_type'] ?? '')
      if (eventType === 'QUALITY_CHECK' && body['quality_result'] === 'FAILED') {
        current = makeOrder({ status: 'MOUNTING', version: current.version + 1 })
      } else if (eventType === 'QUALITY_CHECK' && body['quality_result'] === 'PASSED') {
        current = makeOrder({
          status: 'READY',
          version: current.version + 1,
          ready_revision: current.ready_revision + 1,
          eligible_delivery_lines: deliveryCandidateAttached
            ? [
                {
                  delivery_line_id: DELIVERY_LINE_ID,
                  delivery_id: '01J9ZXK4M2Q8R7S6T5V4W00090',
                  delivered_at: '2026-10-25T11:00:00.000Z',
                  quantity: '1.000',
                  item_name: 'Verres progressifs Essilor (fictifs)',
                  batch_number: null,
                },
              ]
            : [],
        })
      } else if (eventType === 'STATUS_CHANGE' && body['new_status'] === 'QUALITY_CHECK') {
        current = makeOrder({
          status: 'QUALITY_CHECK',
          version: current.version + 1,
          ready_revision: current.ready_revision,
        })
      } else if (eventType === 'REWORK') {
        current = makeOrder({
          status: 'MOUNTING',
          version: current.version + 1,
          ready_revision: current.ready_revision,
        })
      } else if (eventType === 'STATUS_CHANGE' && body['new_status'] === 'DELIVERED') {
        current = makeOrder({
          status: 'DELIVERED',
          version: current.version + 1,
          ready_revision: current.ready_revision,
          eligible_delivery_lines: [],
        })
      }
      return json(200, { data: current })
    })

    const { root, unmount } = await openApp(`/atelier/${ORDER_ID}`)

    // 1. Génération du bon laboratoire anonymisé PDF et dépôt serveur.
    await click(buttonByName(root, 'Générer et afficher le bon laboratoire'))
    await vi.waitFor(() => {
      const deposits = callsTo(api, 'POST', new RegExp(`^/api/v1/documents/${DOC_ID}/content$`))
      expect(deposits).toHaveLength(1)
    })
    await vi.waitFor(() => {
      expect(textOf(root)).toContain('Original archivé sur le serveur')
    })
    const previewSection = root.querySelector('section[aria-label^="Aperçu : "]')
    expect(previewSection).not.toBeNull()
    expect(previewSection?.textContent).toContain('BON LABORATOIRE')
    expect(previewSection?.textContent).toContain('TEST-P-000001')
    expect(previewSection?.textContent).not.toContain('NDONGMO')
    expect(previewSection?.textContent).not.toContain('Chantal')

    // 2. QC non conforme exige d'abord une observation, puis renvoie en montage.
    await click(buttonByName(root, 'Non conforme : renvoyer en montage'))
    expect(textOf(root)).toContain(
      'Indiquez le motif de non-conformité avant de renvoyer en montage.',
    )

    await typeInto(root, 'atelier-qc-observations', 'Décentrement verres 1mm')
    await click(buttonByName(root, 'Non conforme : renvoyer en montage'))
    expect(textOf(root)).toContain('En montage')

    // 3. Nouveau passage en contrôle qualité puis conforme -> Prête sans remise confirmée.
    await click(buttonByName(root, 'Envoyer au contrôle qualité'))
    await click(buttonByName(root, 'Valider : conforme (prête)'))
    expect(textOf(root)).toContain('Remise physique attendue avant clôture')
    expect(buttonByName(root, 'Confirmer la remise au patient')).toBeNull()

    // 4. Reprise en montage, puis retour au contrôle qualité avec remise patient confirmée -> DELIVERED.
    await typeInto(root, 'atelier-reprise-observations', 'Client signale gêne bord monture')
    await click(buttonByName(root, 'Enregistrer la reprise'))
    deliveryCandidateAttached = true
    await click(buttonByName(root, 'Envoyer au contrôle qualité'))
    await click(buttonByName(root, 'Valider : conforme (prête)'))
    expect(textOf(root)).toContain('Prête révision 2')

    await selectInto(root, 'atelier-remise-ligne', DELIVERY_LINE_ID)
    await click(buttonByName(root, 'Confirmer la remise au patient'))

    const advanceCalls = callsTo(
      api,
      'POST',
      new RegExp(`^/api/v1/workshop-orders/${ORDER_ID}/advance$`),
    )
    expect(advanceCalls[advanceCalls.length - 1]?.body).toMatchObject({
      workshop_order_id: ORDER_ID,
      event_type: 'STATUS_CHANGE',
      new_status: 'DELIVERED',
      delivery_line_id: DELIVERY_LINE_ID,
    })
    expect(textOf(root)).toContain('Remise au patient')
    expect(textOf(root)).toContain('Cette commande est dans un état final')
    expect(forbiddenWordsIn(root)).toEqual([])
    unmount()
  })

  it('gère un conflit optimiste 409 puis l’annulation confirmée par dialogue', async () => {
    const api = stubSalesApi({ permissions: WORKSHOP_PERMISSIONS })
    let current = makeOrder({ status: 'ORDERED', version: 1 })
    api.on('GET', new RegExp(`^/api/v1/workshop-orders/${ORDER_ID}$`), () =>
      json(200, { data: current }),
    )
    let conflictDone = false
    api.on('POST', new RegExp(`^/api/v1/workshop-orders/${ORDER_ID}/advance$`), (req) => {
      const eventType = String(req.body?.['event_type'] ?? '')
      if (!conflictDone && eventType === 'STATUS_CHANGE') {
        conflictDone = true
        return apiError(409, 'VERSION_CONFLICT', 'La commande a été modifiée ailleurs.')
      }
      if (eventType === 'CANCEL') {
        current = makeOrder({ status: 'CANCELLED', version: current.version + 1 })
        return json(200, { data: current })
      }
      return json(200, { data: current })
    })

    const { root, unmount } = await openApp(`/atelier/${ORDER_ID}`)
    await click(buttonByName(root, 'Enregistrer la réception labo'))
    expect(textOf(root)).toContain('La commande a été modifiée ailleurs.')

    await typeInto(root, 'atelier-annulation-motif', 'Doublon saisi par erreur')
    await click(buttonByName(root, 'Annuler cette commande'))
    const confirmBtn = dialogButton(root, 'Confirmer l’annulation')
    expect(confirmBtn).not.toBeNull()
    await click(confirmBtn)

    expect(textOf(root)).toContain('Annulée')
    expect(textOf(root)).toContain('Cette commande est dans un état final')
    unmount()
  })
})
