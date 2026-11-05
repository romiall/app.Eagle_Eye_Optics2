import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { h } from 'vue'

import CheckboxGroup from '@/components/form/CheckboxGroup.vue'
import YesNoField from '@/components/form/YesNoField.vue'

// Choix à cocher (motifs, antécédents) et choix « Oui / Non / Non renseigné » (lunettes, orientation) :
// vrai fieldset et vraie légende, cibles de 44 px, aide et erreur reliées au groupe, « Non renseigné »
// distinct de « Non ». Aucun état n'est déduit : le composant affiche ce qu'on lui donne.
const wrappers: VueWrapper[] = []
function track<T extends VueWrapper>(wrapper: T): T {
  wrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount()
})

/** `second` suit `first` dans l'ordre du document (ordre d'affichage des éléments d'un groupe). */
function follows(first: Element, second: Element): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
}

const OPTIONS = [
  { value: 'PAIN', label: 'Douleur' },
  { value: 'REDNESS', label: 'Rougeur' },
  { value: 'OTHER', label: 'Autre' },
]

describe('CheckboxGroup', () => {
  it('rend un fieldset légendé, une case par option dans un libellé de 44 px, reliée à son texte', () => {
    const wrapper = track(
      mount(CheckboxGroup, {
        props: {
          legend: 'Motifs de la consultation',
          options: OPTIONS,
          modelValue: ['REDNESS'],
          controlId: 'motifs',
        },
      }),
    )
    const fieldset = wrapper.get('fieldset')
    expect(fieldset.attributes('id')).toBe('motifs')
    expect(fieldset.get('legend').text()).toBe('Motifs de la consultation')
    const boxes = wrapper.findAll('input[type="checkbox"]')
    expect(boxes.map((box) => box.attributes('id'))).toEqual([
      'motifs-PAIN',
      'motifs-REDNESS',
      'motifs-OTHER',
    ])
    for (const box of boxes) {
      const label = wrapper.get(`label[for="${box.attributes('id')}"]`)
      expect(label.classes()).toContain('min-h-11')
    }
    expect(wrapper.get('label[for="motifs-PAIN"]').text()).toBe('Douleur')
    expect((boxes[1]?.element as HTMLInputElement).checked).toBe(true)
    expect((boxes[0]?.element as HTMLInputElement).checked).toBe(false)
  })

  it('émet la liste des valeurs cochées, sans modifier celle qu’on lui donne', async () => {
    const given = ['REDNESS']
    const wrapper = track(
      mount(CheckboxGroup, { props: { legend: 'Motifs', options: OPTIONS, modelValue: given } }),
    )
    await wrapper.get('input[id$="-PAIN"]').setValue(true)
    expect(wrapper.emitted('update:modelValue')).toEqual([[['REDNESS', 'PAIN']]])
    await wrapper.get('input[id$="-REDNESS"]').setValue(false)
    expect(wrapper.emitted('update:modelValue')?.[1]).toEqual([[]])
    expect(given).toEqual(['REDNESS'])
  })

  it('une option désactivée ou un groupe désactivé ne se coche pas', () => {
    const wrapper = track(
      mount(CheckboxGroup, {
        props: {
          legend: 'Motifs',
          options: [{ value: 'PAIN', label: 'Douleur', disabled: true }, ...OPTIONS.slice(1)],
          modelValue: [],
        },
      }),
    )
    const boxes = wrapper.findAll('input')
    expect(boxes[0]?.attributes('disabled')).toBeDefined()
    expect(boxes[1]?.attributes('disabled')).toBeUndefined()
    const all = track(
      mount(CheckboxGroup, {
        props: { legend: 'Motifs', options: OPTIONS, modelValue: [], disabled: true },
      }),
    )
    expect(all.findAll('input').every((box) => box.attributes('disabled') !== undefined)).toBe(true)
  })

  it('relie l’aide et l’erreur au groupe, l’erreur avec un symbole et un texte', () => {
    const wrapper = track(
      mount(CheckboxGroup, {
        props: {
          legend: 'Antécédents',
          options: OPTIONS,
          modelValue: [],
          hint: 'Plusieurs valeurs possibles.',
          error: 'Pas plus de 50 valeurs.',
          controlId: 'antecedents',
        },
      }),
    )
    const describedBy = (wrapper.get('fieldset').attributes('aria-describedby') ?? '').split(' ')
    expect(describedBy).toEqual(['antecedents-aide', 'antecedents-erreur'])
    expect(wrapper.get('#antecedents-aide').text()).toBe('Plusieurs valeurs possibles.')
    expect(wrapper.get('#antecedents-erreur').text()).toBe('⚠ Pas plus de 50 valeurs.')
    expect(wrapper.get('#antecedents-erreur [aria-hidden="true"]').text()).toBe('⚠')
  })

  it('affiche la légende, les choix, puis l’erreur et l’aide SOUS les choix (comme FieldShell)', () => {
    const wrapper = track(
      mount(CheckboxGroup, {
        props: {
          legend: 'Antécédents',
          options: OPTIONS,
          modelValue: [],
          hint: 'Plusieurs valeurs possibles.',
          error: 'Pas plus de 50 valeurs.',
          controlId: 'antecedents',
        },
        attachTo: document.body,
      }),
    )
    const legend = wrapper.get('legend').element
    const firstBox = wrapper.get('input[id$="-PAIN"]').element
    const lastBox = wrapper.get('input[id$="-OTHER"]').element
    const error = wrapper.get('#antecedents-erreur').element
    const hint = wrapper.get('#antecedents-aide').element

    expect(follows(legend, firstBox)).toBe(true)
    expect(follows(lastBox, error)).toBe(true)
    expect(follows(error, hint)).toBe(true)
    // Plus de `m-0` ni de `space-y-*` sur le fieldset : l'espacement du parent s'y applique.
    expect(wrapper.get('fieldset').classes()).not.toContain('m-0')
    expect(wrapper.get('fieldset').classes().join(' ')).not.toMatch(/space-y/)
  })

  it('le groupe est focalisable par programme (cible d’un résumé d’erreurs)', () => {
    const wrapper = track(
      mount(CheckboxGroup, {
        props: { legend: 'Motifs', options: OPTIONS, modelValue: [] },
        attachTo: document.body,
      }),
    )
    expect(wrapper.get('fieldset').attributes('tabindex')).toBe('-1')
    ;(wrapper.get('fieldset').element as HTMLElement).focus()
    expect(document.activeElement).toBe(wrapper.get('fieldset').element)
  })

  it('la fente « option » s’affiche sous la case, avec l’état coché', () => {
    const wrapper = track(
      mount(CheckboxGroup, {
        props: { legend: 'Motifs', options: OPTIONS, modelValue: ['OTHER'] },
        slots: {
          option: ({ option, checked }: { option: { value: string }; checked: boolean }) =>
            h('span', { 'data-slot': option.value }, String(checked)),
        },
      }),
    )
    expect(wrapper.get('[data-slot="OTHER"]').text()).toBe('true')
    expect(wrapper.get('[data-slot="PAIN"]').text()).toBe('false')
  })
})

describe('YesNoField', () => {
  it('trois choix explicites dans l’ordre Oui, Non, Non renseigné ; seul celui de la valeur est coché', () => {
    for (const [value, expected] of [
      [true, 'Oui'],
      [false, 'Non'],
      [null, 'Non renseigné'],
    ] as const) {
      const wrapper = track(
        mount(YesNoField, {
          props: { legend: 'Porte actuellement des lunettes', modelValue: value },
        }),
      )
      expect(wrapper.get('legend').text()).toBe('Porte actuellement des lunettes')
      const labels = wrapper.findAll('label').map((label) => label.text())
      expect(labels).toEqual(['Oui', 'Non', 'Non renseigné'])
      const checked = wrapper
        .findAll('input[type="radio"]')
        .map((radio, index) => ((radio.element as HTMLInputElement).checked ? labels[index] : null))
        .filter((label) => label !== null)
      expect(checked).toEqual([expected])
    }
  })

  it('émet true, false ou null ; « Non renseigné » n’est jamais confondu avec « Non »', async () => {
    const wrapper = track(mount(YesNoField, { props: { legend: 'Orientation', modelValue: null } }))
    const radios = wrapper.findAll('input[type="radio"]')
    await radios[0]?.setValue(true)
    await radios[1]?.setValue(true)
    await radios[2]?.setValue(true)
    expect(wrapper.emitted('update:modelValue')).toEqual([[true], [false], [null]])
  })

  it('les choix partagent un nom (flèches du clavier), mesurent 44 px et se désactivent', () => {
    const wrapper = track(
      mount(YesNoField, {
        props: {
          legend: 'Orientation',
          modelValue: null,
          controlId: 'orientation',
          disabled: true,
        },
      }),
    )
    const radios = wrapper.findAll('input[type="radio"]')
    expect(new Set(radios.map((radio) => radio.attributes('name'))).size).toBe(1)
    expect(radios.map((radio) => radio.attributes('id'))).toEqual([
      'orientation-oui',
      'orientation-non',
      'orientation-non-renseigne',
    ])
    for (const label of wrapper.findAll('label')) expect(label.classes()).toContain('min-h-11')
    expect(radios.every((radio) => radio.attributes('disabled') !== undefined)).toBe(true)
  })

  it('aide et erreur reliées au groupe ; le groupe est focalisable', () => {
    const wrapper = track(
      mount(YesNoField, {
        props: {
          legend: 'Orientation',
          modelValue: null,
          hint: 'Facultatif.',
          error: 'À préciser.',
          controlId: 'o',
        },
      }),
    )
    expect(wrapper.get('fieldset').attributes('aria-describedby')).toBe('o-aide o-erreur')
    expect(wrapper.get('fieldset').attributes('tabindex')).toBe('-1')
    expect(wrapper.get('#o-erreur').text()).toBe('⚠ À préciser.')
  })

  it('affiche la légende, les trois choix, puis l’erreur et l’aide SOUS les choix', () => {
    const wrapper = track(
      mount(YesNoField, {
        props: {
          legend: 'Orientation',
          modelValue: null,
          hint: 'Facultatif.',
          error: 'À préciser.',
          controlId: 'o',
        },
        attachTo: document.body,
      }),
    )
    const legend = wrapper.get('legend').element
    const firstRadio = wrapper.get('#o-oui').element
    const lastRadio = wrapper.get('#o-non-renseigne').element
    const error = wrapper.get('#o-erreur').element
    const hint = wrapper.get('#o-aide').element

    expect(follows(legend, firstRadio)).toBe(true)
    expect(follows(lastRadio, error)).toBe(true)
    expect(follows(error, hint)).toBe(true)
    expect(wrapper.get('fieldset').classes()).not.toContain('m-0')
    expect(wrapper.get('fieldset').classes().join(' ')).not.toMatch(/space-y/)
  })

  it('libellés personnalisables (autre formulation de la même réponse)', () => {
    const wrapper = track(
      mount(YesNoField, {
        props: {
          legend: 'Q',
          modelValue: null,
          yesLabel: 'Présente',
          noLabel: 'Absente',
          unknownLabel: 'Inconnue',
        },
      }),
    )
    expect(wrapper.findAll('label').map((label) => label.text())).toEqual([
      'Présente',
      'Absente',
      'Inconnue',
    ])
  })
})
