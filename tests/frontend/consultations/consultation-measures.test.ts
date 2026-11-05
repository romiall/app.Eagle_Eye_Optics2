import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  apiError,
  buttonByName,
  callsTo,
  choice,
  choose,
  click,
  consultation,
  field,
  group,
  openConsultation,
  patchCalls,
  PATHS,
  resetEverything,
  SCALE_TENTHS,
  scales,
  stubConsultationApi,
  textOf,
  type,
} from './support'

// Étapes mesurées et médicaments (C02, C04) dans l'écran de consultation : acuités avec l'échelle choisie
// (aucune conversion, valeur lue conservée), réfraction par stade et par œil, centrage sans valeur fabriquée,
// médicaments en saisie libre contrôlée. Chaque étape s'enregistre sur le serveur. Données FICTIVES.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-22T09:42:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  resetEverything()
})

async function goToStep(root: HTMLElement, position: number): Promise<void> {
  const stepper = root.querySelector('nav[aria-label="Étapes de la consultation"]') as HTMLElement
  await click([...stepper.querySelectorAll('button')][position - 1] ?? null)
}

async function typeInto(root: HTMLElement, id: string, value: string): Promise<void> {
  const element = root.querySelector(`[id="${id}"]`)
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    throw new Error(`Contrôle « ${id} » introuvable.`)
  }
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

function sentData(api: ReturnType<typeof stubConsultationApi>): Record<string, unknown> {
  const body = patchCalls(api).at(-1)?.body
  return (body?.['step'] as { data: Record<string, unknown> }).data
}

describe('étape 3 : acuité visuelle', () => {
  it('lit les échelles du cabinet et envoie la valeur lue telle que saisie, avec l’échelle choisie', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await goToStep(root, 3)

    expect(callsTo(api, 'GET', PATHS.scales)).toHaveLength(1)
    expect(textOf(root)).toContain('Échelles de démonstration : non validées cliniquement')
    await choice(root, 'Acuité de loin : échelle utilisée', 'Dixièmes (X/10)')
    await type(root, 'Acuité de loin, sans correction, OD', ' 8/10 ')
    await type(root, 'Acuité de loin, sans correction, OG', '0')
    await click(buttonByName(root, 'Enregistrer'))

    expect(patchCalls(api)[0]?.path).toContain('/steps/VISUAL_ACUITY')
    const acuities = sentData(api)['acuities'] as Record<string, unknown>[]
    expect(
      acuities.map((row) => [
        row['eye'],
        row['raw_value'],
        row['scale_id'],
        row['normalized_value'],
      ]),
    ).toEqual([
      ['OD', '8/10', SCALE_TENTHS, null],
      ['OG', '0', SCALE_TENTHS, null],
    ])
    expect(
      acuities.every(
        (row) =>
          row['context'] === 'PRELIMINARY' &&
          row['distance'] === 'FAR' &&
          row['correction'] === 'WITHOUT',
      ),
    ).toBe(true)
    expect(textOf(root)).toContain('Enregistré sur le serveur à 10h42')
    unmount()
  })

  it('une valeur sans échelle n’est pas envoyée', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await goToStep(root, 3)

    await type(root, 'Acuité de près, avec correction, OU', 'P2')
    await click(buttonByName(root, 'Enregistrer'))

    expect(patchCalls(api)).toHaveLength(0)
    expect(textOf(root)).toContain('choisissez l’échelle utilisée')
    unmount()
  })

  it('aucune échelle configurée : dit, aucune échelle n’est devinée', async () => {
    stubConsultationApi({ scales: [] })
    const { root, unmount } = await openConsultation()
    await goToStep(root, 3)

    expect(textOf(root)).toContain('Aucune échelle d’acuité n’est configurée pour ce cabinet')
    // Aucune échelle à choisir : ni liste, ni bouton radio, ni valeur usuelle proposée.
    expect(() => group(root, 'Acuité de loin : échelle utilisée')).toThrow()
    expect(root.querySelectorAll('input[type="radio"]')).toHaveLength(0)
    unmount()
  })

  it('échelles illisibles : dit, l’échelle n’est pas choisie à la place du professionnel', async () => {
    stubConsultationApi({
      handlers: { getScales: () => apiError(500, 'INTERNAL_ERROR', 'Erreur interne.') },
    })
    const { root, unmount } = await openConsultation()
    await goToStep(root, 3)

    expect(textOf(root)).toContain('Les échelles d’acuité n’ont pas pu être lues')
    unmount()
  })
})

describe('étape 4 : réfraction', () => {
  it('chaque stade et chaque œil ont leur ligne ; la virgule est admise, rien n’est arrondi ni transposé', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await goToStep(root, 4)

    await typeInto(root, 'mesure-AUTOREFRACTOR-OD-sphere', '-1,25')
    await typeInto(root, 'mesure-AUTOREFRACTOR-OD-cylinder', '+0,50')
    await typeInto(root, 'mesure-AUTOREFRACTOR-OD-axis', '90')
    await typeInto(root, 'mesure-SUBJECTIVE-OG-sphere', '0')
    await typeInto(root, 'mesure-SUBJECTIVE-OG-addition', '2,25')
    await click(buttonByName(root, 'Enregistrer'))

    const measurements = sentData(api)['measurements'] as Record<string, unknown>[]
    expect(
      measurements.map((row) => [
        row['stage'],
        row['eye'],
        row['sphere'],
        row['cylinder'],
        row['axis'],
        row['addition'],
      ]),
    ).toEqual([
      ['AUTOREFRACTOR', 'OD', '-1.25', '0.50', 90, null],
      ['SUBJECTIVE', 'OG', '0.00', null, null, '2.25'],
    ])
    unmount()
  })

  it('une mesure à trois décimales est refusée à l’écran, jamais arrondie, et rien n’est envoyé', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await goToStep(root, 4)

    await typeInto(root, 'mesure-OBJECTIVE-OD-sphere', '-1,255')
    await click(buttonByName(root, 'Enregistrer'))

    expect(patchCalls(api)).toHaveLength(0)
    expect(textOf(root)).toContain('Deux décimales au plus : la valeur n’est jamais arrondie.')
    expect(
      (root.querySelector('[id="mesure-OBJECTIVE-OD-sphere"]') as HTMLInputElement).value,
    ).toBe('-1,255')
    unmount()
  })

  it('un pas inhabituel est signalé sans bloquer l’enregistrement', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await goToStep(root, 4)

    await typeInto(root, 'mesure-OBJECTIVE-OD-sphere', '-1,10')

    expect(textOf(root)).toContain('ce n’est pas un multiple du pas usuel de 0,25')
    await click(buttonByName(root, 'Enregistrer'))
    expect(patchCalls(api)).toHaveLength(1)
    unmount()
  })
})

describe('étape 5 : centrage', () => {
  it('la somme OD + OG est proposée, jamais écrite d’office ; un écart avec le total exige une justification', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await goToStep(root, 5)

    await type(root, 'Écart pupillaire total (mm)', '62')
    await type(root, 'Écart pupillaire OD (mm)', '31')
    await type(root, 'Écart pupillaire OG (mm)', '30')

    expect(textOf(root)).toContain('Somme OD + OG : 61,00 mm')
    expect(textOf(root)).toContain('diffère de l’écart total saisi')
    expect(field(root, 'Écart pupillaire total (mm)').value).toBe('62')
    await click(buttonByName(root, 'Enregistrer'))
    expect(patchCalls(api)).toHaveLength(0)

    await type(root, 'Justification de l’écart', 'Mesures reprises (fictif)')
    await click(buttonByName(root, 'Enregistrer'))

    const data = sentData(api)
    expect(data).toMatchObject({
      pd_total: '62.00',
      pd_od: '31.00',
      pd_og: '30.00',
      inconsistency_reason: 'Mesures reprises (fictif)',
    })
    expect(String(data['centering_id'])).toMatch(/^[0-9A-Z]{26}$/)
    unmount()
  })

  it('un écart total seul n’est jamais réparti entre OD et OG', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await goToStep(root, 5)

    await type(root, 'Écart pupillaire total (mm)', '62')
    await click(buttonByName(root, 'Enregistrer'))

    expect(sentData(api)).toMatchObject({ pd_total: '62.00', pd_od: null, pd_og: null })
    unmount()
  })
})

describe('étape 6 : médicaments', () => {
  it('ajoute un médicament en saisie libre, sans posologie déduite, et l’enregistre', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await goToStep(root, 6)
    expect(textOf(root)).toContain('Aucun médicament prescrit à cette consultation.')

    await click(buttonByName(root, 'Ajouter un médicament'))
    await type(root, 'Nom du médicament', 'Collyre fictif')
    await choose(root, 'Forme', 'DROPS')
    await click(buttonByName(root, 'Enregistrer'))

    const orders = sentData(api)['orders'] as Record<string, unknown>[]
    expect(orders).toHaveLength(1)
    expect(orders[0]).toMatchObject({
      name: 'Collyre fictif',
      form: 'DROPS',
      dosage: null,
      frequency: null,
      duration_value: null,
      duration_unit: null,
      instructions: null,
    })
    unmount()
  })

  it('un médicament sans nom n’est pas envoyé', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await goToStep(root, 6)

    await click(buttonByName(root, 'Ajouter un médicament'))
    await choose(root, 'Forme', 'TABLET')
    await click(buttonByName(root, 'Enregistrer'))

    expect(patchCalls(api)).toHaveLength(0)
    expect(textOf(root)).toContain('le nom du médicament est obligatoire')
    unmount()
  })

  it('un médicament déjà enregistré se relit tel quel', async () => {
    stubConsultationApi({
      consultation: consultation({
        status: 'IN_PROGRESS',
        version: 2,
        steps: {
          MEDICATIONS: {
            orders: [
              {
                id: '01J9ZXK4M2Q8R7S6T5V4W30B01',
                catalog_item_id: null,
                name: 'Pommade fictive',
                form: 'OINTMENT',
                form_other: null,
                strength: null,
                dosage: '1 application',
                frequency: 'Le soir',
                duration_text: null,
                duration_value: 5,
                duration_unit: 'DAY',
                instructions: null,
              },
            ],
          },
        },
      }),
    })
    const { root, unmount } = await openConsultation()
    await goToStep(root, 6)

    expect(field(root, 'Nom du médicament').value).toBe('Pommade fictive')
    expect(field(root, 'Posologie').value).toBe('1 application')
    expect(field(root, 'Durée structurée : nombre').value).toBe('5')
    unmount()
  })
})

describe('étape 1 : symptômes courants', () => {
  it('un clic complète le texte libre, sans l’écraser ni répéter un symptôme déjà écrit', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()

    await type(root, 'Plaintes et symptômes', 'Gêne au réveil')
    await click(buttonByName(root, 'Maux de tête'))
    await click(buttonByName(root, 'Vision floue'))
    await click(buttonByName(root, 'Maux de tête'))

    expect(field(root, 'Plaintes et symptômes').value).toBe(
      'Gêne au réveil, Maux de tête, Vision floue',
    )
    await click(buttonByName(root, 'Enregistrer'))
    expect(sentData(api)['symptoms']).toBe('Gêne au réveil, Maux de tête, Vision floue')
    unmount()
  })
})

describe('étape 3 : valeurs usuelles de l’acuité', () => {
  it('les boutons remplissent sans correction OD puis OG, puis avec correction, avec l’échelle du groupe', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await goToStep(root, 3)

    // Tant qu'aucune échelle n'est choisie, aucune valeur n'est proposée (rien n'est deviné).
    expect(buttonByName(root, '10/10')).toBeNull()
    await choice(root, 'Acuité de loin : échelle utilisée', 'Dixièmes (X/10)')
    expect(textOf(root)).toContain('touchez une valeur pour remplir sans correction, OD')

    await click(buttonByName(root, '10/10'))
    await click(buttonByName(root, '9/10'))
    expect(field(root, 'Acuité de loin, sans correction, OD').value).toBe('10/10')
    expect(field(root, 'Acuité de loin, sans correction, OG').value).toBe('9/10')
    expect(textOf(root)).toContain('touchez une valeur pour remplir avec correction, OD')

    // Une case touchée devient la cible : le bouton y écrit, puis passe à la case vide suivante.
    field(root, 'Acuité de loin, avec correction, OG').dispatchEvent(
      new FocusEvent('focusin', { bubbles: true }),
    )
    await flushPromises()
    await click(buttonByName(root, 'CLD'))
    expect(field(root, 'Acuité de loin, avec correction, OG').value).toBe('CLD')

    await click(buttonByName(root, 'Enregistrer'))
    const acuities = sentData(api)['acuities'] as Record<string, unknown>[]
    expect(
      acuities.map((row) => [row['correction'], row['eye'], row['raw_value'], row['scale_id']]),
    ).toEqual([
      ['WITHOUT', 'OD', '10/10', SCALE_TENTHS],
      ['WITHOUT', 'OG', '9/10', SCALE_TENTHS],
      ['WITH', 'OG', 'CLD', SCALE_TENTHS],
    ])
    unmount()
  })

  it('une seule échelle active au cabinet : elle s’applique d’office et son choix n’est pas proposé', async () => {
    const [tenths] = scales()
    const api = stubConsultationApi({ scales: tenths === undefined ? [] : [tenths] })
    const { root, unmount } = await openConsultation()
    await goToStep(root, 3)

    expect(textOf(root)).not.toContain('Acuité de loin : échelle utilisée')
    expect(root.querySelectorAll('input[type="radio"]')).toHaveLength(0)
    expect(textOf(root)).toContain('Échelle utilisée : Dixièmes (X/10) — DÉMONSTRATION')
    await type(root, 'Acuité de loin, sans correction, OD', '8/10')
    await click(buttonByName(root, 'Enregistrer'))

    const acuities = sentData(api)['acuities'] as Record<string, unknown>[]
    expect(acuities.map((row) => [row['raw_value'], row['scale_id']])).toEqual([
      ['8/10', SCALE_TENTHS],
    ])
    unmount()
  })
})

describe('étape 4 : écart pupillaire du ticket de l’autoréfracteur', () => {
  const stepOf = (call: { path: string } | undefined): string | undefined =>
    call?.path.split('/steps/')[1]

  it('saisi sous le ticket, il est enregistré avec la réfraction : le centrage suit, sans repasser par l’étape 5', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await goToStep(root, 4)

    expect(textOf(root)).toContain('reportez les valeurs moyennes (AVG)')
    await typeInto(root, 'mesure-AUTOREFRACTOR-OD-sphere', '-1,25')
    await type(root, 'Écart pupillaire total (mm)', '72')
    await click(buttonByName(root, 'Enregistrer'))

    const calls = patchCalls(api)
    expect(calls.map((call) => stepOf(call))).toEqual(['REFRACTION', 'CENTERING'])
    const centering = (calls[1]?.body?.['step'] as { data: Record<string, unknown> }).data
    expect(centering).toMatchObject({ pd_total: '72.00', pd_od: null, pd_og: null })
    expect(textOf(root)).toContain('Enregistré sur le serveur')
    unmount()
  })

  it('l’écart seul (réfraction inchangée) : seul le centrage est envoyé', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await goToStep(root, 4)

    await type(root, 'Écart pupillaire total (mm)', '65')
    await click(buttonByName(root, 'Enregistrer'))

    expect(patchCalls(api).map((call) => stepOf(call))).toEqual(['CENTERING'])
    unmount()
  })

  it('« Suivant » enregistre la réfraction puis le centrage, et l’étape 5 montre l’écart déjà saisi', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await goToStep(root, 4)

    await typeInto(root, 'mesure-AUTOREFRACTOR-OG-sphere', '+0,50')
    await type(root, 'Écart pupillaire total (mm)', '64')
    await click(buttonByName(root, 'Suivant'))

    expect(patchCalls(api).map((call) => stepOf(call))).toEqual(['REFRACTION', 'CENTERING'])
    expect(root.querySelector('h2#consultation-etape')?.textContent).toContain('Étape 5 sur 7')
    // L'étape reprend ce que le serveur a enregistré : forme canonique, virgule française.
    expect(field(root, 'Écart pupillaire total (mm)').value).toBe('64,00')
    unmount()
  })

  it('un écart illisible est refusé avant tout envoi, sous son champ, sans quitter l’étape', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await goToStep(root, 4)

    await typeInto(root, 'mesure-AUTOREFRACTOR-OD-sphere', '-1,00')
    await type(root, 'Écart pupillaire total (mm)', 'abc')
    await click(buttonByName(root, 'Enregistrer'))

    expect(patchCalls(api)).toHaveLength(0)
    expect(root.querySelector('h2#consultation-etape')?.textContent).toContain('Étape 4 sur 7')
    expect(root.querySelector('[id="dp-totale"]')?.getAttribute('aria-invalid')).toBe('true')
    unmount()
  })

  it('une autre saisie du centrage (écart OD) n’est jamais enregistrée à l’insu de la personne depuis la réfraction', async () => {
    const api = stubConsultationApi()
    const { root, unmount } = await openConsultation()
    await goToStep(root, 5)
    await type(root, 'Écart pupillaire OD (mm)', '31')
    await goToStep(root, 4)
    await typeInto(root, 'mesure-AUTOREFRACTOR-OD-sphere', '-0,75')
    await click(buttonByName(root, 'Enregistrer'))

    expect(patchCalls(api).map((call) => stepOf(call))).toEqual(['REFRACTION'])
    unmount()
  })
})
