import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  box,
  buttonByName,
  choice,
  choose,
  click,
  CONSULTATION_ID,
  consultation,
  errorWithDetails,
  field,
  group,
  hasField,
  json,
  openConsultation,
  patchCalls,
  resetEverything,
  stubConsultationApi,
  submitForm,
  textOf,
  toggle,
  type,
} from './support'

// Les étapes narratives (C01) parmi les sept du dossier : motif et lunettes, antécédents, conclusion et
// orientation (les étapes mesurées et les médicaments ont leurs propres tests). Enregistrement étape par étape (version lue, clé d'idempotence), « Suivant » enregistre avant
// d'avancer, « Enregistré sur le serveur à 10h42 » seulement après la réponse. Données FICTIVES.
const ULID = /^[0-9A-Z]{26}$/

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-22T09:42:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  resetEverything()
})

/** Va à une étape par la liste des étapes (sans rien enregistrer), comme l'utilisateur. */
async function goToStep(root: HTMLElement, position: number): Promise<void> {
  const stepper = root.querySelector('nav[aria-label="Étapes de la consultation"]') as HTMLElement
  await click([...stepper.querySelectorAll('button')][position - 1] ?? null)
}

function stepTitle(root: HTMLElement): string {
  return (root.querySelector('h2#consultation-etape')?.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

describe('étape 1 : motif et lunettes', () => {
  it('Enregistrer envoie la rubrique complète avec la version lue et une clé d’idempotence, puis dit « Enregistré sur le serveur à 10h42 »', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await toggle(root, 'Douleur')
    await toggle(root, 'Vision floue')
    await type(root, 'Plaintes et symptômes', '  Gêne le soir  ')
    await choice(root, 'Porte actuellement des lunettes', 'Oui')
    await type(root, 'Depuis combien de temps', '2 ans')
    await choice(root, 'Ancienne correction disponible', 'Non')

    expect(textOf(root)).toContain('Modifications non enregistrées sur cette étape.')
    expect(textOf(root)).not.toContain('Enregistré sur le serveur')

    await click(buttonByName(root, 'Enregistrer'))

    expect(patchCalls(api)).toHaveLength(1)
    const [call] = patchCalls(api)
    expect(call?.path).toBe(`/api/v1/consultations/${CONSULTATION_ID}/steps/ANAMNESIS`)
    expect(call?.headers['Idempotency-Key']).toMatch(ULID)
    const body = call?.body as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['consultation_id', 'expected_version', 'step'])
    expect(body['expected_version']).toBe(1)
    expect(body['consultation_id']).toBe(CONSULTATION_ID)
    const step = body['step'] as { step: string; data: Record<string, unknown> }
    expect(step.step).toBe('ANAMNESIS')
    // Motifs dans l'ordre du référentiel (vision floue avant douleur), un identifiant par ligne.
    const complaints = step.data['complaints'] as {
      id: string
      term_code: string
      other_text: unknown
    }[]
    expect(complaints.map((row) => [row.term_code, row.other_text])).toEqual([
      ['BLURRED_VISION', null],
      ['PAIN', null],
    ])
    expect(complaints.every((row) => ULID.test(row.id))).toBe(true)
    expect({ ...step.data, complaints: undefined }).toEqual({
      symptoms: 'Gêne le soir',
      wears_glasses: true,
      glasses_duration: '2 ans',
      previous_correction_available: false,
      complaints: undefined,
    })

    // La réponse du serveur confirme : seulement alors, l'enregistrement est dit.
    const text = textOf(root)
    expect(text).toContain('Enregistré sur le serveur à 10h42')
    expect(text).not.toContain('Enregistré sur ce poste')
    expect(text).not.toContain('Synchronisé')
    expect(text).not.toContain('Modifications non enregistrées')
    expect(
      textOf(root.querySelector('[aria-label="Patient et consultation"]') as HTMLElement),
    ).toContain('En cours')
    unmount()
  })

  it('rien n’a changé : aucun appel, le dit', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()

    await click(buttonByName(root, 'Enregistrer'))

    expect(patchCalls(api)).toHaveLength(0)
    expect(textOf(root)).toContain('Aucune modification à enregistrer sur cette étape.')
    expect(textOf(root)).not.toContain('Enregistré sur le serveur')
    unmount()
  })

  it('le texte « Autre » apparaît quand la case est cochée, disparaît quand elle est décochée', async () => {
    stubConsultationApi()
    const { root, unmount } = await openConsultation()
    expect(hasField(root, 'Autre motif : précisez')).toBe(false)

    await toggle(root, 'Autre')
    expect(hasField(root, 'Autre motif : précisez')).toBe(true)
    expect(field(root, 'Autre motif : précisez').getAttribute('required')).not.toBeNull()
    expect(textOf(root)).toContain('Autre motif : précisez (obligatoire)')

    await toggle(root, 'Autre')
    expect(hasField(root, 'Autre motif : précisez')).toBe(false)
    unmount()
  })

  it('« Autre » sans précision est refusé sous le champ et dans le résumé, sans appel ; la précision l’envoie', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await toggle(root, 'Douleur')
    await toggle(root, 'Autre')

    await submitForm(root)

    expect(patchCalls(api)).toHaveLength(0)
    const summary = root.querySelector('[role="alert"]') as HTMLElement
    expect(summary.textContent).toContain('Motif : précisez la valeur « Autre ».')
    expect(document.activeElement).toBe(summary)
    expect(field(root, 'Autre motif : précisez').getAttribute('aria-invalid')).toBe('true')
    expect(box(root, 'Douleur').checked).toBe(true)

    // Le lien du résumé mène au champ à corriger.
    ;(summary.querySelector('a') as HTMLAnchorElement).click()
    expect(document.activeElement).toBe(field(root, 'Autre motif : précisez'))

    await type(root, 'Autre motif : précisez', 'Gêne au soleil')
    expect(root.querySelector('[role="alert"]')).toBeNull()
    await submitForm(root)
    const data = (patchCalls(api)[0]?.body?.['step'] as { data: { complaints: unknown[] } }).data
    expect(data.complaints).toEqual([
      { id: expect.stringMatching(ULID), term_code: 'PAIN', other_text: null },
      { id: expect.stringMatching(ULID), term_code: 'OTHER', other_text: 'Gêne au soleil' },
    ])
    unmount()
  })

  it('porte des lunettes : durée et ancienne correction n’existent que pour « Oui » et ne partent jamais autrement', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    expect(hasField(root, 'Depuis combien de temps')).toBe(false)
    expect(() => group(root, 'Ancienne correction disponible')).toThrow()

    await choice(root, 'Porte actuellement des lunettes', 'Oui')
    expect(hasField(root, 'Depuis combien de temps')).toBe(true)
    await type(root, 'Depuis combien de temps', '3 ans')
    await choice(root, 'Ancienne correction disponible', 'Oui')

    // Changer d'avis : les champs sont masqués, l'écran dit qu'ils ne seront pas enregistrés.
    await choice(root, 'Porte actuellement des lunettes', 'Non')
    expect(hasField(root, 'Depuis combien de temps')).toBe(false)
    expect(textOf(root)).toContain(
      'La durée et l’ancienne correction saisies ne sont pas enregistrées tant que « Porte actuellement des lunettes » n’est pas « Oui ».',
    )
    // Rétablir « Oui » avant d'enregistrer retrouve ce qui avait été saisi.
    await choice(root, 'Porte actuellement des lunettes', 'Oui')
    expect(field(root, 'Depuis combien de temps').value).toBe('3 ans')
    expect(textOf(root)).not.toContain('ne sont pas enregistrées tant que')

    await choice(root, 'Porte actuellement des lunettes', 'Non')
    await click(buttonByName(root, 'Enregistrer'))
    const data = (patchCalls(api)[0]?.body?.['step'] as { data: Record<string, unknown> }).data
    expect(data['wears_glasses']).toBe(false)
    expect(data['glasses_duration']).toBeNull()
    expect(data['previous_correction_available']).toBeNull()

    // Après l'enregistrement, l'écran repart de ce que le serveur a : rien de caché n'a été gardé.
    await choice(root, 'Porte actuellement des lunettes', 'Oui')
    expect(field(root, 'Depuis combien de temps').value).toBe('')
    unmount()
  })

  it('« Non renseigné » aux lunettes est une réponse à part : jamais envoyée comme « Non »', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await choice(root, 'Porte actuellement des lunettes', 'Non')
    await choice(root, 'Porte actuellement des lunettes', 'Non renseigné')
    // Retour à l'état enregistré : plus rien à envoyer.
    await click(buttonByName(root, 'Enregistrer'))
    expect(patchCalls(api)).toHaveLength(0)

    await toggle(root, 'Douleur')
    await click(buttonByName(root, 'Enregistrer'))
    const data = (patchCalls(api)[0]?.body?.['step'] as { data: Record<string, unknown> }).data
    expect(data['wears_glasses']).toBeNull()
    unmount()
  })

  it('relit l’étape enregistrée sur le serveur : motifs cochés, précision, lunettes', async () => {
    stubConsultationApi({
      consultation: consultation({
        status: 'IN_PROGRESS',
        version: 4,
        steps: {
          ANAMNESIS: {
            symptoms: 'Vision floue de loin',
            wears_glasses: true,
            glasses_duration: 'depuis l’enfance',
            previous_correction_available: true,
            complaints: [
              {
                id: '01J9ZXK4M2Q8R7S6T5V4W30601',
                term_code: 'DISTANCE_DIFFICULTY',
                other_text: null,
              },
              { id: '01J9ZXK4M2Q8R7S6T5V4W30602', term_code: 'OTHER', other_text: 'Éblouissement' },
            ],
          },
        },
      }),
    })
    const { root, unmount } = await openConsultation()

    expect(box(root, 'Difficulté de loin').checked).toBe(true)
    expect(box(root, 'Difficulté de près').checked).toBe(false)
    expect(field(root, 'Autre motif : précisez').value).toBe('Éblouissement')
    expect(field(root, 'Plaintes et symptômes').value).toBe('Vision floue de loin')
    expect(box(group(root, 'Porte actuellement des lunettes'), 'Oui').checked).toBe(true)
    expect(field(root, 'Depuis combien de temps').value).toBe('depuis l’enfance')
    expect(box(group(root, 'Ancienne correction disponible'), 'Oui').checked).toBe(true)
    // Rien n'a changé : pas de modification à enregistrer.
    expect(textOf(root)).not.toContain('Modifications non enregistrées')
    unmount()
  })

  it('un motif que cette version ne connaît pas reste coché, visible et renvoyé : jamais retiré à l’insu de la personne', async () => {
    const api = stubConsultationApi({
      consultation: consultation({
        status: 'IN_PROGRESS',
        version: 2,
        steps: {
          ANAMNESIS: {
            symptoms: null,
            wears_glasses: null,
            glasses_duration: null,
            previous_correction_available: null,
            complaints: [
              { id: '01J9ZXK4M2Q8R7S6T5V4W30901', term_code: 'NEW_TERM', other_text: null },
            ],
          },
        },
      }),
    })
    const { root, unmount } = await openConsultation()

    expect(box(root, 'NEW_TERM').checked).toBe(true)
    await toggle(root, 'Douleur')
    await click(buttonByName(root, 'Enregistrer'))

    const data = (patchCalls(api)[0]?.body?.['step'] as { data: { complaints: unknown[] } }).data
    expect(data.complaints).toEqual([
      { id: expect.stringMatching(ULID), term_code: 'PAIN', other_text: null },
      { id: '01J9ZXK4M2Q8R7S6T5V4W30901', term_code: 'NEW_TERM', other_text: null },
    ])
    unmount()
  })

  it('un double clic n’envoie qu’une commande', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await toggle(root, 'Douleur')
    const form = root.querySelector('main form') as HTMLFormElement

    form.dispatchEvent(new Event('submit', { cancelable: true }))
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()

    expect(patchCalls(api)).toHaveLength(1)
    unmount()
  })

  it('pendant l’envoi, les champs et les boutons sont désactivés ; le bouton annonce l’enregistrement en cours', async () => {
    let release: (response: Response) => void = () => undefined
    stubConsultationApi({
      handlers: {
        save: () =>
          new Promise<Response>((resolve) => {
            release = resolve
          }),
      },
    })
    const { root, unmount } = await openConsultation()
    await toggle(root, 'Douleur')

    ;(buttonByName(root, 'Enregistrer') as HTMLButtonElement).click()
    await flushPromises()

    const bar = [...root.querySelectorAll('main form button')].filter(
      (button) => button.closest('[role="group"]') === null,
    )
    expect(
      bar.map((button) => [button.textContent?.trim(), (button as HTMLButtonElement).disabled]),
    ).toEqual([
      ['Précédent', true],
      ['Enregistrement en cours…', true],
      ['Suivant', true],
    ])
    // Les boutons de symptômes courants sont désactivés comme le reste de la saisie.
    const chips = [...root.querySelectorAll('main form [role="group"] button')]
    expect(chips.length).toBeGreaterThan(0)
    expect(chips.every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
    expect((box(root, 'Douleur') as HTMLInputElement).disabled).toBe(true)
    expect(textOf(root)).toContain('Enregistrement en cours…')
    expect(textOf(root)).not.toContain('Enregistré sur le serveur')

    release(json(200, { data: consultation({ status: 'IN_PROGRESS', version: 2 }) }))
    await flushPromises()
    unmount()
  })

  it('après « Enregistrer », le focus reste sur le bouton d’enregistrement (jamais perdu dans la page)', async () => {
    stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await toggle(root, 'Douleur')

    await click(buttonByName(root, 'Enregistrer'))

    expect(document.activeElement?.id).toBe('consultation-enregistrer')
    unmount()
  })
})

describe('navigation entre les étapes', () => {
  it('« Suivant » enregistre l’étape puis avance ; le titre de l’étape prend le focus et l’étape courante est annoncée', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await toggle(root, 'Douleur')

    await click(buttonByName(root, 'Suivant'))

    expect(patchCalls(api)).toHaveLength(1)
    expect(patchCalls(api)[0]?.path).toContain('/steps/ANAMNESIS')
    expect(stepTitle(root)).toBe('Étape 2 sur 7 : Antécédents')
    expect(document.activeElement?.id).toBe('consultation-etape')
    expect(
      [...root.querySelectorAll('[role="status"].sr-only')].map((element) =>
        element.textContent?.trim(),
      ),
    ).toContain('Étape 2 sur 7 : Antécédents')
    const current = root.querySelector(
      'nav[aria-label="Étapes de la consultation"] [aria-current="step"]',
    )
    expect(current?.textContent).toContain('Antécédents')
    expect(textOf(root)).toContain('Enregistré sur le serveur à 10h42')
    unmount()
  })

  it('« Suivant » sans modification avance sans rien envoyer', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()

    await click(buttonByName(root, 'Suivant'))

    expect(patchCalls(api)).toHaveLength(0)
    expect(stepTitle(root)).toBe('Étape 2 sur 7 : Antécédents')
    expect(textOf(root)).not.toContain('Enregistré sur le serveur')
    unmount()
  })

  it('« Suivant » valide d’abord : une étape refusée par les règles n’avance pas et n’envoie rien', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await toggle(root, 'Autre')

    await click(buttonByName(root, 'Suivant'))

    expect(patchCalls(api)).toHaveLength(0)
    expect(stepTitle(root)).toBe('Étape 1 sur 7 : Motif et lunettes')
    expect(textOf(root)).toContain('Motif : précisez la valeur « Autre ».')
    unmount()
  })

  it('« Suivant » n’avance pas si le serveur refuse l’enregistrement (la saisie reste)', async () => {
    const api = stubConsultationApi({
      handlers: {
        save: () =>
          errorWithDetails(
            422,
            'VALIDATION_FAILED',
            'Données invalides.',
            {},
            {
              'step.data.symptoms': ['Ce texte est refusé par le serveur.'],
            },
          ),
      },
    })
    const { root, unmount } = await openConsultation()
    await type(root, 'Plaintes et symptômes', 'Texte')

    await click(buttonByName(root, 'Suivant'))

    expect(patchCalls(api)).toHaveLength(1)
    expect(stepTitle(root)).toBe('Étape 1 sur 7 : Motif et lunettes')
    expect(field(root, 'Plaintes et symptômes').value).toBe('Texte')
    expect(textOf(root)).toContain('Ce texte est refusé par le serveur.')
    unmount()
  })

  it('« Précédent » et le choix d’une étape ne perdent aucune saisie, même non enregistrée', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await type(root, 'Plaintes et symptômes', 'Texte non enregistré')
    await click(buttonByName(root, 'Suivant')) // enregistre, passe aux antécédents
    await toggle(root, 'Diabète')
    await type(root, 'Commentaires sur les antécédents médicaux', 'Suivi en cours')

    await click(buttonByName(root, 'Précédent'))
    expect(stepTitle(root)).toBe('Étape 1 sur 7 : Motif et lunettes')
    expect(field(root, 'Plaintes et symptômes').value).toBe('Texte non enregistré')
    expect(patchCalls(api)).toHaveLength(1)

    // L'étape 2, non enregistrée, est signalée dans la liste des étapes et garde sa saisie.
    const stepper = root.querySelector('nav[aria-label="Étapes de la consultation"]') as HTMLElement
    expect(textOf(stepper)).toContain('2.Antécédents● non enregistrée')
    const buttons = [...stepper.querySelectorAll('button')]
    await click(buttons[1] ?? null)
    expect(stepTitle(root)).toBe('Étape 2 sur 7 : Antécédents')
    expect(box(root, 'Diabète').checked).toBe(true)
    expect(field(root, 'Commentaires sur les antécédents médicaux').value).toBe('Suivi en cours')
    unmount()
  })

  it('trois enregistrements successifs : chaque envoi porte la version renvoyée par le précédent et sa propre clé', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()

    await toggle(root, 'Douleur')
    await click(buttonByName(root, 'Suivant'))
    await toggle(root, 'Diabète')
    await click(buttonByName(root, 'Suivant'))
    await goToStep(root, 7)
    await type(root, 'Conclusion', 'Contrôle dans un an')
    await click(buttonByName(root, 'Enregistrer'))

    const calls = patchCalls(api)
    expect(calls.map((call) => call.path.split('/').pop())).toEqual([
      'ANAMNESIS',
      'HISTORIES',
      'CONCLUSION',
    ])
    expect(calls.map((call) => call.body?.['expected_version'])).toEqual([1, 2, 3])
    expect(new Set(calls.map((call) => call.headers['Idempotency-Key'])).size).toBe(3)
    expect(api.server.version).toBe(4)
    expect(textOf(root)).toContain('Enregistré sur le serveur à 10h42')
    unmount()
  })

  it('modifier après un enregistrement retire « Enregistré sur le serveur » : il ne décrit plus la saisie', async () => {
    stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await toggle(root, 'Douleur')
    await click(buttonByName(root, 'Enregistrer'))
    expect(textOf(root)).toContain('Enregistré sur le serveur à 10h42')

    await type(root, 'Plaintes et symptômes', 'Nouvelle saisie')

    expect(textOf(root)).not.toContain('Enregistré sur le serveur')
    expect(textOf(root)).toContain('Modifications non enregistrées sur cette étape.')
    unmount()
  })
})

describe('étape 2 : antécédents', () => {
  async function toStepTwo(root: HTMLElement): Promise<void> {
    await click(buttonByName(root, 'Suivant'))
  }

  it('trois groupes, tous « non renseignés » au départ, avec leurs libellés du référentiel', async () => {
    stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await toStepTwo(root)

    for (const legend of [
      'Antécédents oculaires',
      'Antécédents médicaux',
      'Antécédents familiaux oculaires',
    ]) {
      const fieldset = group(root, legend)
      expect(textOf(fieldset)).toContain('Aucun connu')
      expect(textOf(fieldset.parentElement as HTMLElement)).toContain('État : Non renseigné')
    }
    const labels = [...group(root, 'Antécédents oculaires').querySelectorAll('label')].map(
      (label) => label.textContent?.trim(),
    )
    expect(labels).toEqual([
      'Aucun connu',
      'Traumatisme',
      'Chirurgie',
      'Glaucome',
      'Cataracte',
      'Infection',
      'Lentilles',
      'Autre',
    ])
    expect(
      [...group(root, 'Antécédents médicaux').querySelectorAll('label')].map((l) =>
        l.textContent?.trim(),
      ),
    ).toEqual([
      'Aucun connu',
      'Diabète',
      'Hypertension',
      'Allergies',
      'Traitement en cours',
      'Autre',
    ])
    expect(
      [...group(root, 'Antécédents familiaux oculaires').querySelectorAll('label')].map((l) =>
        l.textContent?.trim(),
      ),
    ).toEqual(['Aucun connu', 'Glaucome', 'Cataracte', 'Forte myopie', 'Autre'])
    unmount()
  })

  it('rien n’est ouvert : aucun appel ; un groupe jamais ouvert n’est jamais envoyé comme « Aucun connu »', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await toStepTwo(root)
    await click(buttonByName(root, 'Enregistrer'))
    expect(patchCalls(api)).toHaveLength(0)

    await choice(root, 'Antécédents médicaux', 'Aucun connu')
    await click(buttonByName(root, 'Enregistrer'))

    const data = (
      patchCalls(api)[0]?.body?.['step'] as { data: { histories: Record<string, unknown>[] } }
    ).data
    expect(data.histories).toEqual([
      {
        id: expect.stringMatching(ULID),
        history_group: 'MEDICAL_HISTORY',
        known_none: true,
        comments: null,
        terms: [],
      },
    ])
    expect(patchCalls(api)[0]?.path).toContain('/steps/HISTORIES')
    expect(textOf(group(root, 'Antécédents médicaux').parentElement as HTMLElement)).toContain(
      'État : Aucun connu',
    )
    expect(textOf(group(root, 'Antécédents oculaires').parentElement as HTMLElement)).toContain(
      'État : Non renseigné',
    )
    unmount()
  })

  it('« Aucun connu » est exclusif : désactivé tant qu’une valeur est cochée, et réciproquement, sans rien effacer', async () => {
    stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await toStepTwo(root)
    const ocular = (): HTMLFieldSetElement => group(root, 'Antécédents oculaires')

    await toggle(ocular(), 'Glaucome')
    expect(box(ocular(), 'Aucun connu').disabled).toBe(true)
    expect(textOf(ocular())).toContain(
      '« Aucun connu » est désactivé tant qu’une valeur est cochée.',
    )

    await toggle(ocular(), 'Glaucome') // décoché
    expect(box(ocular(), 'Aucun connu').disabled).toBe(false)

    await toggle(ocular(), 'Aucun connu')
    expect(box(ocular(), 'Glaucome').disabled).toBe(true)
    expect(box(ocular(), 'Autre').disabled).toBe(true)
    expect(textOf(ocular())).toContain('les autres valeurs sont désactivées')

    // Les autres groupes ne sont pas concernés.
    expect(box(group(root, 'Antécédents médicaux'), 'Diabète').disabled).toBe(false)
    unmount()
  })

  it('valeurs, « Autre » précisé et commentaires : un groupe par ligne, dans l’ordre oculaire, médical, familial', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await toStepTwo(root)
    await toggle(group(root, 'Antécédents familiaux oculaires'), 'Autre')
    await type(root, 'Autre antécédent familial oculaire : précisez', 'Œil unique')
    await toggle(group(root, 'Antécédents familiaux oculaires'), 'Glaucome')
    await toggle(group(root, 'Antécédents oculaires'), 'Chirurgie')
    await type(root, 'Commentaires sur les antécédents oculaires', ' Opéré en 2019 ')

    await click(buttonByName(root, 'Enregistrer'))

    const data = (
      patchCalls(api)[0]?.body?.['step'] as { data: { histories: Record<string, unknown>[] } }
    ).data
    expect(data.histories).toEqual([
      {
        id: expect.stringMatching(ULID),
        history_group: 'OCULAR_HISTORY',
        known_none: false,
        comments: 'Opéré en 2019',
        terms: [{ id: expect.stringMatching(ULID), term_code: 'SURGERY', other_text: null }],
      },
      {
        id: expect.stringMatching(ULID),
        history_group: 'FAMILY_HISTORY',
        known_none: false,
        comments: null,
        terms: [
          { id: expect.stringMatching(ULID), term_code: 'GLAUCOMA', other_text: null },
          { id: expect.stringMatching(ULID), term_code: 'OTHER', other_text: 'Œil unique' },
        ],
      },
    ])
    unmount()
  })

  it('« Autre » sans précision dans un groupe : l’erreur est sous le champ de CE groupe', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await toStepTwo(root)
    await toggle(group(root, 'Antécédents médicaux'), 'Autre')

    await submitForm(root)

    expect(patchCalls(api)).toHaveLength(0)
    const input = field(root, 'Autre antécédent médical : précisez')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect((root.querySelector('[role="alert"]') as HTMLElement).textContent).toContain(
      'Antécédents médicaux : précisez la valeur « Autre ».',
    )
    unmount()
  })

  it('relit le serveur : un groupe « Aucun connu » et un groupe de valeurs, les autres restent non renseignés', async () => {
    stubConsultationApi({
      consultation: consultation({
        status: 'IN_PROGRESS',
        version: 2,
        steps: {
          HISTORIES: {
            histories: [
              {
                id: '01J9ZXK4M2Q8R7S6T5V4W30701',
                history_group: 'OCULAR_HISTORY',
                known_none: true,
                comments: null,
                terms: [],
              },
              {
                id: '01J9ZXK4M2Q8R7S6T5V4W30702',
                history_group: 'MEDICAL_HISTORY',
                known_none: false,
                comments: 'Équilibré',
                terms: [
                  { id: '01J9ZXK4M2Q8R7S6T5V4W30703', term_code: 'DIABETES', other_text: null },
                ],
              },
            ],
          },
        },
      }),
    })
    const { root, unmount } = await openConsultation()
    await toStepTwo(root)

    expect(box(group(root, 'Antécédents oculaires'), 'Aucun connu').checked).toBe(true)
    expect(box(group(root, 'Antécédents médicaux'), 'Diabète').checked).toBe(true)
    expect(field(root, 'Commentaires sur les antécédents médicaux').value).toBe('Équilibré')
    const state = (legend: string): string =>
      textOf(group(root, legend).parentElement as HTMLElement)
    expect(state('Antécédents oculaires')).toContain('État : Aucun connu')
    expect(state('Antécédents médicaux')).toContain('État : Renseigné')
    expect(state('Antécédents familiaux oculaires')).toContain('État : Non renseigné')
    unmount()
  })

  it('vider un groupe enregistré l’envoie « non renseigné » : le groupe disparaît de l’étape envoyée', async () => {
    const api = stubConsultationApi({
      consultation: consultation({
        status: 'IN_PROGRESS',
        version: 2,
        steps: {
          HISTORIES: {
            histories: [
              {
                id: '01J9ZXK4M2Q8R7S6T5V4W30701',
                history_group: 'OCULAR_HISTORY',
                known_none: true,
                comments: null,
                terms: [],
              },
            ],
          },
        },
      }),
    })
    const { root, unmount } = await openConsultation()
    await toStepTwo(root)

    await toggle(group(root, 'Antécédents oculaires'), 'Aucun connu')
    await click(buttonByName(root, 'Enregistrer'))

    const data = (patchCalls(api)[0]?.body?.['step'] as { data: { histories: unknown[] } }).data
    expect(data.histories).toEqual([])
    unmount()
  })
})

describe('étape 7 : conclusion et orientation', () => {
  async function toStepThree(root: HTMLElement): Promise<void> {
    await goToStep(root, 7)
  }

  it('dernière étape : Enregistrer, jamais « Suivant » ; un brouillon ne propose pas encore « Terminer »', async () => {
    stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await toStepThree(root)

    expect(stepTitle(root)).toBe('Étape 7 sur 7 : Conclusion et orientation')
    const labels = [...root.querySelectorAll('main form button')].map((button) =>
      button.textContent?.trim(),
    )
    expect(labels).toEqual(['Précédent', 'Enregistrer'])
    expect(buttonByName(root, /termin/i)).toBeNull()
    unmount()
  })

  it('orientation « Oui » exige un niveau d’urgence : l’écran refuse l’envoi sans lui', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await toStepThree(root)
    expect(hasField(root, 'Niveau d’urgence')).toBe(false)

    await type(root, 'Conclusion', 'À orienter')
    await choice(root, 'Orientation vers un ophtalmologiste', 'Oui')
    expect(hasField(root, 'Niveau d’urgence')).toBe(true)
    expect(textOf(root)).toContain('Niveau d’urgence (obligatoire)')

    await submitForm(root)

    expect(patchCalls(api)).toHaveLength(0)
    expect((root.querySelector('[role="alert"]') as HTMLElement).textContent).toContain(
      'Le niveau d’urgence est obligatoire quand une orientation est proposée.',
    )
    expect(field(root, 'Niveau d’urgence').getAttribute('aria-invalid')).toBe('true')

    // Les quatre niveaux du DP §10, dans l'ordre.
    const options = [...(field(root, 'Niveau d’urgence') as HTMLSelectElement).options].map(
      (option) => option.textContent?.trim(),
    )
    expect(options).toEqual([
      'Choisir un niveau…',
      'Pas urgent',
      'Consultation recommandée',
      'Consultation rapide',
      'Urgence',
    ])
    await choose(root, 'Niveau d’urgence', 'RAPID')
    expect(root.querySelector('[role="alert"]')).toBeNull()
    unmount()
  })

  it('orientation « Oui » avec niveau et motifs : tout part, le badge d’orientation apparaît après la réponse', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await toStepThree(root)
    await type(root, 'Conclusion', ' Suspicion de cataracte ')
    await choice(root, 'Orientation vers un ophtalmologiste', 'Oui')
    await choose(root, 'Niveau d’urgence', 'RECOMMENDED')
    await toggle(group(root, 'Motifs de l’orientation'), 'Cataracte')
    await toggle(group(root, 'Motifs de l’orientation'), 'Autre')
    await type(root, 'Autre motif d’orientation : précisez', 'Gêne au volant')

    expect(textOf(root)).not.toContain('Orienté vers ophtalmologiste')
    await click(buttonByName(root, 'Enregistrer'))

    expect(patchCalls(api)[0]?.path).toContain('/steps/CONCLUSION')
    const data = (patchCalls(api)[0]?.body?.['step'] as { data: Record<string, unknown> }).data
    expect(data).toEqual({
      conclusion: 'Suspicion de cataracte',
      referral: true,
      referral_urgency: 'RECOMMENDED',
      referral_reasons: [
        { id: expect.stringMatching(ULID), term_code: 'CATARACT', other_text: null },
        { id: expect.stringMatching(ULID), term_code: 'OTHER', other_text: 'Gêne au volant' },
      ],
    })
    const banner = textOf(
      root.querySelector('[aria-label="Patient et consultation"]') as HTMLElement,
    )
    expect(banner).toContain('Orienté vers ophtalmologiste')
    expect(banner).toContain('Consultation recommandée')
    unmount()
  })

  it('les huit motifs d’orientation sont ceux du référentiel', async () => {
    stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await toStepThree(root)
    await choice(root, 'Orientation vers un ophtalmologiste', 'Oui')

    const labels = [...group(root, 'Motifs de l’orientation').querySelectorAll('label')].map(
      (label) => label.textContent?.trim(),
    )
    expect(labels).toEqual([
      'Suspicion de glaucome',
      'Cataracte',
      'Baisse d’acuité inexpliquée',
      'Pathologie cornéenne',
      'Œil rouge / inflammation',
      'Traumatisme',
      'Pathologie rétinienne suspectée',
      'Autre',
    ])
    unmount()
  })

  it('orientation « Non » : niveau et motifs saisis avant ne partent pas, l’écran le dit', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await toStepThree(root)
    await choice(root, 'Orientation vers un ophtalmologiste', 'Oui')
    await choose(root, 'Niveau d’urgence', 'EMERGENCY')
    await toggle(group(root, 'Motifs de l’orientation'), 'Traumatisme')

    await choice(root, 'Orientation vers un ophtalmologiste', 'Non')

    expect(hasField(root, 'Niveau d’urgence')).toBe(false)
    expect(textOf(root)).toContain(
      'Le niveau d’urgence et les motifs saisis ne sont pas enregistrés tant que l’orientation n’est pas « Oui ».',
    )
    await click(buttonByName(root, 'Enregistrer'))
    expect(patchCalls(api)[0]?.body?.['step']).toMatchObject({
      data: { referral: false, referral_urgency: null, referral_reasons: [] },
    })
    expect(textOf(root)).not.toContain('Orienté vers ophtalmologiste')
    unmount()
  })

  it('une conclusion seule se sauvegarde avec une orientation non renseignée (null)', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await toStepThree(root)
    await type(root, 'Conclusion', 'Contrôle dans un an')

    await click(buttonByName(root, 'Enregistrer'))

    expect(patchCalls(api)[0]?.body?.['step']).toMatchObject({
      data: {
        conclusion: 'Contrôle dans un an',
        referral: null,
        referral_urgency: null,
        referral_reasons: [],
      },
    })
    unmount()
  })
})
