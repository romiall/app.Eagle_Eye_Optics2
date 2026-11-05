import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  apiError,
  box,
  buttonByName,
  click,
  CLINICIAN,
  CONSULTATION_ID,
  CONSULTATION_URL,
  consultation,
  consultationReads,
  field,
  ID_A,
  linkTo,
  json,
  openConsultation,
  patchCalls,
  patientSummary,
  patient,
  READ_ONLY,
  resetEverything,
  stubConsultationApi,
  textOf,
} from './support'

// Écran de consultation (C01 à C03) : ouverture, en-tête patient (identité rendue avec la consultation),
// état du travail, sept étapes, états de lecture (hors ligne = « Consultation indisponible », jamais une
// consultation vide), droits, lecture seule, examen terminé, module fermé. Données FICTIVES.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-22T09:42:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  resetEverything()
})

describe('ouverture de la consultation', () => {
  it('lit la consultation, montre l’en-tête patient, l’état du travail et les sept étapes du dossier', async () => {
    const api = stubConsultationApi()
    const { root, router, unmount } = await openConsultation()

    expect(document.title).toBe('Consultation – Eagle’s Eye Optics Medical')
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Consultation')
    expect(consultationReads(api)[0]?.path).toBe(`/api/v1/consultations/${CONSULTATION_ID}`)
    const banner = root.querySelector('[aria-label="Patient et consultation"]') as HTMLElement
    const text = textOf(banner)
    // Identité, dossier, âge, date et heure de la consultation (heure du cabinet), professionnel.
    expect(text).toContain('PATIENT FICTIF Élodie Marie')
    expect(text).toContain('Dossier EE-2026-0001')
    expect(text).toContain('36 ans')
    expect(text).toContain('Consultation du 22/10/2026 à 10h42')
    expect(text).toContain('Professionnel : Dr Fictif')
    expect(text).toContain('Brouillon')

    const stepper = root.querySelector('nav[aria-label="Étapes de la consultation"]') as HTMLElement
    expect([...stepper.querySelectorAll('li')].map((item) => textOf(item).trim())).toEqual([
      '1.Motif et lunettes',
      '2.Antécédents',
      '3.Acuité visuelle',
      '4.Réfraction',
      '5.Centrage',
      '6.Médicaments',
      '7.Conclusion et orientation',
    ])
    expect(stepper.querySelector('[aria-current="step"]')?.textContent).toContain(
      'Motif et lunettes',
    )
    expect(
      root.querySelector('h2#consultation-etape')?.textContent?.replace(/\s+/g, ' ').trim(),
    ).toBe('Étape 1 sur 7 : Motif et lunettes')
    expect(router.currentRoute.value.fullPath).toBe(CONSULTATION_URL)
    unmount()
  })

  it('l’adresse ne porte que l’identifiant de la consultation, jamais une donnée de santé ni de stockage', async () => {
    stubConsultationApi()
    const { router, unmount } = await openConsultation()

    expect(router.currentRoute.value.fullPath).toBe(`/consultations/${CONSULTATION_ID}`)
    expect(router.currentRoute.value.query).toEqual({})
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
    unmount()
  })

  it('un brouillon sans étape enregistrée ne propose pas « Terminer l’examen » ; aucun faux « Terminé »', async () => {
    stubConsultationApi()
    const { root, unmount } = await openConsultation()

    expect(buttonByName(root, /terminer l’examen/i)).toBeNull()
    expect(textOf(root)).not.toContain('Examen terminé')
    expect(textOf(root)).not.toMatch(/rendez-vous|à revoir/i)
    unmount()
  })

  it('un examen en cours propose « Terminer l’examen » au compte qui peut finaliser, jamais à un autre', async () => {
    stubConsultationApi({ consultation: consultation({ status: 'IN_PROGRESS', version: 2 }) })
    const first = await openConsultation()
    expect(buttonByName(first.root, 'Terminer l’examen')).not.toBeNull()
    first.unmount()

    resetEverything()
    stubConsultationApi({
      permissions: ['clinical.read', 'clinical.write', 'patient.read', 'agenda.read'],
      consultation: consultation({ status: 'IN_PROGRESS', version: 2 }),
    })
    const second = await openConsultation()
    expect(buttonByName(second.root, 'Terminer l’examen')).toBeNull()
    second.unmount()
  })

  it('« En cours » une fois qu’une étape est enregistrée, « Brouillon » avant', async () => {
    stubConsultationApi({ consultation: consultation({ status: 'IN_PROGRESS', version: 3 }) })
    const { root, unmount } = await openConsultation()

    const banner = textOf(
      root.querySelector('[aria-label="Patient et consultation"]') as HTMLElement,
    )
    expect(banner).toContain('En cours')
    expect(banner).not.toContain('Brouillon')
    unmount()
  })

  it('un examen orienté montre le badge « Orienté vers ophtalmologiste » et le niveau, jamais l’axe rendez-vous', async () => {
    stubConsultationApi({
      consultation: consultation({
        status: 'IN_PROGRESS',
        steps: {
          CONCLUSION: {
            conclusion: 'À orienter',
            referral: true,
            referral_urgency: 'RAPID',
            referral_reasons: [],
          },
        },
      }),
    })
    const { root, unmount } = await openConsultation()

    const banner = textOf(
      root.querySelector('[aria-label="Patient et consultation"]') as HTMLElement,
    )
    expect(banner).toContain('Orienté vers ophtalmologiste')
    expect(banner).toContain('Consultation rapide')
    expect(banner).not.toMatch(/rendez-vous/i)
    unmount()
  })

  it('un examen non orienté n’affiche pas de badge d’orientation', async () => {
    stubConsultationApi({
      consultation: consultation({
        steps: {
          CONCLUSION: {
            conclusion: null,
            referral: false,
            referral_urgency: null,
            referral_reasons: [],
          },
        },
      }),
    })
    const { root, unmount } = await openConsultation()

    expect(textOf(root)).not.toContain('Orienté vers ophtalmologiste')
    unmount()
  })

  it('le professionnel n’est nommé que si c’est le compte connecté (la consultation ne porte que son identifiant)', async () => {
    stubConsultationApi({
      consultation: consultation({ clinician_id: '01J9ZXK4M2Q8R7S6T5V4W39999' }),
    })
    const { root, unmount } = await openConsultation()

    expect(textOf(root)).not.toContain('Professionnel :')
    unmount()
  })

  it('l’en-tête patient reste fixe sur écran large (sticky à partir de 1024 px) et compact sur mobile', async () => {
    stubConsultationApi()
    const { root, unmount } = await openConsultation()

    const banner = root.querySelector('[aria-label="Patient et consultation"]') as HTMLElement
    expect(banner.className).toContain('lg:sticky')
    expect(banner.className).toContain('lg:top-0')
    expect(root.querySelector('main')?.innerHTML).not.toContain('overflow-x-')
    unmount()
  })
})

describe('états de lecture : jamais une consultation vide', () => {
  it('serveur injoignable : « Consultation indisponible », aucun formulaire ; « Réessayer » relit', async () => {
    let up = false
    const api = stubConsultationApi({
      handlers: { getConsultation: () => (up ? json(200, { data: consultation() }) : 'network') },
    })
    const { root, unmount } = await openConsultation()

    expect(textOf(root)).toContain('Consultation indisponible')
    expect(textOf(root)).toContain('Aucune ancienne copie ni consultation vide n’est présentée.')
    expect(root.querySelector('form')).toBeNull()
    expect(root.querySelector('fieldset')).toBeNull()
    expect(buttonByName(root, 'Enregistrer')).toBeNull()

    up = true
    await click(buttonByName(root, 'Réessayer'))

    expect(consultationReads(api)).toHaveLength(2)
    expect(textOf(root)).not.toContain('Consultation indisponible')
    expect(root.querySelector('form')).not.toBeNull()
    unmount()
  })

  it.each([
    ['une erreur 500', () => apiError(500, 'INTERNAL_ERROR', 'Erreur interne.')],
    [
      'une page d’erreur de l’hébergeur',
      () =>
        new Response('<!DOCTYPE html><html><body>503</body></html>', {
          status: 503,
          headers: { 'Content-Type': 'text/html' },
        }),
    ],
  ])('%s : « Consultation indisponible », pas une consultation vide', async (_name, reply) => {
    stubConsultationApi({ handlers: { getConsultation: reply } })
    const { root, unmount } = await openConsultation()

    expect(textOf(root)).toContain('Consultation indisponible')
    expect(root.querySelector('form')).toBeNull()
    unmount()
  })

  it('une réponse qui n’a pas la forme d’une consultation n’est jamais affichée comme une consultation vide', async () => {
    stubConsultationApi({
      handlers: { getConsultation: () => json(200, { data: { id: CONSULTATION_ID } }) },
    })
    const { root, unmount } = await openConsultation()

    expect(textOf(root)).toContain('Consultation indisponible')
    expect(root.querySelector('form')).toBeNull()
    unmount()
  })

  it('consultation inconnue (404) : « Consultation introuvable », ce n’est pas un vide', async () => {
    stubConsultationApi({
      handlers: { getConsultation: () => apiError(404, 'RESOURCE_NOT_FOUND', 'Introuvable.') },
    })
    const { root, unmount } = await openConsultation()

    expect(textOf(root)).toContain('Consultation introuvable')
    expect(root.querySelector('form')).toBeNull()
    unmount()
  })

  it('droits refusés par le serveur (403) : « Droits insuffisants », rien n’est affiché', async () => {
    stubConsultationApi({
      handlers: {
        getConsultation: () => apiError(403, 'ACTION_FORBIDDEN', 'Action non autorisée.'),
      },
    })
    const { root, unmount } = await openConsultation()

    expect(textOf(root)).toContain('Droits insuffisants')
    expect(root.querySelector('form')).toBeNull()
    unmount()
  })

  it('session expirée à l’ouverture (401) : « Session expirée » avec « Se reconnecter », « Réessayer » relit', async () => {
    let expired = true
    const api = stubConsultationApi({
      handlers: {
        getConsultation: () =>
          expired
            ? apiError(401, 'AUTH_REQUIRED', 'Connexion requise.')
            : json(200, { data: consultation() }),
      },
    })
    const reconnected = api.me
    const { root, unmount } = await openConsultation()
    api.me = 'anonymous'
    await click(buttonByName(root, 'Réessayer'))

    expect(textOf(root)).toContain('Session expirée')
    expect(buttonByName(root, 'Se reconnecter')).not.toBeNull()
    expect(root.querySelector('form')).toBeNull()

    expired = false
    api.me = reconnected
    await click(buttonByName(root, 'Réessayer'))
    expect(root.querySelector('form')).not.toBeNull()
    unmount()
  })
})

describe('identité du patient', () => {
  it('l’identité vient de la consultation elle-même : aucune lecture de la fiche patient n’est nécessaire', async () => {
    const api = stubConsultationApi({
      handlers: { getPatient: () => 'network' },
    })
    const { root, unmount } = await openConsultation()

    expect(textOf(root)).toContain('PATIENT FICTIF Élodie Marie')
    expect(root.querySelector('form')).not.toBeNull()
    expect(
      api.requests.filter((request) => request.path === `/api/v1/patients/${ID_A}`),
    ).toHaveLength(0)
    unmount()
  })

  it('sans patient.read ni module Patients, l’en-tête reste renseigné (identité de base rendue avec clinical.read)', async () => {
    stubConsultationApi({
      permissions: ['clinical.read', 'clinical.write'],
      modules: ['today', 'consultations'],
    })
    const { root, unmount } = await openConsultation()

    const banner = textOf(
      root.querySelector('[aria-label="Patient et consultation"]') as HTMLElement,
    )
    expect(banner).toContain('PATIENT FICTIF Élodie Marie')
    expect(banner).toContain('Dossier EE-2026-0001')
    unmount()
  })

  it('l’en-tête montre le patient de la consultation, jamais une autre fiche', async () => {
    stubConsultationApi({
      patient: patient({ id: '01J9ZXK4M2Q8R7S6T5V4W39998', last_name: 'AUTRE PATIENT' }),
      consultation: consultation({
        patient: patientSummary(patient({ last_name: 'PATIENT DE LA CONSULTATION' })),
      }),
    })
    const { root, unmount } = await openConsultation()

    expect(textOf(root)).toContain('PATIENT DE LA CONSULTATION')
    expect(textOf(root)).not.toContain('AUTRE PATIENT')
    unmount()
  })
})

describe('droits et module', () => {
  it('sans clinical.read : accès refusé, rien n’est lu', async () => {
    const api = stubConsultationApi({
      permissions: ['patient.read', 'visit.register', 'agenda.read'],
    })
    const { root, router, unmount } = await openConsultation()

    expect(router.currentRoute.value.name).toBe('acces-refuse')
    expect(consultationReads(api)).toHaveLength(0)
    expect(root.querySelector('form')).toBeNull()
    unmount()
  })

  it('module « consultations » fermé : « Page introuvable », rien n’est lu', async () => {
    const api = stubConsultationApi({ modules: ['today', 'patients'] })
    const { root, unmount } = await openConsultation()

    expect(root.querySelector('h1')?.textContent).toBe('Page introuvable')
    expect(consultationReads(api)).toHaveLength(0)
    unmount()
  })

  it('une adresse qui n’est pas un identifiant : « Page introuvable »', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation('/consultations/abc')

    expect(root.querySelector('h1')?.textContent).toBe('Page introuvable')
    expect(consultationReads(api)).toHaveLength(0)
    unmount()
  })

  // L'entrée « Consultations » a désormais son écran de liste (liste des examens, phase 1) : elle est
  // proposée avec clinical.read et mène à cette liste. Sans ce droit, elle reste cachée
  // (tests/frontend/shell/navigation.test.ts, profil caisse).
  it('l’entrée « Consultations » du menu mène à la liste des examens', async () => {
    stubConsultationApi()
    const { root, unmount } = await openConsultation()

    const menu = [...root.querySelectorAll('nav[aria-label="Navigation principale"] a')].map(
      (link) => link.textContent?.trim(),
    )
    expect(menu).toContain('Consultations')
    expect(linkTo(root, '/consultations')).not.toBeNull()
    unmount()
  })

  it('sans clinical.write : lecture seule, champs désactivés, aucun bouton d’enregistrement', async () => {
    const api = stubConsultationApi({
      permissions: READ_ONLY,
      consultation: consultation({
        status: 'IN_PROGRESS',
        steps: {
          ANAMNESIS: {
            symptoms: 'Vision floue le soir',
            wears_glasses: null,
            glasses_duration: null,
            previous_correction_available: null,
            complaints: [
              { id: '01J9ZXK4M2Q8R7S6T5V4W30601', term_code: 'BLURRED_VISION', other_text: null },
            ],
          },
        },
      }),
    })
    const { root, unmount } = await openConsultation()

    expect(textOf(root)).toContain('Lecture seule')
    expect(field(root, 'Plaintes et symptômes').value).toBe('Vision floue le soir')
    expect(box(root, 'Vision floue').checked).toBe(true)
    const controls = [
      ...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'main form input, main form textarea',
      ),
    ]
    expect(controls.length).toBeGreaterThan(10)
    expect(controls.every((control) => control.disabled)).toBe(true)
    expect(buttonByName(root, 'Enregistrer')).toBeNull()
    expect(root.querySelector('button[type="submit"]')).toBeNull()
    expect(textOf(root)).not.toContain('« Suivant » enregistre')

    // La lecture seule se parcourt : Suivant ne fait que passer à l'étape suivante, sans rien envoyer.
    await click(buttonByName(root, 'Suivant'))
    expect(root.querySelector('h2#consultation-etape')?.textContent).toContain('Étape 2 sur 7')
    expect(patchCalls(api)).toHaveLength(0)
    unmount()
  })

  it('un examen terminé est en lecture seule : dit, aucun bouton d’enregistrement, correction motivée proposée', async () => {
    stubConsultationApi({
      consultation: consultation({
        status: 'COMPLETED',
        current_revision: 1,
        completed_at: '2026-10-22T09:50:00.000Z',
        revisions: [
          {
            id: '01J9ZXK4M2Q8R7S6T5V4W30901',
            revision_no: 1,
            recorded_at: '2026-10-22T09:50:00.000Z',
            author_id: '01J9ZXK4M2Q8R7S6T5V4W30002',
            reason: 'Finalisation de la consultation',
            previous_revision_id: null,
            sha256: 'a'.repeat(64),
          },
        ],
      }),
    })
    const { root, unmount } = await openConsultation()

    expect(textOf(root)).toContain('Examen terminé')
    expect(textOf(root)).toContain('révision 1 sur 1 enregistrée(s)')
    expect(buttonByName(root, 'Enregistrer')).toBeNull()
    expect(buttonByName(root, 'Terminer l’examen')).toBeNull()
    expect(buttonByName(root, 'Corriger l’examen')).not.toBeNull()
    expect(linkTo(root, `/consultations/${CONSULTATION_ID}/historique`)).not.toBeNull()
    const controls = [
      ...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'main form input, main form textarea',
      ),
    ]
    expect(controls.every((control) => control.disabled)).toBe(true)
    unmount()
  })

  it('sans clinical.amend, un examen terminé ne propose pas de correction', async () => {
    stubConsultationApi({
      permissions: READ_ONLY,
      consultation: consultation({
        status: 'COMPLETED',
        current_revision: 1,
        completed_at: '2026-10-22T09:50:00.000Z',
      }),
    })
    const { root, unmount } = await openConsultation()

    expect(textOf(root)).toContain('Examen terminé')
    expect(buttonByName(root, 'Corriger l’examen')).toBeNull()
    unmount()
  })

  it('un examen terminé propose « Transmettre à la caisse » (facture avec patient et visite déjà renseignés) à qui peut facturer', async () => {
    const done = consultation({
      status: 'COMPLETED',
      current_revision: 1,
      completed_at: '2026-10-22T09:50:00.000Z',
    })
    stubConsultationApi({ permissions: [...CLINICIAN, 'invoice.create'], consultation: done })
    const { root, unmount } = await openConsultation()

    const invoice = [...root.querySelectorAll('a')].find(
      (link) => link.textContent?.trim() === 'Transmettre à la caisse',
    )
    expect(invoice?.getAttribute('href')).toBe(
      `/ventes/factures/nouvelle?patient=${ID_A}&visite=${done.visit_id}`,
    )
    expect(invoice?.getAttribute('aria-label')).toMatch(
      /^Transmettre à la caisse : créer la facture de /,
    )
    // Qui peut facturer n'a pas besoin qu'on lui dise où la caisse crée la facture.
    expect(textOf(root)).not.toContain('Le patient peut passer à la caisse')
    unmount()
  })

  it('sans droit de facturer (professionnel seul), aucun bouton : l’écran dit où la caisse crée la facture', async () => {
    stubConsultationApi({
      permissions: CLINICIAN,
      consultation: consultation({
        status: 'COMPLETED',
        current_revision: 1,
        completed_at: '2026-10-22T09:50:00.000Z',
      }),
    })
    const { root, unmount } = await openConsultation()

    expect(textOf(root)).toContain('Examen terminé')
    expect(buttonByName(root, 'Transmettre à la caisse')).toBeNull()
    expect([...root.querySelectorAll('a')].map((link) => link.textContent?.trim())).not.toContain(
      'Transmettre à la caisse',
    )
    expect(textOf(root)).toContain(
      'Le patient peut passer à la caisse : la facture se crée depuis « Aujourd’hui », avec « Créer une facture ».',
    )
    unmount()
  })

  it('le module des ventes fermé : ni bouton, ni phrase sur la caisse', async () => {
    stubConsultationApi({
      permissions: [...CLINICIAN, 'invoice.create'],
      modules: ['today', 'patients', 'consultations'],
      consultation: consultation({
        status: 'COMPLETED',
        current_revision: 1,
        completed_at: '2026-10-22T09:50:00.000Z',
      }),
    })
    const { root, unmount } = await openConsultation()

    expect(textOf(root)).toContain('Examen terminé')
    expect(textOf(root)).not.toContain('caisse')
    unmount()
  })

  it('pendant l’examen, un bloc mène à la prescription optique ; terminé, le lien est dans « Examen terminé »', async () => {
    stubConsultationApi({ permissions: CLINICIAN })
    const running = await openConsultation()
    const card = running.root.querySelector('section[aria-labelledby="titre-prescription"]')
    expect(card?.querySelector('h2')?.textContent?.trim()).toBe('Prescription optique')
    expect(card?.querySelector('a')?.getAttribute('href')).toBe(
      `/consultations/${CONSULTATION_ID}/prescriptions`,
    )
    expect(textOf(card as Element)).toContain('Elle ne copie jamais la réfraction d’elle-même')
    running.unmount()

    resetEverything()
    stubConsultationApi({
      permissions: CLINICIAN,
      consultation: consultation({
        status: 'COMPLETED',
        current_revision: 1,
        completed_at: '2026-10-22T09:50:00.000Z',
      }),
    })
    const done = await openConsultation()
    expect(done.root.querySelector('section[aria-labelledby="titre-prescription"]')).toBeNull()
    expect(linkTo(done.root, `/consultations/${CONSULTATION_ID}/prescriptions`)).not.toBeNull()
    done.unmount()
  })

  it('l’en-tête porte la profession du dossier quand elle est connue, rien sinon', async () => {
    stubConsultationApi({ permissions: CLINICIAN })
    const known = await openConsultation()
    const banner = known.root.querySelector('[aria-label="Patient et consultation"]') as Element
    expect(textOf(banner)).toContain('Profession : Enseignante')
    known.unmount()

    resetEverything()
    stubConsultationApi({
      permissions: CLINICIAN,
      consultation: consultation({ patient: { ...patientSummary(), profession: null } }),
    })
    const unknown = await openConsultation()
    const emptyBanner = unknown.root.querySelector(
      '[aria-label="Patient et consultation"]',
    ) as Element
    expect(textOf(emptyBanner)).not.toContain('Profession :')
    unknown.unmount()
  })

  it('le professionnel (CLINICIAN) voit les boutons Précédent, Enregistrer et Suivant', async () => {
    stubConsultationApi({ permissions: CLINICIAN })
    const { root, unmount } = await openConsultation()

    // Hors boutons d'aide à la saisie (symptômes courants), que les groupes `role="group"` portent.
    const labels = [...root.querySelectorAll('main form button')]
      .filter((button) => button.closest('[role="group"]') === null)
      .map((button) => button.textContent?.replace(/\s+/g, ' ').trim())
    expect(labels).toEqual(['Précédent', 'Enregistrer', 'Suivant'])
    expect((buttonByName(root, 'Précédent') as HTMLButtonElement).disabled).toBe(true)
    expect(textOf(root)).toContain(
      '« Suivant » enregistre l’étape sur le serveur avant de passer à la suivante.',
    )
    unmount()
  })

  it('tous les contrôles de la consultation font 44 px au moins et sont nommés', async () => {
    stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await flushPromises()

    const buttons = [...root.querySelectorAll<HTMLButtonElement>('main button')]
    expect(buttons.length).toBeGreaterThan(3)
    for (const button of buttons) {
      expect(button.className, button.outerHTML).toContain('min-h-11')
      expect(button.textContent?.trim() ?? '', button.outerHTML).not.toBe('')
    }
    for (const label of root.querySelectorAll<HTMLLabelElement>('main fieldset label')) {
      expect(label.className, label.outerHTML).toContain('min-h-11')
    }
    for (const input of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'main form input, main form textarea',
    )) {
      expect(input.labels?.length, input.outerHTML).toBe(1)
    }
    unmount()
  })
})
