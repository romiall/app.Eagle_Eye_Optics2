import { describe, expect, it } from 'vitest'

import {
  acuityFamily,
  acuityQuickValues,
  acuitySuggestions,
  isDemoScale,
} from '@/domain/clinical/acuityScales'

// Valeurs usuelles d'acuité (C02) : une AIDE À LA SAISIE par famille d'échelle, reconnue au code ou au libellé de
// l'échelle du cabinet. Jamais une donnée : aucune conversion, aucune valeur appliquée seule.
describe('famille d’une échelle d’acuité', () => {
  it('reconnaît les dixièmes, Snellen et Parinaud par le code ou le libellé, accents et casse ignorés', () => {
    expect(acuityFamily('DEMO_DIXIEMES')).toBe('DECIMAL')
    expect(acuityFamily('DIXIEMES', 'Dixièmes (X/10)')).toBe('DECIMAL')
    expect(acuityFamily('ECH_A', 'Échelle décimale')).toBe('DECIMAL')
    expect(acuityFamily('ECH_B', 'Acuité en X/10')).toBe('DECIMAL')
    expect(acuityFamily('DEMO_SNELLEN_6')).toBe('SNELLEN')
    expect(acuityFamily('S6', 'Snellen mètres (6/x)')).toBe('SNELLEN')
    expect(acuityFamily('DEMO_PRES')).toBe('PARINAUD')
    expect(acuityFamily('PARINAUD')).toBe('PARINAUD')
    expect(acuityFamily('P', 'Vision de près')).toBe('PARINAUD')
  })

  it('une échelle d’une autre famille ou absente n’a aucune valeur proposée : la saisie reste libre', () => {
    expect(acuityFamily('LIBRE', 'Saisie libre')).toBeNull()
    expect(acuityFamily('PRESBYTIE')).toBeNull()
    expect(acuityFamily(null)).toBeNull()
    expect(acuitySuggestions('LIBRE', 'Saisie libre')).toEqual([])
    expect(acuityQuickValues(null)).toEqual([])
  })
})

describe('valeurs proposées', () => {
  it('dixièmes : de 10/10 à 1/10, puis les mentions du carnet (CLD, VLMB)', () => {
    const values = acuityQuickValues('DIXIEMES', 'Dixièmes (X/10)')
    expect(values.slice(0, 3)).toEqual(['10/10', '9/10', '8/10'])
    expect(values.slice(-3)).toEqual(['1/10', 'CLD', 'VLMB'])
    // Les suggestions du champ de saisie ne portent pas les mentions : elles restent des dixièmes.
    expect(acuitySuggestions('DIXIEMES', 'Dixièmes (X/10)')).not.toContain('CLD')
  })

  it('Parinaud : P2, P3… sans mention ; les échelles de démonstration reçoivent les mêmes valeurs', () => {
    expect(acuityQuickValues('PARINAUD')).toEqual(acuitySuggestions('PARINAUD'))
    expect(acuityQuickValues('PARINAUD')).toEqual(expect.arrayContaining(['P2', 'P3']))
    expect(acuityQuickValues('DEMO_PRES')).toEqual(acuityQuickValues('PARINAUD'))
    expect(acuitySuggestions('DEMO_DIXIEMES')).toEqual(acuitySuggestions('DIXIEMES'))
  })

  it('seul le code DEMO_ marque une échelle de démonstration', () => {
    expect(isDemoScale('DEMO_PRES')).toBe(true)
    expect(isDemoScale('PARINAUD')).toBe(false)
  })
})
