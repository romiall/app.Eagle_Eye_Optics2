import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderDocument, type RenderedDocument } from '@/app/services/documents'
import { DEMO_DOCUMENTS } from '@/documents/demo/catalog'
import { DocumentDataError } from '@/documents/engine/errors'
import type { DocumentKind, DocumentModel } from '@/documents/engine/model'
import DocumentPreviewPage from '@/pages/documents/DocumentPreviewPage.vue'

import { fakeRendered } from './support'

const state = vi.hoisted(() => ({
  allowed: new Set<string>(),
  render: null as null | ((model: DocumentModel) => Promise<RenderedDocument>),
}))

vi.mock('@/app/services/documents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/services/documents')>()
  return {
    ...actual,
    mayOpen: (kind: DocumentKind) => state.allowed.has(kind),
    renderDocument: vi.fn((model: DocumentModel) => {
      if (state.render === null) throw new Error('Rendu non préparé.')
      return state.render(model)
    }),
  }
})

const FINANCIAL: DocumentKind[] = [
  'INVOICE',
  'QUOTE',
  'RECEIPT',
  'CREDIT_NOTE',
  'REFUND',
  'ACCOUNT_STATEMENT',
  'CASH_SESSION_REPORT',
]
const CLINICAL: DocumentKind[] = [
  'OPTICAL_PRESCRIPTION',
  'MEDICATION_ORDER',
  'REFERRAL_LETTER',
  'CLINICAL_RECORD',
]

async function mountPage() {
  const wrapper = mount(DocumentPreviewPage)
  await flushPromises()
  return wrapper
}

function lastKind(): string | undefined {
  const calls = vi.mocked(renderDocument).mock.calls
  return calls[calls.length - 1]?.[0].kind
}

describe('écran d’aperçu des documents (données fictives)', () => {
  beforeEach(() => {
    state.allowed = new Set<string>([...FINANCIAL, ...CLINICAL])
    state.render = async (model) => fakeRendered(model)
  })

  it('dit qu’il s’agit de données fictives, générées sur le poste, et que rien n’est conservé', async () => {
    const wrapper = await mountPage()

    expect(wrapper.get('h1').text()).toBe('Aperçu des documents')
    const text = wrapper.text()
    expect(text).toContain('Données fictives de démonstration : aucun patient réel.')
    expect(text).toContain('généré sur ce poste, sans réseau')
    expect(text).toContain('rien n’est envoyé ni imprimé automatiquement')
    expect(text).toContain('ne sont conservées nulle part')
  })

  it('propose tous les documents de démonstration et affiche le premier', async () => {
    const wrapper = await mountPage()
    const options = wrapper.findAll('option')

    expect(options).toHaveLength(DEMO_DOCUMENTS.length + 1)
    expect(options[0]?.text()).toBe('Choisir un document…')
    expect(wrapper.get('select').element.value).toBe(DEMO_DOCUMENTS[0]?.id)
    expect(vi.mocked(renderDocument)).toHaveBeenCalledTimes(1)
    expect(lastKind()).toBe('INVOICE')
    expect(wrapper.find('section[aria-label^="Aperçu"]').exists()).toBe(true)
    expect(wrapper.find('svg[role="img"]').exists()).toBe(true)
  })

  it('le libellé du champ est un vrai label relié à la liste', async () => {
    const wrapper = await mountPage()
    const select = wrapper.get('select')
    const label = wrapper.get(`label[for="${select.attributes('id')}"]`)

    expect(label.text()).toBe('Document à afficher')
  })

  it('changer de document génère le nouveau PDF et nomme l’aperçu', async () => {
    const wrapper = await mountPage()
    await wrapper.get('select').setValue('ordonnance')
    await flushPromises()

    expect(lastKind()).toBe('MEDICATION_ORDER')
    expect(wrapper.get('section[aria-label^="Aperçu"]').attributes('aria-label')).toBe(
      'Aperçu : Ordonnance de médicaments',
    )
  })

  it('choisir « aucun » vide l’aperçu sans rien générer', async () => {
    const wrapper = await mountPage()
    const calls = vi.mocked(renderDocument).mock.calls.length
    await wrapper.get('select').setValue('')
    await flushPromises()

    expect(vi.mocked(renderDocument).mock.calls).toHaveLength(calls)
    // L'aperçu est le seul `svg[role="img"]` : le chevron décoratif de la liste n'en est pas un.
    expect(wrapper.find('svg[role="img"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Choisissez un document pour l’afficher')
  })

  it('avec les seuls droits de caisse, aucun document clinique n’est proposé ni généré', async () => {
    state.allowed = new Set<string>(FINANCIAL)
    const wrapper = await mountPage()
    const labels = wrapper.findAll('option').map((option) => option.text())

    expect(labels.length).toBe(DEMO_DOCUMENTS.filter((entry) => !entry.clinical).length + 1)
    for (const forbidden of ['Prescription', 'Ordonnance', 'Lettre', 'Fiche de consultation']) {
      expect(
        labels.some((label) => label.includes(forbidden)),
        forbidden,
      ).toBe(false)
    }
    const kinds = vi.mocked(renderDocument).mock.calls.map((call) => call[0].kind)
    for (const kind of kinds) expect(CLINICAL).not.toContain(kind)
  })

  it('avec les seuls droits cliniques, aucune pièce financière n’est proposée', async () => {
    state.allowed = new Set<string>(CLINICAL)
    const wrapper = await mountPage()
    const labels = wrapper.findAll('option').map((option) => option.text())

    expect(labels.length).toBe(DEMO_DOCUMENTS.filter((entry) => entry.clinical).length + 1)
    for (const forbidden of ['Facture', 'Reçu', 'Avoir', 'État de compte', 'caisse']) {
      expect(
        labels.some((label) => label.includes(forbidden)),
        forbidden,
      ).toBe(false)
    }
  })

  it('sans aucun droit : message explicite, ni liste ni génération', async () => {
    state.allowed = new Set<string>()
    const wrapper = await mountPage()

    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.text()).toContain(
      'Aucun document de démonstration n’est accessible avec ces droits',
    )
    expect(vi.mocked(renderDocument)).not.toHaveBeenCalled()
  })

  it('affiche l’état de chargement pendant la génération', async () => {
    state.render = () => new Promise<RenderedDocument>(() => undefined)
    const wrapper = await mountPage()
    const loading = wrapper.get('[aria-busy="true"]')

    expect(loading.text()).toContain('Génération du PDF…')
    expect(wrapper.find('svg[role="img"]').exists()).toBe(false)
  })

  it('une erreur de données est dite avec son message sûr', async () => {
    state.render = async () => {
      throw new DocumentDataError(
        'invoice.total_mismatch',
        'total_gross',
        'Le total diffère des lignes.',
      )
    }
    const wrapper = await mountPage()
    const alert = wrapper.get('[role="alert"]')

    expect(alert.text()).toContain('Le document n’a pas pu être généré')
    expect(alert.text()).toContain('Le total diffère des lignes.')
  })

  it('toute autre erreur reste générique : aucun détail technique à l’écran', async () => {
    state.render = async () => {
      throw new Error('détail technique secret : valeur du document')
    }
    const wrapper = await mountPage()
    const alert = wrapper.get('[role="alert"]')

    expect(alert.text()).toContain('Le PDF n’a pas pu être généré sur ce poste.')
    expect(wrapper.text()).not.toContain('détail technique secret')
  })

  it('ignore le résultat tardif d’un document remplacé par un autre choix', async () => {
    const pending = new Map<string, (rendered: RenderedDocument) => void>()
    state.render = (model) =>
      new Promise<RenderedDocument>((resolve) => {
        pending.set(model.kind, resolve)
      })
    const wrapper = await mountPage()
    await wrapper.get('select').setValue('ordonnance')
    await flushPromises()

    const invoice = DEMO_DOCUMENTS.find((entry) => entry.id === 'facture-courte')?.build()
    const order = DEMO_DOCUMENTS.find((entry) => entry.id === 'ordonnance')?.build()
    if (invoice === undefined || order === undefined)
      throw new Error('Documents de démonstration absents.')
    pending.get('MEDICATION_ORDER')?.(fakeRendered(order))
    await flushPromises()
    pending.get('INVOICE')?.(fakeRendered(invoice))
    await flushPromises()

    expect(wrapper.get('section[aria-label^="Aperçu"]').attributes('aria-label')).toBe(
      'Aperçu : Ordonnance de médicaments',
    )
  })
})
