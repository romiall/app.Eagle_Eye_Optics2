import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  Publication,
  PublicContentEntry,
  PublicContentRevision,
} from '@/domain/contracts/generated'

import {
  buttonByName,
  callsTo,
  catalogItem,
  click,
  dialogButton,
  forbiddenWordsIn,
  json,
  MANAGER,
  openApp,
  resetSales,
  selectInto,
  settle,
  stubSalesApi,
  textOf,
  typeInto,
  type SalesApi,
} from '../billing/support'
import { ALL_TEST_MODULES } from '../shell/server'

// Écran de la gérante pour le site public (L3D02, EE039), EN LIGNE, droit `site.publish` : fiches du showroom, images
// (texte alternatif et note de droits), contenus ; brouillon d'abord, publication confirmée par le mot de passe.
// Données FICTIVES. Identifiants au format ULID (alphabet de Crockford : ni I, L, O ni U).
// Le premier test d'un fichier charge l'application entière : sur un poste chargé, 5 s ne suffisent pas.
vi.setConfig({ testTimeout: 30_000 })

afterEach(() => {
  resetSales()
})

const PERMISSIONS = [...MANAGER, 'site.publish']
const MODULES = [...ALL_TEST_MODULES, 'communication']
const PUBLICATION_ID = '01J9ZXK4M2Q8R7S6T5V4WQ0001'
const MEDIA_ID = '01J9ZXK4M2Q8R7S6T5V4WQ0002'
const FRAME_ID = '01J9ZXK4M2Q8R7S6T5V4WF0001'
const DROPS_ID = '01J9ZXK4M2Q8R7S6T5V4WD0001'
const DRAFT_REVISION_ID = '01J9ZXK4M2Q8R7S6T5V4WH0001'
const PUBLISHED_REVISION_ID = '01J9ZXK4M2Q8R7S6T5V4WH0002'
const PAGE_META = { current_page: 1, last_page: 1, per_page: 25, total: 1 }
const REAUTH_ERROR = {
  error: { code: 'REAUTHENTICATION_REQUIRED', message: 'Confirmez votre mot de passe.' },
  correlation_id: 'corr-test-0900',
}

function publication(overrides: Partial<Publication> = {}): Publication {
  return {
    id: PUBLICATION_ID,
    catalog_item_id: FRAME_ID,
    item_name: 'Monture fictive',
    item_reference: 'FR-001',
    item_eligible: true,
    slug: 'monture-legere-fictive',
    public_title: 'Monture légère fictive',
    public_description: 'Une monture légère pour tous les jours, donnée fictive.',
    style: 'classique',
    show_sale_price: false,
    sale_price: 45000,
    status: 'DRAFT',
    display_order: 0,
    published_at: null,
    version: 3,
    media: [],
    ...overrides,
  } as Publication
}

function revision(overrides: Partial<PublicContentRevision> = {}): PublicContentRevision {
  return {
    id: PUBLISHED_REVISION_ID,
    code: 'ACCUEIL',
    title: 'Bienvenue',
    content: 'Texte d’accueil fictif.',
    revision_no: 1,
    status: 'PUBLISHED',
    published_at: '2026-11-01T08:00:00.000Z',
    version: 2,
    ...overrides,
  } as PublicContentRevision
}

function entry(overrides: Partial<PublicContentEntry> = {}): PublicContentEntry {
  return {
    code: 'ACCUEIL',
    label: 'Accueil',
    published: null,
    draft: null,
    ...overrides,
  } as PublicContentEntry
}

const FRAME = catalogItem({
  id: FRAME_ID,
  reference: 'FR-001',
  name: 'Monture fictive',
  public_visibility: true,
})
const DROPS = catalogItem({
  id: DROPS_ID,
  reference: 'CO-001',
  name: 'Collyre fictif',
  public_visibility: false,
})

function stubSite(
  api: SalesApi,
  data: { publications?: Publication[]; contents?: PublicContentEntry[] } = {},
): void {
  const publications = data.publications ?? [publication()]
  api.on('GET', /^\/api\/v1\/publications$/, () =>
    json(200, { data: publications, meta: { ...PAGE_META, total: publications.length } }),
  )
  api.on('GET', /^\/api\/v1\/public-contents$/, () =>
    json(200, {
      data: data.contents ?? [
        entry(),
        entry({ code: 'HORAIRES', label: 'Horaires' }),
        entry({ code: 'WHATSAPP', label: 'WhatsApp' }),
      ],
    }),
  )
  api.on('GET', /^\/api\/v1\/catalog$/, () =>
    json(200, { data: [FRAME, DROPS], meta: { ...PAGE_META, total: 2 } }),
  )
}

function openSite() {
  return openApp('/communication/site')
}

/** Bouton nommé par son nom accessible (les boutons d'une liste portent l'objet de l'action). */
function byLabel(root: ParentNode, label: string): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
}

function site(overrides: { permissions?: string[] } = {}): SalesApi {
  return stubSalesApi({ permissions: overrides.permissions ?? PERMISSIONS, modules: MODULES })
}

describe('écran du site public', () => {
  it('lit les fiches et les contenus : état, images avec droits, version publiée et brouillon en cours', async () => {
    const api = site()
    stubSite(api, {
      publications: [
        publication({
          status: 'PUBLISHED',
          published_at: '2026-11-02T09:00:00.000Z',
          media: [
            {
              id: MEDIA_ID,
              alt_text: 'Monture vue de face',
              rights_note: 'Photo du cabinet, publication autorisée',
              display_order: 0,
              approved_at: '2026-11-02T08:30:00.000Z',
            },
          ],
        }),
      ],
      contents: [
        entry({
          published: revision(),
          draft: revision({
            id: DRAFT_REVISION_ID,
            status: 'DRAFT',
            title: 'Bienvenue 2',
            published_at: null,
            revision_no: 2,
          }),
        }),
      ],
    })

    const { root, unmount } = await openSite()

    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Site public : showroom et contenus')
    const text = textOf(root)
    expect(text).toContain('Monture légère fictive')
    expect(text).toContain('Publiée sur le site')
    expect(text).toContain('Article du catalogue : Monture fictive (FR-001)')
    expect(text).toContain('Prix non montré au public.')
    expect(text).toContain('Droits : Photo du cabinet, publication autorisée')
    const image = root.querySelector<HTMLImageElement>(
      `img[src="/api/v1/publication-media/${MEDIA_ID}"]`,
    )
    expect(image?.getAttribute('alt')).toBe('Monture vue de face')
    expect(text).toContain('Vu du public : Texte d’accueil fictif.')
    expect(text).toContain('Un brouillon est en cours')
    expect(forbiddenWordsIn(root)).toEqual([])
    unmount()
  })

  it('ne propose pour une nouvelle fiche que les articles visibles au public', async () => {
    const api = site()
    stubSite(api)

    const { root, unmount } = await openSite()

    const options = [
      ...root.querySelectorAll<HTMLOptionElement>('[id="fiche-article"] option'),
    ].map((option) => option.textContent?.trim())
    expect(options).toContain('Monture fictive (FR-001)')
    expect(options).not.toContain('Collyre fictif (CO-001)')
    unmount()
  })

  it('refuse une fiche incomplète sans appeler le serveur, en nommant les champs', async () => {
    const api = site()
    stubSite(api)

    const { root, unmount } = await openSite()
    await click(buttonByName(root, 'Enregistrer la fiche en brouillon'))

    const text = textOf(root)
    expect(text).toContain('Choisissez l’article du catalogue décrit par la fiche.')
    expect(text).toContain('Le titre public compte de 2 à 180 caractères.')
    expect(text).toContain('La description publique compte de 10 à 2000 caractères.')
    expect(callsTo(api, 'POST', /^\/api\/v1\/publications$/)).toHaveLength(0)
    unmount()
  })

  it('enregistre une nouvelle fiche en brouillon : version nulle, article choisi, prix non montré', async () => {
    const api = site()
    stubSite(api)
    api.on('POST', /^\/api\/v1\/publications$/, () => json(201, { data: publication() }))

    const { root, unmount } = await openSite()
    await selectInto(root, 'fiche-article', FRAME_ID)
    await typeInto(root, 'fiche-titre', 'Monture légère fictive')
    await typeInto(
      root,
      'fiche-description',
      'Une monture légère pour tous les jours, donnée fictive.',
    )
    await click(buttonByName(root, 'Enregistrer la fiche en brouillon'))
    await vi.waitFor(() =>
      expect(callsTo(api, 'POST', /^\/api\/v1\/publications$/)).toHaveLength(1),
    )

    const [post] = callsTo(api, 'POST', /^\/api\/v1\/publications$/)
    expect(post?.body).toEqual({
      expected_version: null,
      catalog_item_id: FRAME_ID,
      public_title: 'Monture légère fictive',
      public_description: 'Une monture légère pour tous les jours, donnée fictive.',
      style: null,
      show_sale_price: false,
      display_order: 0,
    })
    expect(post?.headers['Idempotency-Key']).toBeTruthy()
    await vi.waitFor(() =>
      expect(textOf(root)).toContain(
        'Fiche enregistrée en brouillon : elle n’est pas visible du public',
      ),
    )
    unmount()
  })

  it('modifie une fiche avec la version lue et dit qu’elle repasse en brouillon', async () => {
    const api = site()
    stubSite(api, {
      publications: [
        publication({ status: 'PUBLISHED', published_at: '2026-11-02T09:00:00.000Z' }),
      ],
    })
    api.on('PATCH', /^\/api\/v1\/publications\/[^/]+$/, () => json(200, { data: publication() }))

    const { root, unmount } = await openSite()
    await click(byLabel(root, 'Modifier la fiche Monture légère fictive'))
    expect(textOf(root)).toContain('Modifier une fiche la remet en brouillon')
    await typeInto(root, 'fiche-titre', 'Monture légère fictive, nouveau titre')
    await click(buttonByName(root, 'Enregistrer les modifications'))
    await vi.waitFor(() =>
      expect(callsTo(api, 'PATCH', /^\/api\/v1\/publications\/[^/]+$/)).toHaveLength(1),
    )

    const [patch] = callsTo(api, 'PATCH', /^\/api\/v1\/publications\/[^/]+$/)
    expect(patch?.path).toBe(`/api/v1/publications/${PUBLICATION_ID}`)
    expect(patch?.body).toMatchObject({
      expected_version: 3,
      public_title: 'Monture légère fictive, nouveau titre',
    })
    expect(patch?.body).not.toHaveProperty('catalog_item_id')
    await vi.waitFor(() => expect(textOf(root)).toContain('elle est repassée en brouillon'))
    unmount()
  })

  it('publier demande le mot de passe (423), puis reprend la même commande avec la même clé', async () => {
    const api = site()
    stubSite(api)
    let confirmed = false
    api.on('POST', /^\/api\/v1\/auth\/reauthenticate$/, () => {
      confirmed = true
      return json(200, { data: { reauthenticated_until: '2026-11-15T09:15:00.000Z' } })
    })
    api.on('POST', /^\/api\/v1\/publications\/[^/]+\/status$/, () =>
      confirmed
        ? json(200, {
            data: publication({ status: 'PUBLISHED', published_at: '2026-11-15T09:00:00.000Z' }),
          })
        : json(423, REAUTH_ERROR),
    )

    const { root, unmount } = await openSite()
    await selectInto(root, `decision-${PUBLICATION_ID}`, 'PUBLISHED')
    await click(byLabel(root, 'Appliquer la décision pour Monture légère fictive'))

    expect(textOf(root)).toContain('Confirmer votre mot de passe')
    const confirmationId = root.querySelector('[id^="confirmation-mot-de-passe"]')?.id ?? ''
    await typeInto(root, confirmationId, 'mot-de-passe-fictif')
    await click(dialogButton(root, 'Confirmer et reprendre'))
    await vi.waitFor(() => expect(callsTo(api, 'POST', /\/status$/)).toHaveLength(2))

    const posts = callsTo(api, 'POST', /\/status$/)
    expect(posts[0]?.path).toBe(`/api/v1/publications/${PUBLICATION_ID}/status`)
    expect(posts[1]?.headers['Idempotency-Key']).toBe(posts[0]?.headers['Idempotency-Key'])
    expect(posts[1]?.body).toEqual({ expected_version: 3, status: 'PUBLISHED' })
    await vi.waitFor(() =>
      expect(textOf(root)).toContain(
        '« Monture légère fictive » est publiée : elle est visible sur le site.',
      ),
    )
    unmount()
  })

  it('dépose une image en octets bruts, avec texte alternatif et note de droits dans l’adresse', async () => {
    const api = site()
    stubSite(api)
    api.on('POST', /^\/api\/v1\/publications\/[^/]+\/media$/, () =>
      json(201, { data: publication() }),
    )

    const { root, unmount } = await openSite()
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const file = new File([bytes], 'monture.png', { type: 'image/png' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer })
    const input = root.querySelector<HTMLInputElement>(`[id="image-${PUBLICATION_ID}"]`)
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input?.dispatchEvent(new Event('change', { bubbles: true }))
    await typeInto(root, `alt-${PUBLICATION_ID}`, 'Monture vue de face')
    await typeInto(root, `droits-${PUBLICATION_ID}`, 'Photo du cabinet, publication autorisée')
    await click(byLabel(root, 'Déposer l’image pour Monture légère fictive'))
    await vi.waitFor(() => expect(callsTo(api, 'POST', /\/media$/)).toHaveLength(1))

    const call = api.fetchMock.mock.calls.find(([url]) => String(url).includes('/media?'))
    expect(call).toBeDefined()
    const [url, init] = call as [string, RequestInit]
    const query = new URL(url, 'https://cabinet.test').searchParams
    expect(query.get('alt_text')).toBe('Monture vue de face')
    expect(query.get('rights_note')).toBe('Photo du cabinet, publication autorisée')
    expect(query.get('display_order')).toBe('0')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('image/png')
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy()
    expect(ArrayBuffer.isView(init.body)).toBe(true)
    await vi.waitFor(() => expect(textOf(root)).toContain('Image déposée'))
    unmount()
  })

  it('refuse une image sans note de droits sans appeler le serveur', async () => {
    const api = site()
    stubSite(api)

    const { root, unmount } = await openSite()
    const file = new File([new Uint8Array([1, 2, 3])], 'monture.png', { type: 'image/png' })
    const input = root.querySelector<HTMLInputElement>(`[id="image-${PUBLICATION_ID}"]`)
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input?.dispatchEvent(new Event('change', { bubbles: true }))
    await typeInto(root, `alt-${PUBLICATION_ID}`, 'Monture vue de face')
    await click(byLabel(root, 'Déposer l’image pour Monture légère fictive'))

    expect(textOf(root)).toContain('La note de droits est obligatoire')
    expect(callsTo(api, 'POST', /\/media$/)).toHaveLength(0)
    unmount()
  })

  it('enregistre le brouillon d’un contenu, puis le publie après confirmation du mot de passe', async () => {
    const api = site()
    let draft: PublicContentEntry = entry({ code: 'HORAIRES', label: 'Horaires' })
    stubSite(api)
    api.on('GET', /^\/api\/v1\/public-contents$/, () => json(200, { data: [draft] }))
    api.on('POST', /^\/api\/v1\/public-contents$/, () => {
      draft = entry({
        code: 'HORAIRES',
        label: 'Horaires',
        draft: revision({
          id: DRAFT_REVISION_ID,
          code: 'HORAIRES',
          status: 'DRAFT',
          title: 'Nos horaires',
          content: 'Du lundi au samedi, de 8 h à 17 h.',
          published_at: null,
          version: 1,
        }),
      })
      return json(201, { data: draft.draft })
    })
    let confirmed = false
    api.on('POST', /^\/api\/v1\/auth\/reauthenticate$/, () => {
      confirmed = true
      return json(200, { data: { reauthenticated_until: '2026-11-15T09:15:00.000Z' } })
    })
    api.on('POST', /^\/api\/v1\/public-contents\/[^/]+\/status$/, () =>
      confirmed ? json(200, { data: draft.draft }) : json(423, REAUTH_ERROR),
    )

    const { root, unmount } = await openSite()
    await typeInto(root, 'contenu-titre-HORAIRES', 'Nos horaires')
    await typeInto(root, 'contenu-texte-HORAIRES', 'Du lundi au samedi, de 8 h à 17 h.')
    await click(byLabel(root, 'Enregistrer le brouillon de Horaires'))
    await vi.waitFor(() =>
      expect(callsTo(api, 'POST', /^\/api\/v1\/public-contents$/)).toHaveLength(1),
    )

    const [saved] = callsTo(api, 'POST', /^\/api\/v1\/public-contents$/)
    expect(saved?.body).toEqual({
      expected_version: null,
      code: 'HORAIRES',
      title: 'Nos horaires',
      content: 'Du lundi au samedi, de 8 h à 17 h.',
    })
    await vi.waitFor(() => expect(textOf(root)).toContain('Un brouillon est en cours'))

    await click(byLabel(root, 'Publier le brouillon de Horaires'))
    expect(textOf(root)).toContain('Confirmer votre mot de passe')
    const confirmationId = root.querySelector('[id^="confirmation-mot-de-passe"]')?.id ?? ''
    await typeInto(root, confirmationId, 'mot-de-passe-fictif')
    await click(dialogButton(root, 'Confirmer et reprendre'))
    await vi.waitFor(() =>
      expect(callsTo(api, 'POST', /\/public-contents\/[^/]+\/status$/)).toHaveLength(2),
    )

    const posts = callsTo(api, 'POST', /\/public-contents\/[^/]+\/status$/)
    expect(posts[0]?.path).toBe(`/api/v1/public-contents/${DRAFT_REVISION_ID}/status`)
    expect(posts[1]?.headers['Idempotency-Key']).toBe(posts[0]?.headers['Idempotency-Key'])
    expect(posts[1]?.body).toEqual({ expected_version: 1, status: 'PUBLISHED' })
    unmount()
  })

  it('refuse un numéro WhatsApp qui n’est pas un numéro, sans appeler le serveur', async () => {
    const api = site()
    stubSite(api)

    const { root, unmount } = await openSite()
    await typeInto(root, 'contenu-titre-WHATSAPP', 'WhatsApp')
    await typeInto(root, 'contenu-texte-WHATSAPP', 'appelez-nous')
    await click(byLabel(root, 'Enregistrer le brouillon de WhatsApp'))
    await settle()

    expect(textOf(root)).toContain(
      'Écrivez le numéro WhatsApp en chiffres, avec l’indicatif du pays',
    )
    expect(callsTo(api, 'POST', /^\/api\/v1\/public-contents$/)).toHaveLength(0)
    unmount()
  })

  it('affiche le message du serveur quand la décision est refusée (article devenu invisible)', async () => {
    const api = site()
    stubSite(api)
    api.on('POST', /^\/api\/v1\/publications\/[^/]+\/status$/, () =>
      json(409, {
        error: {
          code: 'STATE_TRANSITION_REFUSED',
          message: 'La fiche ne peut pas être publiée : son article n’est plus visible au public.',
        },
        correlation_id: 'corr-test-0901',
      }),
    )

    const { root, unmount } = await openSite()
    await selectInto(root, `decision-${PUBLICATION_ID}`, 'PUBLISHED')
    await click(byLabel(root, 'Appliquer la décision pour Monture légère fictive'))
    await vi.waitFor(() => expect(textOf(root)).toContain('Opération refusée'))

    expect(textOf(root)).toContain('son article n’est plus visible au public')
    unmount()
  })
})

describe('accès au site public', () => {
  it('le hub Communication propose la tuile à qui détient site.publish', async () => {
    const api = site({ permissions: ['site.publish'] })
    stubSite(api)

    const { root, unmount } = await openApp('/communication')

    expect(textOf(root)).toContain('Site public : showroom & contenus')
    unmount()
  })

  it('refuse l’écran à un compte sans site.publish', async () => {
    const api = site({ permissions: [...MANAGER, 'communication.manage'] })
    stubSite(api)

    const { root, unmount } = await openSite()

    expect(root.querySelector('h1')?.textContent?.trim()).not.toBe(
      'Site public : showroom et contenus',
    )
    expect(callsTo(api, 'GET', /^\/api\/v1\/publications$/)).toHaveLength(0)
    unmount()
  })
})
