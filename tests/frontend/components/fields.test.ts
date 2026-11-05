import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { controlClasses } from '@/components/form/classes'
import DateField from '@/components/form/DateField.vue'
import DecimalField from '@/components/form/DecimalField.vue'
import MoneyField from '@/components/form/MoneyField.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextField from '@/components/form/TextField.vue'

const NNBSP = '\u{202F}'

const wrappers: VueWrapper[] = []
function track<T extends VueWrapper>(wrapper: T): T {
  wrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount()
})

/** Saisit puis quitte le champ, comme l'utilisateur. */
async function type(wrapper: VueWrapper, value: string): Promise<void> {
  const input = wrapper.get('input')
  await input.setValue(value)
  await input.trigger('blur')
}

function describedText(wrapper: VueWrapper): string {
  const ids = (wrapper.get('input').attributes('aria-describedby') ?? '').split(' ')
  return ids.map((id) => wrapper.find(`[id="${id}"]`).text()).join(' | ')
}

describe('TextField et FieldShell', () => {
  it('relie un vrai libellé, l’aide et l’erreur au contrôle', () => {
    const wrapper = track(
      mount(TextField, {
        props: {
          label: 'Nom',
          modelValue: 'NGONO',
          hint: 'Tel qu’il figure sur la pièce',
          error: 'Le nom est trop long.',
          required: true,
        },
      }),
    )
    const input = wrapper.get('input')
    const label = wrapper.get('label')

    expect(label.attributes('for')).toBe(input.attributes('id'))
    expect(label.text()).toBe('Nom (obligatoire)')
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(describedText(wrapper)).toBe('Tel qu’il figure sur la pièce | ⚠ Le nom est trop long.')
    // L'erreur ne repose pas sur la seule couleur : symbole et texte.
    expect(wrapper.find('[aria-hidden="true"]').text()).toBe('⚠')
  })

  it('n’annonce pas d’erreur sans message, et garde un identifiant imposé', () => {
    const wrapper = track(
      mount(TextField, { props: { label: 'Téléphone', modelValue: '', controlId: 'tel-patient' } }),
    )
    const input = wrapper.get('input')

    expect(input.attributes('id')).toBe('tel-patient')
    expect(input.attributes('aria-invalid')).toBeUndefined()
    expect(input.attributes('aria-describedby')).toBeUndefined()
  })

  it('transmet la saisie telle quelle', async () => {
    const wrapper = track(mount(TextField, { props: { label: 'Nom', modelValue: '' } }))
    await wrapper.get('input').setValue('  Ébène  ')

    expect(wrapper.emitted('update:modelValue')).toEqual([['  Ébène  ']])
  })

  it('garde le libellé pour les lecteurs d’écran quand il est masqué', () => {
    const wrapper = track(
      mount(TextField, { props: { label: 'Recherche', modelValue: '', hideLabel: true } }),
    )

    expect(wrapper.get('label').classes()).toContain('sr-only')
    expect(wrapper.get('label').text()).toBe('Recherche')
  })

  it('rend un champ désactivé lisible (teintes pleines, jamais d’opacité)', () => {
    const wrapper = track(
      mount(TextField, { props: { label: 'Nom', modelValue: 'NGONO', disabled: true } }),
    )
    const classes = wrapper.get('input').classes()

    expect(wrapper.get('input').attributes('disabled')).toBeDefined()
    expect(classes).toContain('disabled:bg-disabled')
    expect(classes).toContain('disabled:text-disabled-ink')
    expect(classes.some((name) => name.includes('opacity'))).toBe(false)
  })
})

describe('DecimalField : mesures et quantités exactes (règles F08)', () => {
  it('lit une dioptrie à la virgule et l’affiche avec son signe', async () => {
    const wrapper = track(
      mount(DecimalField, {
        props: { label: 'Sphère', modelValue: null, kind: 'diopter', field: 'sphere' },
      }),
    )

    await type(wrapper, '1,25')
    expect(wrapper.emitted('update:modelValue')).toEqual([['1.25']])
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('+1,25')

    await type(wrapper, '-0.75')
    expect(wrapper.emitted('update:modelValue')?.[1]).toEqual(['-0.75'])
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('-0,75')
  })

  it('refuse trop de décimales sans arrondir, et garde la saisie pour correction', async () => {
    const wrapper = track(
      mount(DecimalField, {
        props: { label: 'Sphère', modelValue: '1.25', kind: 'diopter', field: 'sphere' },
      }),
    )

    await type(wrapper, '1,255')

    // L'ancienne valeur valide n'est plus celle du parent : elle ne partirait pas à la place de
    // ce que l'écran affiche.
    expect(wrapper.emitted('update:modelValue')).toEqual([[null]])
    expect(wrapper.emitted('invalid')).toEqual([['decimal.scale']])
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('1,255')
    expect(wrapper.get('input').attributes('aria-invalid')).toBe('true')
    expect(describedText(wrapper)).toContain('ni arrondie ni tronquée')
  })

  it('vide → null (non mesuré), jamais 0', async () => {
    const wrapper = track(
      mount(DecimalField, {
        props: { label: 'Cylindre', modelValue: '-0.50', kind: 'diopter', field: 'cylinder' },
      }),
    )

    await type(wrapper, '')

    expect(wrapper.emitted('update:modelValue')).toEqual([[null]])
  })

  it('exige une valeur quand le champ est obligatoire', async () => {
    const wrapper = track(
      mount(DecimalField, {
        props: {
          label: 'Quantité',
          modelValue: null,
          kind: 'quantity',
          field: 'quantity',
          required: true,
        },
      }),
    )

    await type(wrapper, '  ')

    expect(wrapper.emitted('invalid')).toEqual([['required']])
    expect(describedText(wrapper)).toContain('Ce champ est obligatoire.')
  })

  it('lit la saisie à Entrée, avant l’envoi du formulaire', async () => {
    const wrapper = track(
      mount(DecimalField, {
        props: { label: 'Quantité', modelValue: null, kind: 'quantity', field: 'quantity' },
      }),
    )
    const input = wrapper.get('input')

    await input.setValue('2,5')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')).toEqual([['2.500']])

    // Quitter ensuite le champ ne renvoie pas la même valeur une seconde fois.
    await wrapper.setProps({ modelValue: '2.500' })
    await input.trigger('blur')
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
  })

  it('expose commit() pour qu’un formulaire lise le champ', async () => {
    const wrapper = track(
      mount(DecimalField, {
        props: { label: 'Remise', modelValue: null, kind: 'rate', field: 'rate_percent' },
      }),
    )
    await wrapper.get('input').setValue('120')

    expect((wrapper.vm as unknown as { commit: () => boolean }).commit()).toBe(false)
    await wrapper.get('input').setValue('12,5')
    expect((wrapper.vm as unknown as { commit: () => boolean }).commit()).toBe(true)
    expect(wrapper.emitted('update:modelValue')).toEqual([['12.5000']])
  })

  it('propose le pavé décimal pour une quantité, le clavier texte pour une mesure signée', () => {
    const quantity = track(
      mount(DecimalField, {
        props: { label: 'Quantité', modelValue: null, kind: 'quantity', field: 'quantity' },
      }),
    )
    const sphere = track(
      mount(DecimalField, {
        props: { label: 'Sphère', modelValue: null, kind: 'diopter', field: 'sphere' },
      }),
    )

    expect(quantity.get('input').attributes('inputmode')).toBe('decimal')
    expect(sphere.get('input').attributes('inputmode')).toBe('text')
  })

  it('suit la valeur du parent tant qu’aucune saisie refusée n’est affichée', async () => {
    const wrapper = track(
      mount(DecimalField, {
        props: { label: 'Sphère', modelValue: '0.00', kind: 'diopter', field: 'sphere' },
      }),
    )
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('0,00')

    await wrapper.setProps({ modelValue: '2.00' })
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('+2,00')
  })
})

describe('MoneyField : FCFA entiers', () => {
  it('lit « 80000 » ou « 80 000 » et affiche les groupes de trois chiffres', async () => {
    const wrapper = track(mount(MoneyField, { props: { label: 'Montant', modelValue: null } }))

    await type(wrapper, '80000')
    expect(wrapper.emitted('update:modelValue')).toEqual([[80000]])
    const shown = (wrapper.get('input').element as HTMLInputElement).value
    expect(shown).toBe(`80${NNBSP}000`)

    // L'affichage relu donne le même montant (aucune dérive à la seconde sortie du champ).
    await wrapper.setProps({ modelValue: 80000 })
    await type(wrapper, shown)
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1)

    await type(wrapper, '1 250 000')
    expect(wrapper.emitted('update:modelValue')?.[1]).toEqual([1250000])
  })

  it('refuse les décimales et les séparateurs ambigus', async () => {
    const wrapper = track(mount(MoneyField, { props: { label: 'Montant', modelValue: null } }))

    await type(wrapper, '80,5')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.emitted('invalid')).toEqual([['money.format']])
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('80,5')
  })

  it('annonce l’unité aux lecteurs d’écran', () => {
    const wrapper = track(
      mount(MoneyField, { props: { label: 'Montant', modelValue: 5000, hint: 'Espèces' } }),
    )

    expect(describedText(wrapper)).toBe('Espèces | FCFA')
  })

  it('une saisie refusée vide la valeur du parent et reste affichée quand il la reçoit', async () => {
    const wrapper = track(mount(MoneyField, { props: { label: 'Montant', modelValue: 80000 } }))

    await type(wrapper, '80 000,50')
    expect(wrapper.emitted('update:modelValue')).toEqual([[null]])

    // Le parent applique null : la saisie refusée n'est pas écrasée, elle reste à corriger.
    await wrapper.setProps({ modelValue: null })
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('80 000,50')
    await wrapper.setProps({ modelValue: 5000 })
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('80 000,50')
  })
})

describe('DateField : date civile', () => {
  it('lit JJ/MM/AAAA et rend la date ISO', async () => {
    const wrapper = track(
      mount(DateField, { props: { label: 'Date de naissance', modelValue: null } }),
    )

    await type(wrapper, '5/3/1984')

    expect(wrapper.emitted('update:modelValue')).toEqual([['1984-03-05']])
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('05/03/1984')
  })

  it('accepte 8 chiffres (pavé numérique de l’iPhone, sans « / »)', async () => {
    const wrapper = track(mount(DateField, { props: { label: 'Date', modelValue: null } }))

    await type(wrapper, '15102026')
    expect(wrapper.emitted('update:modelValue')).toEqual([['2026-10-15']])
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('15/10/2026')

    await type(wrapper, '31022026')
    expect(wrapper.emitted('invalid')).toHaveLength(1)
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('31022026')
  })

  it('refuse une date inexistante et garde la saisie', async () => {
    const wrapper = track(mount(DateField, { props: { label: 'Date', modelValue: null } }))

    await type(wrapper, '29/02/2026')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.emitted('invalid')).toHaveLength(1)
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('29/02/2026')
    expect(wrapper.get('input').attributes('aria-invalid')).toBe('true')
  })

  it('n’invente jamais de date : vide → null', async () => {
    const wrapper = track(mount(DateField, { props: { label: 'Date', modelValue: '2026-10-15' } }))
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('15/10/2026')

    await type(wrapper, '')

    expect(wrapper.emitted('update:modelValue')).toEqual([[null]])
  })
})

describe('SelectField : liste native', () => {
  it('rend l’option vide explicite et la traduit en null', async () => {
    const wrapper = track(
      mount(SelectField, {
        props: {
          label: 'Mode de paiement',
          modelValue: null,
          options: [
            { value: 'CASH', label: 'Espèces' },
            { value: 'MOBILE_MONEY', label: 'Mobile money' },
          ],
        },
      }),
    )
    const select = wrapper.get('select')

    expect(select.findAll('option').map((option) => option.text())).toEqual([
      'Choisir…',
      'Espèces',
      'Mobile money',
    ])
    await select.setValue('MOBILE_MONEY')
    await select.setValue('')
    expect(wrapper.emitted('update:modelValue')).toEqual([['MOBILE_MONEY'], [null]])
  })

  it('remplace la flèche native par un chevron décoratif, sans toucher au contrôle natif', () => {
    const wrapper = track(
      mount(SelectField, {
        props: { label: 'Sexe', modelValue: null, options: [{ value: 'F', label: 'Féminin' }] },
      }),
    )

    expect(wrapper.get('select').classes()).toContain('appearance-none')
    expect(wrapper.get('select').classes()).toContain('pr-10')
    expect(wrapper.get('svg').attributes('aria-hidden')).toBe('true')
    expect(wrapper.get('label').attributes('for')).toBe(wrapper.get('select').attributes('id'))
  })
})

describe('présentation des champs (alignement, icône, état invalide)', () => {
  function follows(first: Element, second: Element): boolean {
    return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
  }

  it('place l’erreur puis l’aide SOUS le contrôle : saisies alignées, erreur contre sa saisie', () => {
    const wrapper = track(
      mount(TextField, {
        props: {
          label: 'Nom',
          modelValue: '',
          hint: 'Tel qu’il figure sur la pièce',
          error: 'Trop long.',
          controlId: 'nom',
        },
        attachTo: document.body,
      }),
    )
    const label = wrapper.get('label').element
    const input = wrapper.get('input').element
    const hint = wrapper.get('#nom-aide').element
    const error = wrapper.get('#nom-erreur').element

    expect(follows(label, input)).toBe(true)
    expect(follows(input, error)).toBe(true)
    expect(follows(error, hint)).toBe(true)
    // L'ordre de lecture par aria-describedby reste : aide, puis erreur.
    expect(wrapper.get('input').attributes('aria-describedby')).toBe('nom-aide nom-erreur')
  })

  it('garde le libellé sur la ligne de référence des boutons posés à côté du champ', () => {
    const wrapper = track(mount(TextField, { props: { label: 'Nom', modelValue: '' } }))

    // `.field-label` (base.css) fixe la hauteur et l’écart sur lesquels `--field-label-offset` se règle.
    expect(wrapper.get('label').classes()).toContain('field-label')
  })

  it('pose une icône décorative au début du champ, jamais à la place du libellé', () => {
    const wrapper = track(
      mount(TextField, { props: { label: 'Téléphone principal', modelValue: '', icon: 'phone' } }),
    )

    expect(wrapper.get('svg').attributes('aria-hidden')).toBe('true')
    expect(wrapper.get('input').classes()).toContain('pl-10')
    expect(wrapper.get('label').text()).toBe('Téléphone principal')
  })

  it('sans icône : aucun dessin ni marge intérieure en plus', () => {
    const wrapper = track(mount(TextField, { props: { label: 'Nom', modelValue: '' } }))

    expect(wrapper.find('svg').exists()).toBe(false)
    expect(wrapper.get('input').classes()).not.toContain('pl-10')
  })

  it('contrôle invalide : bordure, anneau et fond d’erreur, sans deux fonds en conflit', () => {
    // Jetons exacts : `border-danger` n'est pas satisfait par `hover:border-danger-strong`.
    const invalid = controlClasses(true)
      .flatMap((part) => part.split(/\s+/))
      .filter(Boolean)
    const valid = controlClasses(false)
      .flatMap((part) => part.split(/\s+/))
      .filter(Boolean)

    for (const token of ['border-danger', 'bg-danger-soft', 'ring-1', 'ring-danger']) {
      expect(invalid, token).toContain(token)
    }
    expect(invalid).toContain('field-control')
    expect(valid).toContain('field-control')
    // Un seul fond par état : deux utilitaires de fond se départageraient par l'ordre du CSS généré.
    expect(invalid.filter((token) => /^bg-/.test(token))).toEqual(['bg-danger-soft'])
    expect(valid.filter((token) => /^bg-/.test(token))).toEqual(['bg-surface'])
  })

  it('garde le remplissage horizontal d’origine (px-3) : les cellules étroites du tableau optique', () => {
    expect(controlClasses(false)).toEqual(
      expect.arrayContaining([expect.stringMatching(/\bpx-3\b/)]),
    )
    expect(controlClasses(false).join(' ')).not.toMatch(/\bpx-3\.5\b/)
  })

  it('place l’unité du montant DANS le champ, à droite, sans pastille ni largeur en plus', () => {
    const wrapper = track(
      mount(MoneyField, { props: { label: 'Montant', modelValue: 5000, controlId: 'montant' } }),
    )
    const unit = wrapper.get('#montant-unite')

    expect(unit.text()).toBe('FCFA')
    expect(unit.classes()).toEqual(expect.arrayContaining(['absolute', 'pointer-events-none']))
    expect(wrapper.get('input').classes()).toContain('pr-15')
    // L'unité est un frère de la saisie, dans la même enveloppe : une seule colonne de largeur.
    expect(unit.element.parentElement).toBe(wrapper.get('input').element.parentElement)
  })
})
