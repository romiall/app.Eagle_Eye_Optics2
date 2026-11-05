import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MutationDispatcher } from '@/app/services/mutations'
import { isUlid } from '@/domain/values/ulid'

import { meResponse } from '../shell/server'
import {
  apiError,
  buttonByName,
  callsTo,
  choose,
  click,
  field,
  fillValidIdentity,
  hasField,
  ID_B,
  ID_C,
  json,
  linkTo,
  openApp,
  pageOf,
  patient,
  READER,
  RECEPTION,
  resetEverything,
  stubPatientsApi,
  submitForm,
  summaryOf,
  textOf,
  type,
  typeDate,
} from './support'

// Nouveau patient (P01 ; AT03, AT04) : règles de saisie, doublons signalés sans fusion, téléphone
// partagé permis, enregistrement EN LIGNE (« Synchronisé » seulement après la réponse du serveur),
// reprise avec la même clé, erreurs par champ, session expirée, garde de saisie. Données FICTIVES.
const CREATE = /^\/api\/v1\/patients$/
const SEARCH = /^\/api\/v1\/patients$/

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T09:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  resetEverything()
})

function posts(api: ReturnType<typeof stubPatientsApi>) {
  return callsTo(api, 'POST', CREATE)
}

function searches(api: ReturnType<typeof stubPatientsApi>) {
  return callsTo(api, 'GET', SEARCH)
}

/** Serveur qui crée la fiche demandée et la rend à GET /patients/{id}. */
function creatingServer(options: Parameters<typeof stubPatientsApi>[0] = {}) {
  const created = new Map<string, ReturnType<typeof patient>>()
  const api = stubPatientsApi({
    permissions: RECEPTION,
    ...options,
    handlers: {
      create: (body) => {
        const record = patient({
          id: String(body['patient_id']),
          last_name: String(body['last_name']),
        })
        created.set(record.id, record)
        return json(201, {
          data: { patient_id: record.id, record_number: 'EE-2026-0001', version: 1 },
        })
      },
      get: (id) => {
        const record = created.get(id)
        return record === undefined
          ? apiError(404, 'RESOURCE_NOT_FOUND', 'Ressource introuvable.')
          : json(200, { data: record })
      },
      ...options.handlers,
    },
  })
  return api
}

describe('formulaire de création', () => {
  it('propose tous les champs d’identité avec de vrais libellés, sans numéro de dossier à saisir', async () => {
    creatingServer()
    const { root, unmount } = await openApp('/patients/nouveau')

    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Nouveau patient')
    expect(document.title).toBe('Nouveau patient – Eagle’s Eye Optics Medical')
    for (const label of [
      'Nom',
      'Prénom(s)',
      'Sexe',
      'Date de naissance',
      'Téléphone principal',
      'Téléphone secondaire',
      'Adresse ou quartier',
      'Profession',
    ]) {
      expect(hasField(root, label), label).toBe(true)
    }
    expect(hasField(root, 'Numéro de dossier')).toBe(false)
    expect(root.querySelector('label[for="patient-nom"]')?.textContent).toContain('(obligatoire)')
    expect(field(root, 'Adresse ou quartier').tagName).toBe('TEXTAREA')
    expect(field(root, 'Téléphone principal').getAttribute('type')).toBe('tel')

    // Sexe : Féminin, Masculin, et « Non renseigné » comme choix vide par défaut.
    const select = field(root, 'Sexe') as HTMLSelectElement
    expect([...select.options].map((option) => option.textContent?.trim())).toEqual([
      'Non renseigné',
      'Féminin',
      'Masculin',
    ])
    expect(select.value).toBe('')
    expect(buttonByName(root, 'Enregistrer le patient')).not.toBeNull()
    // Mode en ligne : jamais « enregistré sur ce poste ».
    expect(textOf(root)).not.toContain('Enregistré sur ce poste')
    unmount()
  })

  it('les raisons d’absence n’apparaissent que tant que la naissance ou le téléphone manquent', async () => {
    creatingServer()
    const { root, unmount } = await openApp('/patients/nouveau')
    expect(hasField(root, 'Raison de l’absence de date de naissance')).toBe(true)
    expect(hasField(root, 'Raison de l’absence de téléphone')).toBe(true)

    await typeDate(root, 'Date de naissance', '17/05/1990')
    await type(root, 'Téléphone principal', '600000001')

    expect(hasField(root, 'Raison de l’absence de date de naissance')).toBe(false)
    expect(hasField(root, 'Raison de l’absence de téléphone')).toBe(false)
    // L'âge calculé accompagne la date saisie.
    expect(textOf(root)).toContain('Âge calculé : 36 ans')
    unmount()
  })

  it('contrôles de 44 px au moins et accessibles : tous nommés, aucun sans libellé', async () => {
    creatingServer()
    const { root, unmount } = await openApp('/patients/nouveau')

    const controls = [
      ...root.querySelectorAll<HTMLElement>('main input, main select, main textarea, main button'),
    ]
    expect(controls.length).toBeGreaterThan(8)
    for (const control of controls) {
      expect(control.className, control.outerHTML).toContain('min-h-11')
      const named =
        control instanceof HTMLButtonElement
          ? (control.textContent?.trim() ?? '') !== ''
          : (control as HTMLInputElement).labels?.length === 1
      expect(named, control.outerHTML).toBe(true)
    }
    unmount()
  })
})

describe('règles de saisie avant tout envoi', () => {
  it('une saisie vide est refusée localement : erreurs par champ, résumé focalisé, aucun appel', async () => {
    const api = creatingServer()
    const { root, unmount } = await openApp('/patients/nouveau')

    await submitForm(root)

    const summary = root.querySelector('[role="alert"]') as HTMLElement
    expect(summary.textContent).toContain('Certaines informations sont à corriger')
    expect(summary.textContent).toContain('Le nom est obligatoire.')
    expect(summary.textContent).toContain('Date de naissance absente : indiquez la raison.')
    expect(summary.textContent).toContain('Téléphone absent : indiquez la raison.')
    expect(document.activeElement).toBe(summary)
    expect(field(root, 'Nom').getAttribute('aria-invalid')).toBe('true')
    expect(textOf(root.querySelector('#patient-nom-erreur') as Element)).toContain(
      'Le nom est obligatoire.',
    )
    expect(posts(api)).toHaveLength(0)
    expect(searches(api)).toHaveLength(0)

    // Chaque erreur du résumé mène à son champ.
    const firstLink = summary.querySelector('a') as HTMLAnchorElement
    firstLink.click()
    expect(document.activeElement?.id).toBe('patient-nom')

    // La correction efface l'erreur du champ.
    await type(root, 'Nom', 'PATIENT FICTIF')
    expect(field(root, 'Nom').getAttribute('aria-invalid')).toBeNull()
    unmount()
  })

  it('refuse une naissance future au jour civil du cabinet', async () => {
    const api = creatingServer()
    const { root, unmount } = await openApp('/patients/nouveau')
    await fillValidIdentity(root)
    await typeDate(root, 'Date de naissance', '16/10/2026')

    await submitForm(root)

    expect(textOf(root)).toContain('La date de naissance ne peut pas être dans le futur.')
    expect(posts(api)).toHaveLength(0)
    expect(searches(api)).toHaveLength(0)
    // Aujourd'hui (jour civil de Douala) reste permis.
    await typeDate(root, 'Date de naissance', '15/10/2026')
    await submitForm(root)
    expect(posts(api)).toHaveLength(1)
    unmount()
  })

  it('une date de naissance illisible bloque l’envoi, la saisie reste affichée', async () => {
    const api = creatingServer()
    const { root, unmount } = await openApp('/patients/nouveau')
    await fillValidIdentity(root)
    await typeDate(root, 'Date de naissance', '31/02/2026')

    await submitForm(root)

    expect(textOf(root)).toContain('Cette date n’existe pas dans le calendrier.')
    expect(textOf(root)).toContain('La date de naissance saisie n’est pas valide')
    expect(field(root, 'Date de naissance').value).toBe('31/02/2026')
    expect(posts(api)).toHaveLength(0)
    unmount()
  })

  it('naissance et téléphone absents mais justifiés : la fiche est créée, avec des null', async () => {
    const api = creatingServer()
    const { root, router, unmount } = await openApp('/patients/nouveau')
    await type(root, 'Nom', 'PATIENT FICTIF')
    await type(root, 'Raison de l’absence de date de naissance', 'Âge inconnu')
    await type(root, 'Raison de l’absence de téléphone', 'Pas de téléphone')

    await submitForm(root)

    expect(posts(api)).toHaveLength(1)
    expect(posts(api)[0]?.body).toMatchObject({
      birth_date: null,
      birth_date_missing_reason: 'Âge inconnu',
      phone_primary: null,
      phone_missing_reason: 'Pas de téléphone',
      first_names: null,
      address: null,
      profession: null,
      sex: 'UNKNOWN',
    })
    expect(router.currentRoute.value.name).toBe('patient')
    unmount()
  })
})

describe('enregistrement en ligne', () => {
  it('crée la fiche : charge conforme, clé d’idempotence, puis ouvre la fiche avec son numéro', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const api = creatingServer()
    const { root, router, unmount } = await openApp('/patients/nouveau')
    await fillValidIdentity(root)
    await choose(root, 'Sexe', 'F')
    await type(root, 'Adresse ou quartier', 'Quartier fictif\nDouala')
    await type(root, 'Profession', 'Enseignante')

    await submitForm(root)

    // La ressemblance est cherchée avant d'enregistrer : nom + premier prénom, puis téléphone.
    const asked = searches(api).map((call) => call.query.get('query'))
    expect(asked).toEqual(['PATIENT FICTIF Élodie', '237600000001'])
    expect(api.requests.findIndex((call) => call.method === 'POST')).toBeGreaterThan(
      api.requests.findLastIndex(
        (call) => call.method === 'GET' && call.path === '/api/v1/patients',
      ),
    )

    expect(posts(api)).toHaveLength(1)
    const [call] = posts(api)
    expect(call?.headers['Idempotency-Key']).toMatch(/^[0-9A-Z]{26}$/)
    expect(call?.body).toMatchObject({
      expected_version: null,
      record_number: null,
      last_name: 'PATIENT FICTIF',
      first_names: 'Élodie Marie',
      sex: 'F',
      birth_date: '1990-05-17',
      birth_date_missing_reason: null,
      phone_primary: '+237600000001',
      phone_secondary: null,
      phone_missing_reason: null,
      address: 'Quartier fictif\nDouala',
      profession: 'Enseignante',
      guardian_contact: null,
      legacy_record: false,
      first_known_visit_on: null,
      first_visit_certified: false,
      legacy_record_number: null,
    })
    expect(isUlid(String(call?.body?.['patient_id']))).toBe(true)
    expect(isUlid(String(call?.body?.['record_number_usage_id']))).toBe(true)

    // La fiche s'ouvre ; aucune garde de saisie n'a bloqué la sortie.
    expect(router.currentRoute.value.path).toBe(`/patients/${String(call?.body?.['patient_id'])}`)
    expect(confirm).not.toHaveBeenCalled()
    expect(root.querySelector('h1')?.textContent).toContain('PATIENT FICTIF')
    expect(textOf(root)).toContain('Patient enregistré : dossier EE-2026-0001.')
    unmount()
  })

  it('un double clic n’envoie qu’une commande (et ne cherche les doublons qu’une fois)', async () => {
    const api = creatingServer()
    const { root, unmount } = await openApp('/patients/nouveau')
    await fillValidIdentity(root)
    const form = root.querySelector('main form') as HTMLFormElement

    form.dispatchEvent(new Event('submit', { cancelable: true }))
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()

    expect(posts(api)).toHaveLength(1)
    expect(searches(api)).toHaveLength(2)
    unmount()
  })

  it('« Synchronisé » n’est jamais dit avant la réponse du serveur', async () => {
    let release: (response: Response) => void = () => undefined
    const api = creatingServer({
      handlers: {
        create: () =>
          new Promise<Response>((resolve) => {
            release = resolve
          }),
      },
    })
    const { root, router, unmount } = await openApp('/patients/nouveau')
    await fillValidIdentity(root)

    await submitForm(root)

    expect(posts(api)).toHaveLength(1)
    expect(textOf(root)).toContain('Enregistrement en cours…')
    expect(textOf(root)).not.toContain('Synchronisé avec le serveur')
    expect(textOf(root)).not.toContain('Enregistré sur ce poste')
    expect(router.currentRoute.value.name).toBe('patient-nouveau')
    // Pendant l'envoi, la saisie ne peut plus être modifiée ni renvoyée.
    expect(field(root, 'Nom').disabled).toBe(true)
    expect(buttonByName(root, 'Enregistrement en cours…')?.disabled).toBe(true)

    release(
      json(201, {
        data: {
          patient_id: String(posts(api)[0]?.body?.['patient_id']),
          record_number: 'EE-2026-0001',
          version: 1,
        },
      }),
    )
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('patient')
    unmount()
  })

  it('une commande enregistrée par le journal du poste est dite « sur ce poste », jamais synchronisée', async () => {
    const api = creatingServer()
    const sent: string[] = []
    const dispatcher: MutationDispatcher = {
      dispatch: async (request) => {
        sent.push(String(request.payload['patient_id']))
        return { kind: 'saved-local', at: '2026-10-15T09:42:00.000Z' }
      },
    }
    const { root, router, unmount } = await openApp('/patients/nouveau', { dispatcher })
    await fillValidIdentity(root)
    const linkNamed = (label: string): HTMLAnchorElement | undefined =>
      [...root.querySelectorAll('a')].find((anchor) => anchor.textContent?.trim() === label)
    expect(linkNamed('Annuler')?.getAttribute('href')).toBe('/patients')

    await submitForm(root)

    expect(textOf(root)).toContain('Enregistré sur ce poste à 10h42')
    expect(textOf(root)).not.toContain('Synchronisé')
    expect(posts(api)).toHaveLength(0)
    expect(router.currentRoute.value.name).toBe('patient-nouveau')
    // La fiche s'ouvre sur le poste, par le lien qui remplace « Annuler » : la saisie est enregistrée.
    expect(sent).toHaveLength(1)
    expect(isUlid(sent[0] ?? '')).toBe(true)
    expect(linkNamed('Ouvrir la fiche')?.getAttribute('href')).toBe(`/patients/${sent[0]}`)
    expect(linkNamed('Annuler')).toBeUndefined()
    unmount()
  })
})

describe('ressemblances : signalées sans fusion', () => {
  const homonym = patient({
    id: ID_B,
    record_number: 'EE-2025-0042',
    last_name: 'PATIENT FICTIF',
    first_names: 'Élodie',
    birth_date: '1990-05-17',
    phone_primary: '+237600000099',
  })
  const sharedPhone = patient({
    id: ID_C,
    record_number: 'EE-2025-0077',
    last_name: 'PROCHE FICTIF',
    first_names: 'Jean',
    birth_date: null,
    phone_primary: '+237600000001',
  })

  function dialogOf(root: HTMLElement): HTMLDialogElement {
    return root.querySelector('dialog') as HTMLDialogElement
  }

  it('un homonyme est signalé dans une confirmation, sans aucune action de fusion', async () => {
    const api = creatingServer({
      handlers: {
        search: (query) =>
          json(200, pageOf(query.startsWith('PATIENT') ? [summaryOf(homonym)] : [])),
      },
    })
    const { root, router, unmount } = await openApp('/patients/nouveau')
    await fillValidIdentity(root)

    await submitForm(root)

    expect(posts(api)).toHaveLength(0)
    const dialog = dialogOf(root)
    expect(dialog.open).toBe(true)
    expect(textOf(dialog)).toContain('Des fiches ressemblent à ce patient')
    expect(textOf(dialog)).toContain('PATIENT FICTIF Élodie')
    expect(textOf(dialog)).toContain('Dossier EE-2025-0042')
    expect(textOf(dialog)).toContain('Nom proche')
    expect(textOf(dialog)).toContain('Même date de naissance')
    expect(textOf(dialog)).toContain('Aucune fiche n’est fusionnée')
    const open = linkTo(dialog, `/patients/${ID_B}`)
    expect(open?.getAttribute('target')).toBe('_blank')
    expect(open?.getAttribute('rel')).toContain('noopener')
    expect(
      [...dialog.querySelectorAll('button')].map((button) => button.textContent?.trim()),
    ).toEqual(['Revenir au formulaire', 'Créer quand même'])
    expect(textOf(dialog)).not.toMatch(/fusionner|fusion de/i)
    expect(router.currentRoute.value.name).toBe('patient-nouveau')
    unmount()
  })

  it('« Revenir au formulaire » ne crée rien et conserve toute la saisie', async () => {
    const api = creatingServer({
      handlers: { search: () => json(200, pageOf([summaryOf(homonym)])) },
    })
    const { root, unmount } = await openApp('/patients/nouveau')
    await fillValidIdentity(root)
    await type(root, 'Profession', 'Enseignante')
    await submitForm(root)

    await click(buttonByName(dialogOf(root), 'Revenir au formulaire'))

    expect(dialogOf(root).open).toBe(false)
    expect(posts(api)).toHaveLength(0)
    // Le focus revient au bouton d'enregistrement, pas dans le vide.
    expect(document.activeElement?.textContent?.trim()).toBe('Enregistrer le patient')
    expect(field(root, 'Nom').value).toBe('PATIENT FICTIF')
    expect(field(root, 'Téléphone principal').value).toBe('+237 600 00 00 01')
    expect(field(root, 'Profession').value).toBe('Enseignante')
    unmount()
  })

  it('« Créer quand même » crée la fiche demandée, une seule fois', async () => {
    const api = creatingServer({
      handlers: { search: () => json(200, pageOf([summaryOf(homonym)])) },
    })
    const { root, router, unmount } = await openApp('/patients/nouveau')
    await fillValidIdentity(root)
    await submitForm(root)

    await click(buttonByName(dialogOf(root), 'Créer quand même'))

    expect(posts(api)).toHaveLength(1)
    expect(posts(api)[0]?.body).toMatchObject({
      last_name: 'PATIENT FICTIF',
      first_names: 'Élodie Marie',
    })
    expect(router.currentRoute.value.name).toBe('patient')
    unmount()
  })

  it('un téléphone partagé est signalé comme tel et reste permis', async () => {
    const api = creatingServer({
      handlers: {
        search: (query) =>
          json(200, pageOf(/^[0-9]+$/.test(query) ? [summaryOf(sharedPhone)] : [])),
      },
    })
    const { root, unmount } = await openApp('/patients/nouveau')
    await fillValidIdentity(root)

    await submitForm(root)

    const dialog = dialogOf(root)
    expect(textOf(dialog)).toContain('PROCHE FICTIF Jean')
    expect(textOf(dialog)).toContain('Même téléphone')
    expect(textOf(dialog)).toContain('Un même téléphone peut servir à plusieurs patients')
    expect(textOf(dialog)).not.toContain('Nom proche')

    await click(buttonByName(dialog, 'Créer quand même'))
    expect(posts(api)).toHaveLength(1)
    unmount()
  })

  it('une fiche qui ressemble par le nom et le téléphone n’est listée qu’une fois', async () => {
    creatingServer({
      handlers: { search: () => json(200, pageOf([summaryOf(homonym)])) },
    })
    const { root, unmount } = await openApp('/patients/nouveau')
    await fillValidIdentity(root)

    await submitForm(root)

    const dialog = dialogOf(root)
    expect(dialog.querySelectorAll('li')).toHaveLength(1)
    expect(textOf(dialog)).toContain('Nom proche')
    expect(textOf(dialog)).toContain('Même téléphone')
    unmount()
  })

  it('sans réponse du serveur à la vérification : dit « impossible », ne déclare jamais « aucun doublon »', async () => {
    const api = creatingServer({ handlers: { search: () => 'network' } })
    const { root, router, unmount } = await openApp('/patients/nouveau')
    await fillValidIdentity(root)

    await submitForm(root)

    const dialog = dialogOf(root)
    expect(dialog.open).toBe(true)
    expect(textOf(dialog)).toContain('Vérification des doublons impossible')
    expect(textOf(dialog)).toContain('peut produire un doublon')
    expect(textOf(dialog)).toContain('le serveur n’est pas joignable (pas de connexion)')
    expect(posts(api)).toHaveLength(0)
    expect(buttonByName(dialog, 'Créer sans vérification')).not.toBeNull()

    await click(buttonByName(dialog, 'Créer sans vérification'))
    expect(posts(api)).toHaveLength(1)
    expect(router.currentRoute.value.name).toBe('patient')
    unmount()
  })

  it('une réponse 500 à la vérification est traitée de la même façon', async () => {
    creatingServer({
      handlers: { search: () => apiError(500, 'INTERNAL_ERROR', 'Erreur interne.') },
    })
    const { root, unmount } = await openApp('/patients/nouveau')
    await fillValidIdentity(root)

    await submitForm(root)

    expect(textOf(dialogOf(root))).toContain('Vérification des doublons impossible')
    expect(textOf(dialogOf(root))).toContain('le serveur n’a pas répondu comme attendu')
    unmount()
  })

  it('après confirmation, une nouvelle tentative de la même identité ne redemande pas', async () => {
    let attempt = 0
    const api = creatingServer({
      handlers: {
        search: () => json(200, pageOf([summaryOf(homonym)])),
        create: () => {
          attempt += 1
          return attempt === 1
            ? apiError(422, 'VALIDATION_FAILED', 'Données invalides.', {
                profession: ['Profession refusée par le serveur.'],
              })
            : json(201, { data: { patient_id: ID_B, record_number: 'EE-2026-0001', version: 1 } })
        },
        get: () => json(200, { data: patient({ id: ID_B }) }),
      },
    })
    const { root, unmount } = await openApp('/patients/nouveau')
    await fillValidIdentity(root)
    await submitForm(root)
    await click(buttonByName(dialogOf(root), 'Créer quand même'))
    expect(posts(api)).toHaveLength(1)

    await type(root, 'Profession', 'Infirmière')
    await submitForm(root)

    // Même identité déjà confirmée : pas de seconde boîte, la fiche part.
    expect(root.querySelector('dialog[open]')).toBeNull()
    expect(posts(api)).toHaveLength(2)
    unmount()
  })
})

describe('échecs d’enregistrement : la saisie reste, la reprise ne crée jamais deux fiches', () => {
  it('un refus 422 s’affiche sous chaque champ et dans le résumé ; la correction part avec une nouvelle clé', async () => {
    let attempt = 0
    const api = creatingServer({
      handlers: {
        create: (body) => {
          attempt += 1
          return attempt === 1
            ? apiError(422, 'VALIDATION_FAILED', 'Données invalides.', {
                phone_primary: ['Ce numéro est refusé par le serveur.'],
                last_name: ['Ce nom est refusé par le serveur.'],
              })
            : json(201, {
                data: { patient_id: body['patient_id'], record_number: 'EE-2026-0001', version: 1 },
              })
        },
        get: () => json(200, { data: patient() }),
      },
    })
    const { root, unmount } = await openApp('/patients/nouveau')
    await fillValidIdentity(root)

    await submitForm(root)

    const summary = root.querySelector('[role="alert"]') as HTMLElement
    expect(summary.textContent).toContain('Ce numéro est refusé par le serveur.')
    expect(summary.textContent).toContain('Ce nom est refusé par le serveur.')
    expect(field(root, 'Téléphone principal').getAttribute('aria-invalid')).toBe('true')
    expect(textOf(root.querySelector('#patient-telephone-erreur') as Element)).toContain(
      'Ce numéro est refusé par le serveur.',
    )
    expect(field(root, 'Nom').value).toBe('PATIENT FICTIF')
    expect(field(root, 'Téléphone principal').value).toBe('+237 600 00 00 01')
    expect(document.activeElement).toBe(summary)

    await type(root, 'Téléphone principal', '+237 600 00 00 09')
    await submitForm(root)

    expect(posts(api)).toHaveLength(2)
    const [first, second] = posts(api)
    // Même fiche (mêmes identifiants d'effets), charge différente donc nouvelle clé.
    expect(second?.body?.['patient_id']).toBe(first?.body?.['patient_id'])
    expect(second?.body?.['record_number_usage_id']).toBe(first?.body?.['record_number_usage_id'])
    expect(second?.headers['Idempotency-Key']).not.toBe(first?.headers['Idempotency-Key'])
    expect(second?.body?.['phone_primary']).toBe('+237600000009')
    unmount()
  })

  it('un refus sans champ (403) est dit dans le résumé, la saisie est conservée', async () => {
    creatingServer({
      handlers: { create: () => apiError(403, 'ACTION_FORBIDDEN', 'Action non autorisée.') },
    })
    const { root, router, unmount } = await openApp('/patients/nouveau')
    await fillValidIdentity(root)

    await submitForm(root)

    expect((root.querySelector('[role="alert"]') as HTMLElement).textContent).toContain(
      'Action non autorisée.',
    )
    expect(field(root, 'Nom').value).toBe('PATIENT FICTIF')
    expect(router.currentRoute.value.name).toBe('patient-nouveau')
    unmount()
  })

  it.each([
    ['réseau coupé', 'network' as const],
    ['erreur 500', undefined],
  ])(
    '%s : « non confirmé », puis « Réessayer » reprend la même clé et la même fiche',
    async (_name, reply) => {
      let attempt = 0
      const api = creatingServer({
        handlers: {
          create: (body) => {
            attempt += 1
            if (attempt === 1) {
              return reply ?? apiError(500, 'INTERNAL_ERROR', 'Erreur interne.')
            }
            return json(201, {
              data: { patient_id: body['patient_id'], record_number: 'EE-2026-0001', version: 1 },
            })
          },
          get: () => json(200, { data: patient() }),
        },
      })
      const { root, router, unmount } = await openApp('/patients/nouveau')
      await fillValidIdentity(root)

      await submitForm(root)

      expect(textOf(root)).toContain('Enregistrement non confirmé')
      expect(textOf(root)).toContain('la commande a pu être appliquée')
      expect(textOf(root)).not.toContain('Synchronisé avec le serveur')
      expect(field(root, 'Nom').value).toBe('PATIENT FICTIF')
      expect(field(root, 'Nom').disabled).toBe(false)
      expect(router.currentRoute.value.name).toBe('patient-nouveau')

      await click(buttonByName(root, 'Réessayer l’enregistrement'))

      expect(posts(api)).toHaveLength(2)
      const [first, second] = posts(api)
      expect(second?.headers['Idempotency-Key']).toBe(first?.headers['Idempotency-Key'])
      expect(second?.body).toEqual(first?.body)
      expect(router.currentRoute.value.name).toBe('patient')
      unmount()
    },
  )

  it('un double clic sur « Réessayer » ne renvoie qu’une commande', async () => {
    let attempt = 0
    const api = creatingServer({
      handlers: {
        create: (body) => {
          attempt += 1
          return attempt === 1
            ? 'network'
            : json(201, {
                data: { patient_id: body['patient_id'], record_number: 'EE-2026-0001', version: 1 },
              })
        },
        get: () => json(200, { data: patient() }),
      },
    })
    const { root, unmount } = await openApp('/patients/nouveau')
    await fillValidIdentity(root)
    await submitForm(root)

    const retry = buttonByName(root, 'Réessayer l’enregistrement')
    retry?.click()
    retry?.click()
    await flushPromises()

    expect(posts(api)).toHaveLength(2)
    unmount()
  })

  it('session expirée : saisie conservée, « Se reconnecter » proposé, reprise avec la même clé', async () => {
    let attempt = 0
    const api = creatingServer({
      handlers: {
        create: (body) => {
          attempt += 1
          return attempt === 1
            ? apiError(401, 'AUTH_REQUIRED', 'Connexion requise.')
            : json(201, {
                data: { patient_id: body['patient_id'], record_number: 'EE-2026-0001', version: 1 },
              })
        },
        get: () => json(200, { data: patient() }),
      },
    })
    const { root, router, unmount } = await openApp('/patients/nouveau')
    await fillValidIdentity(root)
    const reconnected = api.me
    api.me = 'anonymous'

    await submitForm(root)

    expect(textOf(root)).toContain('Session expirée')
    expect(textOf(root)).toContain('Session expirée : vos saisies sont conservées')
    expect(buttonByName(root, 'Se reconnecter')).not.toBeNull()
    expect(field(root, 'Nom').value).toBe('PATIENT FICTIF')
    expect(router.currentRoute.value.name).toBe('patient-nouveau')

    // Reconnexion faite (ici dans un autre onglet) : la reprise garde la clé.
    api.me = reconnected
    await click(buttonByName(root, 'Réessayer l’enregistrement'))

    expect(posts(api)).toHaveLength(2)
    expect(posts(api)[1]?.headers['Idempotency-Key']).toBe(
      posts(api)[0]?.headers['Idempotency-Key'],
    )
    expect(router.currentRoute.value.name).toBe('patient')
    unmount()
  })

  it('un autre compte connecté entre-temps : rien n’est envoyé en son nom', async () => {
    const api = creatingServer({
      handlers: { create: () => apiError(401, 'AUTH_REQUIRED', 'Connexion requise.') },
    })
    const { root, unmount } = await openApp('/patients/nouveau')
    await fillValidIdentity(root)
    api.me = 'anonymous'
    await submitForm(root)

    api.me = meResponse(RECEPTION, 'Autre Personne', ['patients'])
    api.me.data.id = '01J9ZXK4M2Q8R7S6T5V4W39999'
    await click(buttonByName(root, 'Réessayer l’enregistrement'))

    expect(posts(api)).toHaveLength(1)
    expect(textOf(root)).toContain('Compte différent')
    expect(field(root, 'Nom').value).toBe('PATIENT FICTIF')
    unmount()
  })
})

describe('droits et garde de saisie', () => {
  it('sans patient.create : accès refusé, aucun formulaire', async () => {
    const api = creatingServer({ permissions: READER })
    const { root, router, unmount } = await openApp('/patients/nouveau')

    expect(router.currentRoute.value.name).toBe('acces-refuse')
    expect(root.querySelector('form')).toBeNull()
    expect(posts(api)).toHaveLength(0)
    unmount()
  })

  it('quitter avec une saisie non enregistrée demande confirmation', async () => {
    creatingServer()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { root, router, unmount } = await openApp('/patients/nouveau')
    await type(root, 'Nom', 'PATIENT FICTIF')

    await router.push('/patients')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).toBe('patient-nouveau')
    expect(field(root, 'Nom').value).toBe('PATIENT FICTIF')

    confirm.mockReturnValue(true)
    await router.push('/patients')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('patients')
    unmount()
  })

  it('un formulaire vierge se quitte sans confirmation', async () => {
    creatingServer()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { router, unmount } = await openApp('/patients/nouveau')

    await router.push('/patients')
    await flushPromises()

    expect(confirm).not.toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('patients')
    unmount()
  })

  it('l’accueil et le menu mènent à l’écran quand le module est ouvert', async () => {
    creatingServer()
    const { root, unmount } = await openApp('/')

    expect(linkTo(root, '/patients/nouveau')?.textContent?.trim()).toBe('Nouveau patient')
    expect(linkTo(root, '/patients')).not.toBeNull()
    unmount()
  })
})
