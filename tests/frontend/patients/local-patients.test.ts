import { describe, expect, it } from 'vitest'

import type { Patient } from '@/domain/contracts/generated'
import {
  foldLocalPatients,
  isUnconsolidated,
  type LocalPatientEntry,
  localPatientPage,
  matchesLocalSearch,
  patientOfPulled,
  patientSummary,
} from '@/domain/patients/local'

/**
 * Fiches patient de CE poste, reconstruites par rejeu des faits du journal local : création, modifications cumulées,
 * état de la dernière commande, recherche locale (casse, accents, ordre des mots, téléphone, numéro de dossier) et
 * pagination. Données fictives.
 */
const ID = '01J9ZXK4M2Q8R7S6T5V4W3PA01'
const OTHER = '01J9ZXK4M2Q8R7S6T5V4W3PA02'

function create(
  entityId: string,
  fields: Record<string, unknown>,
  state = 'local',
  at = '2026-10-28T10:00:00.000Z',
): LocalPatientEntry {
  return {
    state,
    fact: {
      commandName: 'CreatePatient',
      entityId,
      number: 'EE-2026-0042',
      recordedAt: at,
      payload: {
        patient_id: entityId,
        last_name: 'Mbarga',
        first_names: 'Éloïse Marie',
        sex: 'F',
        birth_date: '1985-03-04',
        phone_primary: '+237 600 00 01 02',
        record_number: 'EE-2026-0042',
        ...fields,
      },
    },
  }
}

function update(
  entityId: string,
  changes: Record<string, unknown>,
  state = 'pending',
  at = '2026-10-28T11:00:00.000Z',
): LocalPatientEntry {
  return {
    state,
    fact: {
      commandName: 'UpdatePatient',
      entityId,
      number: null,
      recordedAt: at,
      payload: { patient_id: entityId, changes },
    },
  }
}

describe('rejeu des faits d’une fiche du poste', () => {
  it('une création donne la fiche complète, avec son numéro de dossier de la plage du poste', () => {
    const map = foldLocalPatients([create(ID, {})])
    const entry = map.get(ID)

    expect(entry?.state).toBe('local')
    expect(entry?.patient).toMatchObject({
      id: ID,
      record_number: 'EE-2026-0042',
      last_name: 'Mbarga',
      first_names: 'Éloïse Marie',
      sex: 'F',
      birth_date: '1985-03-04',
      phone_primary: '+237 600 00 01 02',
      archived: false,
      merged_into_patient_id: null,
      version: 1,
      guardian_contact: null,
      legacy_record: false,
      created_at: '2026-10-28T10:00:00.000Z',
    })
  })

  it('le numéro de dossier vient du fait quand la charge ne le porte pas, et un sexe inconnu devient « UNKNOWN »', () => {
    const entry = create(ID, { record_number: undefined, sex: 'X' })
    const map = foldLocalPatients([entry])

    expect(map.get(ID)?.patient.record_number).toBe('EE-2026-0042')
    expect(map.get(ID)?.patient.sex).toBe('UNKNOWN')
  })

  it('les modifications se CUMULENT : la tête du poste ne garde que la dernière, le rejeu les applique toutes', () => {
    const map = foldLocalPatients([
      create(ID, {}),
      update(ID, { phone_primary: '+237 600 00 09 99' }),
      update(
        ID,
        { address: 'Bastos', profession: 'Enseignante' },
        'local',
        '2026-10-28T12:00:00.000Z',
      ),
    ])
    const entry = map.get(ID)

    expect(entry?.patient).toMatchObject({
      phone_primary: '+237 600 00 09 99',
      address: 'Bastos',
      profession: 'Enseignante',
      version: 3,
      updated_at: '2026-10-28T12:00:00.000Z',
    })
    // L'état affiché est celui de la DERNIÈRE commande qui a touché la fiche.
    expect(entry?.state).toBe('local')
  })

  it('un champ vidé vaut null, le nom ne devient jamais vide, une charge illisible est ignorée', () => {
    const map = foldLocalPatients([
      create(ID, { address: 'Bastos' }),
      update(ID, { address: null, last_name: '', first_names: null }),
      {
        ...update(ID, {}),
        fact: { ...update(ID, {}).fact, payload: { patient_id: ID, changes: 'oups' } },
      },
    ])

    expect(map.get(ID)?.patient).toMatchObject({
      address: null,
      last_name: 'Mbarga',
      first_names: null,
      version: 2,
    })
  })

  it('une modification d’une fiche du serveur (sans création locale) n’a pas de base à rejouer', () => {
    const map = foldLocalPatients([update(OTHER, { address: 'Bonanjo' })])

    expect(map.size).toBe(0)
  })

  it('plusieurs fiches restent distinctes, chacune avec son état', () => {
    const map = foldLocalPatients([
      create(ID, {}, 'acknowledged'),
      create(OTHER, { last_name: 'Tchoua', record_number: 'EE-2026-0043' }, 'pending'),
    ])

    expect([...map.keys()]).toEqual([ID, OTHER])
    expect(map.get(OTHER)?.patient.last_name).toBe('Tchoua')
    expect(map.get(ID)?.state).toBe('acknowledged')
  })
})

describe('proposition du poste et serveur', () => {
  it('seules les propositions consolidées ou rejetées cèdent la place au serveur', () => {
    for (const state of ['local', 'pending', 'waiting_dependency', 'conflict']) {
      expect(isUnconsolidated(state), state).toBe(true)
    }
    for (const state of ['acknowledged', 'rejected']) {
      expect(isUnconsolidated(state), state).toBe(false)
    }
  })

  it('le résumé reprend les seuls champs de la liste', () => {
    const patient = foldLocalPatients([create(ID, {})]).get(ID)?.patient
    if (patient === undefined) throw new Error('fiche attendue')

    expect(patientSummary(patient)).toEqual({
      id: ID,
      record_number: 'EE-2026-0042',
      last_name: 'Mbarga',
      first_names: 'Éloïse Marie',
      sex: 'F',
      birth_date: '1985-03-04',
      phone_primary: '+237 600 00 01 02',
      archived: false,
      merged_into_patient_id: null,
      version: 1,
    })
  })
})

describe('recherche locale', () => {
  const patient = foldLocalPatients([create(ID, {})]).get(ID)?.patient
  if (patient === undefined) throw new Error('fiche attendue')

  it('le nom et les prénoms se retrouvent sans tenir compte de la casse, des accents ni de l’ordre des mots', () => {
    for (const query of ['mbarga', 'MBARGA', 'eloise', 'Éloïse Marie', 'marie mbarga', 'mba']) {
      expect(matchesLocalSearch(patient, query), query).toBe(true)
    }
    expect(matchesLocalSearch(patient, 'tchoua')).toBe(false)
    expect(matchesLocalSearch(patient, 'mbarga paul')).toBe(false)
  })

  it('le téléphone se retrouve par ses chiffres, quelle que soit la mise en forme', () => {
    expect(matchesLocalSearch(patient, '600 00 01 02')).toBe(true)
    expect(matchesLocalSearch(patient, '237600000102')).toBe(true)
    expect(matchesLocalSearch(patient, '600 00 09 99')).toBe(false)
  })

  it('le numéro de dossier se retrouve, une saisie trop courte ne trouve rien', () => {
    expect(matchesLocalSearch(patient, 'EE-2026-0042')).toBe(true)
    expect(matchesLocalSearch(patient, 'ee-2026')).toBe(true)
    expect(matchesLocalSearch(patient, 'm')).toBe(false)
    expect(matchesLocalSearch(patient, '   ')).toBe(false)
  })
})

describe('page de résultats locaux', () => {
  function many(count: number) {
    const entries = Array.from({ length: count }, (_, index) =>
      create(`01J9ZXK4M2Q8R7S6T5V4W3P${String(index).padStart(3, '0')}`, {
        last_name: `Nom${String(count - index).padStart(2, '0')}`,
        first_names: null,
        record_number: `EE-2026-${String(index).padStart(4, '0')}`,
      }),
    )
    return [...foldLocalPatients(entries).values()].map((entry) => entry.patient)
  }

  it('25 par page, triées par nom, avec les totaux de ce poste', () => {
    const patients = many(30)

    const first = localPatientPage(patients, 1)
    expect(first.data).toHaveLength(25)
    expect(first.data[0]?.last_name).toBe('Nom01')
    expect(first.meta).toEqual({ current_page: 1, last_page: 2, per_page: 25, total: 30 })

    const second = localPatientPage(patients, 2)
    expect(second.data).toHaveLength(5)
    expect(second.data.at(-1)?.last_name).toBe('Nom30')
  })

  it('aucune fiche : une page vide, jamais un total négatif ni zéro page', () => {
    expect(localPatientPage([], 1)).toEqual({
      data: [],
      meta: { current_page: 1, last_page: 1, per_page: 25, total: 0 },
    })
  })
})

describe('annuaire du poste : fiches du serveur reçues par le pull', () => {
  const SERVER = '01J9ZXK4M2Q8R7S6T5V4W3PB01'

  function fromServer(fields: Partial<Patient> = {}): Patient {
    return {
      id: SERVER,
      record_number: 'EE-2026-0007',
      last_name: 'Ngono',
      first_names: 'Paul',
      sex: 'M',
      birth_date: '1979-06-12',
      phone_primary: '+237 677 00 00 07',
      archived: false,
      merged_into_patient_id: null,
      version: 3,
      birth_date_missing_reason: null,
      phone_secondary: null,
      phone_missing_reason: null,
      address: null,
      profession: null,
      guardian_contact: null,
      legacy_record: false,
      first_known_visit_on: null,
      first_visit_certified: false,
      legacy_record_number: null,
      created_at: '2026-10-01T08:00:00.000Z',
      updated_at: '2026-10-20T08:00:00.000Z',
      ...fields,
    }
  }

  function directory(...patients: Patient[]): Map<string, Patient> {
    return new Map(patients.map((patient) => [patient.id, patient]))
  }

  function changed(
    changes: Record<string, unknown>,
    expectedVersion: number | null,
    state: string,
    at = '2026-10-28T11:00:00.000Z',
  ): LocalPatientEntry {
    const entry = update(SERVER, changes, state, at)
    return { ...entry, fact: { ...entry.fact, expectedVersion } }
  }

  it('une fiche du serveur que le poste n’a pas touchée est lue telle que reçue, consolidée par définition', () => {
    const map = foldLocalPatients([], directory(fromServer()))
    const entry = map.get(SERVER)

    expect(entry?.patient).toEqual(fromServer())
    expect(entry?.state).toBe('acknowledged')
    expect(isUnconsolidated(entry?.state ?? '')).toBe(false)
  })

  it('une modification faite sur le poste s’applique par-dessus la fiche du serveur : version attendue + 1, état de la commande', () => {
    const map = foldLocalPatients(
      [changed({ phone_primary: '+237 699 11 22 33' }, 3, 'pending')],
      directory(fromServer()),
    )
    const entry = map.get(SERVER)

    expect(entry?.patient).toMatchObject({
      last_name: 'Ngono',
      phone_primary: '+237 699 11 22 33',
      version: 4,
      record_number: 'EE-2026-0007',
    })
    expect(entry?.state).toBe('pending')
    expect(isUnconsolidated(entry?.state ?? '')).toBe(true)
  })

  it('plusieurs modifications se cumulent par-dessus la fiche du serveur', () => {
    const map = foldLocalPatients(
      [
        changed({ phone_primary: '+237 699 11 22 33' }, 3, 'pending'),
        changed({ address: 'Rue fictive, Douala' }, 4, 'local', '2026-10-28T12:00:00.000Z'),
      ],
      directory(fromServer()),
    )

    expect(map.get(SERVER)?.patient).toMatchObject({
      phone_primary: '+237 699 11 22 33',
      address: 'Rue fictive, Douala',
      version: 5,
    })
    expect(map.get(SERVER)?.state).toBe('local')
  })

  it('une modification refusée par le serveur ne change rien : la fiche reste celle du serveur', () => {
    const map = foldLocalPatients(
      [changed({ phone_primary: '+237 699 11 22 33' }, 3, 'rejected')],
      directory(fromServer()),
    )

    expect(map.get(SERVER)?.patient).toEqual(fromServer())
    expect(map.get(SERVER)?.state).toBe('acknowledged')
  })

  it('une modification acquittée n’est rejouée que tant que le pull ne l’a pas reprise', () => {
    const entry = changed({ phone_primary: '+237 699 11 22 33' }, 3, 'acknowledged')

    // Le pull n’a pas encore apporté la version 4 : la modification acquittée reste visible sur le poste.
    const stale = foldLocalPatients([entry], directory(fromServer()))
    expect(stale.get(SERVER)?.patient).toMatchObject({
      phone_primary: '+237 699 11 22 33',
      version: 4,
    })

    // Le pull a apporté la version 5, où un autre compte a changé le même champ : rejouer la ferait revenir en arrière.
    const later = foldLocalPatients(
      [entry],
      directory(fromServer({ version: 5, phone_primary: '+237 655 00 00 55' })),
    )
    expect(later.get(SERVER)?.patient).toMatchObject({
      phone_primary: '+237 655 00 00 55',
      version: 5,
    })
    expect(later.get(SERVER)?.state).toBe('acknowledged')
  })

  it('une chaîne de modifications acquittées : seules celles que le pull n’a pas reprises sont rejouées', () => {
    const entries = [
      changed({ phone_primary: '+237 699 11 22 33' }, 3, 'acknowledged'),
      changed({ address: 'Rue fictive, Douala' }, 4, 'acknowledged', '2026-10-28T12:00:00.000Z'),
    ]

    // Le pull a apporté la version 4 (la première modification, reprise) : seule la seconde est rejouée, par-dessus.
    const half = foldLocalPatients(
      entries,
      directory(fromServer({ version: 4, phone_primary: '+237 655 00 00 55' })),
    )
    expect(half.get(SERVER)?.patient).toMatchObject({
      phone_primary: '+237 655 00 00 55',
      address: 'Rue fictive, Douala',
      version: 5,
    })

    // Le pull a tout apporté : plus rien n’est rejoué.
    const all = foldLocalPatients(
      entries,
      directory(fromServer({ version: 5, phone_primary: '+237 655 00 00 55', address: null })),
    )
    expect(all.get(SERVER)?.patient).toMatchObject({ address: null, version: 5 })
  })

  it('un fait sans version attendue (scellé avant l’annuaire) compte +1 et n’est jamais tenu pour repris', () => {
    const old = update(SERVER, { phone_primary: '+237 699 11 22 33' }, 'acknowledged')
    const map = foldLocalPatients([old], directory(fromServer({ version: 9 })))

    expect(map.get(SERVER)?.patient).toMatchObject({
      phone_primary: '+237 699 11 22 33',
      version: 10,
    })
  })

  it('sans fiche du serveur, une modification d’une fiche du serveur reste sans base locale', () => {
    expect(foldLocalPatients([changed({ address: 'Rue fictive' }, 3, 'pending')]).size).toBe(0)
  })

  it('une fiche créée sur le poste puis reçue du serveur : la proposition non consolidée prime, consolidée la plus récente fait foi', () => {
    const base = fromServer({
      id: ID,
      record_number: 'EE-2026-0042',
      last_name: 'Du serveur',
      version: 1,
    })

    const pending = foldLocalPatients([create(ID, {}, 'pending')], directory(base))
    expect(pending.get(ID)?.patient.last_name).toBe('Mbarga')
    expect(pending.get(ID)?.state).toBe('pending')

    const settled = foldLocalPatients([create(ID, {}, 'acknowledged')], directory(base))
    expect(settled.get(ID)?.patient.last_name).toBe('Du serveur')

    const behind = foldLocalPatients(
      [create(ID, {}, 'acknowledged'), update(ID, { address: 'Rue fictive' }, 'acknowledged')],
      directory(base),
    )
    expect(behind.get(ID)?.patient).toMatchObject({
      last_name: 'Mbarga',
      address: 'Rue fictive',
      version: 2,
    })
  })

  it('les fiches du serveur et celles du poste cohabitent, chacune avec son état', () => {
    const map = foldLocalPatients([create(ID, {})], directory(fromServer()))

    expect([...map.keys()].sort()).toEqual([ID, SERVER].sort())
    expect(map.get(ID)?.state).toBe('local')
    expect(map.get(SERVER)?.state).toBe('acknowledged')
  })

  it('la recherche trouve une fiche du serveur sans tenir compte de la casse, des accents ni du téléphone mis en forme', () => {
    const patient = fromServer({ last_name: 'Ngono Évélyne' })

    expect(matchesLocalSearch(patient, 'evelyne ngono')).toBe(true)
    expect(matchesLocalSearch(patient, '677 00 00 07')).toBe(true)
    expect(matchesLocalSearch(patient, 'EE-2026-0007')).toBe(true)
  })

  it('une fiche fusionnée dans une autre n’est jamais proposée (comme la recherche du serveur), une fiche archivée l’est', () => {
    expect(matchesLocalSearch(fromServer({ merged_into_patient_id: OTHER }), 'ngono')).toBe(false)
    expect(matchesLocalSearch(fromServer({ archived: true }), 'ngono')).toBe(true)
  })
})

describe('lecture défensive d’une fiche du serveur', () => {
  function wire(fields: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: ID,
      record_number: 'EE-2026-0007',
      last_name: 'Ngono',
      first_names: 'Paul',
      sex: 'M',
      birth_date: '1979-06-12',
      phone_primary: '+237 677 00 00 07',
      archived: false,
      merged_into_patient_id: null,
      version: 3,
      birth_date_missing_reason: null,
      phone_secondary: null,
      phone_missing_reason: null,
      address: 'Rue fictive',
      profession: null,
      guardian_contact: { name: 'Tuteur fictif' },
      legacy_record: false,
      first_known_visit_on: null,
      first_visit_certified: false,
      legacy_record_number: null,
      created_at: '2026-10-01T08:00:00.000Z',
      updated_at: '2026-10-20T08:00:00.000Z',
      ...fields,
    }
  }

  it('une projection complète du serveur donne la fiche, champ pour champ', () => {
    expect(patientOfPulled(wire())).toEqual(wire())
  })

  it('les champs facultatifs absents deviennent null ou faux, sans rien inventer', () => {
    const patient = patientOfPulled({
      id: ID,
      record_number: 'EE-2026-0007',
      last_name: 'Ngono',
      sex: 'F',
      version: 1,
      archived: false,
      merged_into_patient_id: null,
      created_at: '2026-10-01T08:00:00.000Z',
      updated_at: '2026-10-20T08:00:00.000Z',
    })

    expect(patient).toMatchObject({
      first_names: null,
      birth_date: null,
      phone_primary: null,
      address: null,
      guardian_contact: null,
      legacy_record: false,
      first_visit_certified: false,
      created_at: '2026-10-01T08:00:00.000Z',
      updated_at: '2026-10-20T08:00:00.000Z',
    })
  })

  it('une projection vide, d’une autre forme ou sans identité exploitable n’est pas une fiche', () => {
    for (const bad of [
      null,
      'texte',
      [],
      {},
      wire({ id: '' }),
      wire({ id: 12 }),
      wire({ record_number: '' }),
      wire({ last_name: '  ' }),
      wire({ sex: 'X' }),
      wire({ version: 0 }),
      wire({ version: 1.5 }),
      wire({ version: '3' }),
      wire({ archived: 'non' }),
      wire({ merged_into_patient_id: 7 }),
      // Horodatages exigés : l'écran les met en forme, une date absente ou illisible ferait échouer son rendu.
      wire({ created_at: undefined }),
      wire({ created_at: '' }),
      wire({ updated_at: 'hier' }),
    ]) {
      expect(patientOfPulled(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})
