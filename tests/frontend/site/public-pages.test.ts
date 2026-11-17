import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  BookingReceipt,
  PublicContent,
  PublicService,
  PublicSlot,
  ShowroomItem,
} from '@/domain/contracts/generated'

import {
  apiError,
  callsTo,
  click,
  forbiddenWordsIn,
  json,
  openApp,
  resetSales,
  selectInto,
  stubSalesApi,
  textOf,
  typeInto,
  type SalesApi,
} from '../billing/support'

// Pages du public (L3D03, AT33, AT35), SANS compte, EN LIGNE : prise de rendez-vous (une DEMANDE, jamais un rendez-vous
// confirmé par l'écran) et showroom (références publiées seulement). Données FICTIVES. Identifiants au format ULID.
// Le premier test d'un fichier charge l'application entière : sur un poste chargé, 5 s ne suffisent pas.
vi.setConfig({ testTimeout: 30_000 })

afterEach(() => {
  resetSales()
})

const EXAM_ID = '01J9ZXK4M2Q8R7S6T5V4WS0001'
const CONTROL_ID = '01J9ZXK4M2Q8R7S6T5V4WS0002'
const RESOURCE_ID = '01J9ZXK4M2Q8R7S6T5V4WR0001'
const PAGE_META = { current_page: 1, last_page: 1, per_page: 25, total: 2 }

const SERVICES: PublicService[] = [
  { id: EXAM_ID, name: 'Examen de vue fictif', duration_minutes: 30 },
  { id: CONTROL_ID, name: 'Contrôle fictif', duration_minutes: 20 },
]
// Lundi 30 novembre 2026 à 09h00 et 09h30 (Africa/Douala, UTC+1) ; mardi 1er décembre à 09h00.
const SLOTS: PublicSlot[] = [
  slot('2026-11-30T08:00:00.000Z'),
  slot('2026-11-30T08:30:00.000Z'),
  slot('2026-12-01T08:00:00.000Z'),
]
const RECEIPT: BookingReceipt = {
  public_reference: 'RDV-2026-00042',
  status: 'PENDING',
  service_id: EXAM_ID,
  requested_starts_at: '2026-11-30T08:00:00.000Z',
  requested_ends_at: '2026-11-30T08:30:00.000Z',
} as BookingReceipt
const CONTENTS: PublicContent[] = [
  {
    code: 'HORAIRES',
    title: 'Horaires',
    content: 'Du lundi au samedi, de 8 h à 17 h.',
    whatsapp_url: null,
  },
  {
    code: 'WHATSAPP',
    title: 'WhatsApp',
    content: '237600000000',
    whatsapp_url: 'https://wa.me/237600000000',
  },
]

function slot(startsAt: string): PublicSlot {
  const end = new Date(Date.parse(startsAt) + 30 * 60_000).toISOString()
  return { service_id: EXAM_ID, resource_id: RESOURCE_ID, starts_at: startsAt, ends_at: end }
}

function visitor(): SalesApi {
  const api = stubSalesApi()
  api.me = 'anonymous'
  api.on('GET', /^\/public\/v1\/services$/, () => json(200, { data: SERVICES }))
  api.on('GET', /^\/public\/v1\/slots$/, () => json(200, { data: SLOTS }))
  api.on('GET', /^\/public\/v1\/contents$/, () => json(200, { data: CONTENTS }))
  return api
}

function item(overrides: Partial<ShowroomItem> = {}): ShowroomItem {
  return {
    slug: 'monture-legere-fictive',
    title: 'Monture légère fictive',
    description: 'Une monture légère pour tous les jours, donnée fictive.',
    style: 'classique',
    brand: 'Marque Fictive',
    price: null,
    currency: 'XAF',
    media: [{ url: '/public/v1/media/01J9ZXK4M2Q8R7S6T5V4WQ0002', alt: 'Monture vue de face' }],
    ...overrides,
  } as ShowroomItem
}

async function choose(root: ParentNode, name: string, value: string): Promise<void> {
  await click(root.querySelector(`input[name="${name}"][value="${value}"]`))
}

async function fillValid(root: ParentNode): Promise<void> {
  await choose(root, 'rdv-prestation-choix', EXAM_ID)
  await choose(root, 'rdv-heure', SLOTS[0]!.starts_at)
  await typeInto(root, 'rdv-nom', 'Visiteur Fictif')
  await typeInto(root, 'rdv-telephone', '+237 699 00 11 22')
  await click(root.querySelector('[id="rdv-consentement"]'))
}

function submit(root: ParentNode): HTMLButtonElement | null {
  return [...root.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Envoyer ma demande',
  ) as HTMLButtonElement | null
}

describe('prise de rendez-vous du public', () => {
  it('propose les prestations ouvertes, lit les créneaux de la prestation et les groupe par jour du cabinet', async () => {
    const api = visitor()

    const { root, unmount } = await openApp('/rendez-vous')

    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Prendre rendez-vous')
    expect(textOf(root)).toContain('Examen de vue fictif · 30 min')
    expect(textOf(root)).toContain(
      'Les créneaux libres s’affichent après le choix de la prestation.',
    )
    expect(callsTo(api, 'GET', /\/public\/v1\/slots$/)).toHaveLength(0)

    await choose(root, 'rdv-prestation-choix', EXAM_ID)

    const [read] = callsTo(api, 'GET', /\/public\/v1\/slots$/)
    expect(read?.query.get('service_id')).toBe(EXAM_ID)
    const window =
      Date.parse(read?.query.get('to') ?? '') - Date.parse(read?.query.get('from') ?? '')
    expect(window).toBe(7 * 86_400_000)
    const text = textOf(root)
    expect(text).toContain('lundi 30 novembre 2026')
    expect(text).toContain('mardi 1 décembre 2026')
    expect(text).toContain('09h00')
    expect(text).toContain('09h30')
    // Les informations publiées du cabinet aident à joindre quelqu'un ; le lien WhatsApp est un simple lien.
    expect(text).toContain('Du lundi au samedi, de 8 h à 17 h.')
    const link = root.querySelector<HTMLAnchorElement>('a[href="https://wa.me/237600000000"]')
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(forbiddenWordsIn(root)).toEqual([])
    unmount()
  })

  it('refuse une demande incomplète sans appeler le serveur, en nommant les champs', async () => {
    const api = visitor()
    api.on('POST', /^\/public\/v1\/booking-requests$/, () => json(201, { data: RECEIPT }))

    const { root, unmount } = await openApp('/rendez-vous')
    await click(submit(root))

    const text = textOf(root)
    expect(text).toContain('Choisissez la prestation.')
    expect(text).toContain('Choisissez un créneau.')
    expect(text).toContain('Indiquez votre nom et votre prénom.')
    expect(text).toContain(
      'Indiquez un numéro de téléphone pour que le cabinet puisse vous répondre.',
    )
    expect(text).toContain('Cochez la case pour que le cabinet puisse traiter votre demande.')
    expect(callsTo(api, 'POST', /booking-requests$/)).toHaveLength(0)
    unmount()
  })

  it('envoie une DEMANDE (clé d’idempotence, consentement) et ne dit jamais « confirmé »', async () => {
    const api = visitor()
    api.on('POST', /^\/public\/v1\/booking-requests$/, () => json(201, { data: RECEIPT }))

    const { root, unmount } = await openApp('/rendez-vous')
    await fillValid(root)
    await click(submit(root))

    const [post] = callsTo(api, 'POST', /booking-requests$/)
    expect(post?.body).toEqual({
      service_id: EXAM_ID,
      resource_id: RESOURCE_ID,
      starts_at: '2026-11-30T08:00:00.000Z',
      name: 'Visiteur Fictif',
      phone: '+237 699 00 11 22',
      consent: true,
    })
    expect(post?.headers['Idempotency-Key']).toBeTruthy()
    const text = textOf(root)
    expect(text).toContain('Demande envoyée')
    expect(text).toContain('RDV-2026-00042')
    expect(text).toContain('30/11/2026 à 09h00')
    expect(text).toContain('ce n’est pas un rendez-vous confirmé')
    expect(text).not.toMatch(/votre rendez-vous est confirmé/i)
    unmount()
  })

  it('reprend la MÊME clé quand la réponse est perdue, puis dit enfin que la demande est envoyée', async () => {
    const api = visitor()
    let attempts = 0
    api.on('POST', /^\/public\/v1\/booking-requests$/, () => {
      attempts += 1
      return attempts === 1 ? 'network' : json(201, { data: RECEIPT })
    })

    const { root, unmount } = await openApp('/rendez-vous')
    await fillValid(root)
    await click(submit(root))
    expect(textOf(root)).toContain('Pas de connexion : votre demande n’a pas été envoyée.')
    expect(textOf(root)).not.toContain('Demande envoyée')

    await click(submit(root))

    const posts = callsTo(api, 'POST', /booking-requests$/)
    expect(posts).toHaveLength(2)
    expect(posts[1]?.headers['Idempotency-Key']).toBe(posts[0]?.headers['Idempotency-Key'])
    expect(textOf(root)).toContain('Demande envoyée')
    unmount()
  })

  it('change de clé quand la demande change (jamais une clé réutilisée pour une autre charge)', async () => {
    const api = visitor()
    api.on('POST', /^\/public\/v1\/booking-requests$/, () => 'network')

    const { root, unmount } = await openApp('/rendez-vous')
    await fillValid(root)
    await click(submit(root))
    await typeInto(root, 'rdv-telephone', '+237 699 00 11 33')
    await click(submit(root))

    const posts = callsTo(api, 'POST', /booking-requests$/)
    expect(posts).toHaveLength(2)
    expect(posts[1]?.headers['Idempotency-Key']).not.toBe(posts[0]?.headers['Idempotency-Key'])
    unmount()
  })

  it('un créneau pris entre-temps est dit, décoché et relu', async () => {
    const api = visitor()
    api.on('POST', /^\/public\/v1\/booking-requests$/, () =>
      apiError(
        409,
        'SLOT_UNAVAILABLE',
        'Ce créneau vient d’être réservé : choisissez un autre horaire.',
      ),
    )

    const { root, unmount } = await openApp('/rendez-vous')
    await fillValid(root)
    const readsBefore = callsTo(api, 'GET', /\/public\/v1\/slots$/).length
    await click(submit(root))

    expect(textOf(root)).toContain('Ce créneau vient d’être pris. Choisissez-en un autre.')
    expect(callsTo(api, 'GET', /\/public\/v1\/slots$/).length).toBeGreaterThan(readsBefore)
    expect(
      root.querySelector<HTMLInputElement>(
        `input[name="rdv-heure"][value="${SLOTS[0]!.starts_at}"]`,
      )?.checked,
    ).toBe(false)
    unmount()
  })

  it('le piège à robots est caché des lecteurs d’écran et du clavier, et n’est envoyé que s’il est rempli', async () => {
    const api = visitor()
    api.on('POST', /^\/public\/v1\/booking-requests$/, () =>
      apiError(422, 'VALIDATION_FAILED', 'Votre demande n’a pas pu être enregistrée.'),
    )

    const { root, unmount } = await openApp('/rendez-vous')
    const trap = root.querySelector<HTMLInputElement>('input[name="website"]')
    expect(trap?.getAttribute('tabindex')).toBe('-1')
    expect(trap?.closest('[aria-hidden="true"]')).not.toBeNull()

    await fillValid(root)
    await click(submit(root))
    expect(callsTo(api, 'POST', /booking-requests$/)[0]?.body).not.toHaveProperty('website')

    const robot = root.querySelector<HTMLInputElement>('input[name="website"]')!
    robot.value = 'https://exemple.test'
    robot.dispatchEvent(new Event('input', { bubbles: true }))
    await click(submit(root))
    expect(callsTo(api, 'POST', /booking-requests$/)[1]?.body).toMatchObject({
      website: 'https://exemple.test',
    })
    expect(textOf(root)).not.toContain('Demande envoyée')
    unmount()
  })

  it('une référence du showroom publiée est gardée par la demande ; une référence inconnue ne l’est pas', async () => {
    const api = visitor()
    api.on('GET', /^\/public\/v1\/showroom\/monture-legere-fictive$/, () =>
      json(200, { data: item() }),
    )
    api.on('POST', /^\/public\/v1\/booking-requests$/, () => json(201, { data: RECEIPT }))

    const known = await openApp('/rendez-vous?fiche=monture-legere-fictive')
    expect(textOf(known.root)).toContain(
      'Votre demande concerne la référence « Monture légère fictive »',
    )
    await fillValid(known.root)
    await click(submit(known.root))
    expect(callsTo(api, 'POST', /booking-requests$/)[0]?.body).toMatchObject({
      publication_slug: 'monture-legere-fictive',
    })
    known.unmount()

    const unknown = await openApp('/rendez-vous?fiche=reference-inconnue')
    await fillValid(unknown.root)
    await click(submit(unknown.root))
    expect(callsTo(api, 'POST', /booking-requests$/)[1]?.body).not.toHaveProperty(
      'publication_slug',
    )
    unknown.unmount()
  })

  it('sans prestation ouverte, la page le dit et n’envoie rien', async () => {
    const api = visitor()
    api.on('GET', /^\/public\/v1\/services$/, () => json(200, { data: [] }))

    const { root, unmount } = await openApp('/rendez-vous')

    expect(textOf(root)).toContain('Prise de rendez-vous en ligne fermée')
    expect(submit(root)?.disabled).toBe(true)
    unmount()
  })
})

describe('showroom public', () => {
  it('liste les références publiées : image, marque, style ; le prix seulement s’il est montré', async () => {
    const api = visitor()
    api.on('GET', /^\/public\/v1\/showroom$/, () =>
      json(200, {
        data: [
          item({ price: 45000 }),
          item({ slug: 'collection-sans-prix', title: 'Sans prix fictif' }),
        ],
        meta: PAGE_META,
        facets: { styles: ['classique', 'sport'], brands: ['Marque Fictive'] },
      }),
    )

    const { root, unmount } = await openApp('/showroom')

    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Showroom')
    const text = textOf(root)
    expect(text).toContain('Monture légère fictive')
    expect(text).toContain('Marque Fictive · classique')
    expect(text).toContain('45 000')
    expect(text.match(/FCFA/g)).toHaveLength(1)
    expect(root.querySelector('img')?.getAttribute('alt')).toBe('Monture vue de face')
    // Ni coût d'achat, ni stock, ni référence interne.
    expect(text).not.toMatch(/stock|co[uû]t d.achat|r[ée]f[ée]rence interne/i)
    expect(
      root.querySelector('a[href="/showroom/monture-legere-fictive"]')?.textContent?.trim(),
    ).toBe('Monture légère fictive')
    expect(forbiddenWordsIn(root)).toEqual([])
    unmount()
  })

  it('filtre par style et par marque et repart de la première page', async () => {
    const api = visitor()
    api.on('GET', /^\/public\/v1\/showroom$/, () =>
      json(200, {
        data: [item()],
        meta: PAGE_META,
        facets: { styles: ['classique', 'sport'], brands: ['Marque Fictive'] },
      }),
    )

    const { root, unmount } = await openApp('/showroom')
    await selectInto(root, 'showroom-style', 'sport')
    await selectInto(root, 'showroom-marque', 'Marque Fictive')

    const last = callsTo(api, 'GET', /\/public\/v1\/showroom$/).at(-1)
    expect(last?.query.get('style')).toBe('sport')
    expect(last?.query.get('brand')).toBe('Marque Fictive')
    expect(last?.query.get('page')).toBe('1')
    unmount()
  })

  it('dit qu’aucune référence ne correspond, sans prétendre que le serveur est en panne', async () => {
    const api = visitor()
    api.on('GET', /^\/public\/v1\/showroom$/, () =>
      json(200, { data: [], meta: { ...PAGE_META, total: 0 }, facets: { styles: [], brands: [] } }),
    )

    const { root, unmount } = await openApp('/showroom')

    expect(textOf(root)).toContain('Aucune référence à afficher')
    expect(textOf(root)).not.toContain('Le service ne répond pas')
    unmount()
  })

  it('un module fermé (404) est dit « page non disponible », pas une panne', async () => {
    const api = visitor()
    api.on('GET', /^\/public\/v1\/showroom$/, () =>
      apiError(404, 'RESOURCE_NOT_FOUND', 'Ressource introuvable.'),
    )

    const { root, unmount } = await openApp('/showroom')

    expect(textOf(root)).toContain('Page non disponible')
    unmount()
  })

  it('montre la fiche d’une référence avec un lien de prise de rendez-vous qui garde son adresse', async () => {
    const api = visitor()
    api.on('GET', /^\/public\/v1\/showroom\/monture-legere-fictive$/, () =>
      json(200, { data: item({ price: 45000 }) }),
    )

    const { root, unmount } = await openApp('/showroom/monture-legere-fictive')

    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Monture légère fictive')
    const text = textOf(root)
    expect(text).toContain('Une monture légère pour tous les jours, donnée fictive.')
    expect(text).toContain('45 000')
    expect(text).toContain('La disponibilité n’est pas affichée')
    expect(root.querySelector('a[href="/rendez-vous?fiche=monture-legere-fictive"]')).not.toBeNull()
    unmount()
  })

  it('une référence non publiée est « introuvable » (404), jamais devinée', async () => {
    const api = visitor()
    api.on('GET', /^\/public\/v1\/showroom\/reference-retiree$/, () =>
      apiError(404, 'RESOURCE_NOT_FOUND', 'Cette référence n’est pas publiée.'),
    )

    const { root, unmount } = await openApp('/showroom/reference-retiree')

    expect(textOf(root)).toContain('Référence introuvable')
    expect(textOf(root)).toContain('n’est pas (ou plus) présentée par le cabinet')
    unmount()
  })
})
