import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ComboboxField, {
  type ComboboxOption,
  type ComboboxSearchResult,
} from '@/components/form/ComboboxField.vue'

// Catalogue FICTIF : aucune donnée réelle, aucun prix réel.
const CATALOG: ComboboxOption[] = [
  { value: 'ART-0001', label: 'Examen de vue', description: 'TEST' },
  { value: 'ART-0002', label: 'Monture TEST A' },
  { value: 'ART-0003', label: 'Monture TEST B' },
]

function searchCatalog(query: string): Promise<readonly ComboboxOption[]> {
  const needle = query.toLowerCase()
  return Promise.resolve(CATALOG.filter((option) => option.label.toLowerCase().includes(needle)))
}

const wrappers: VueWrapper[] = []

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount()
  vi.useRealTimers()
})

function mountCombobox(search: (query: string) => Promise<ComboboxSearchResult> = searchCatalog) {
  const wrapper = mount(ComboboxField, {
    props: { label: 'Article', modelValue: null, search },
    attachTo: document.body,
  })
  wrappers.push(wrapper)
  return wrapper
}

async function typeQuery(wrapper: VueWrapper, text: string): Promise<void> {
  await wrapper.get('input').setValue(text)
  vi.advanceTimersByTime(200)
  await flushPromises()
}

function key(wrapper: VueWrapper, name: string) {
  return wrapper.get('input').trigger('keydown', { key: name })
}

describe('ComboboxField : sélection au clavier (fichier 04)', () => {
  it('suit le motif combobox ARIA : rôle, liste contrôlée, état replié', () => {
    const wrapper = mountCombobox()
    const input = wrapper.get('input')

    expect(input.attributes('role')).toBe('combobox')
    expect(input.attributes('aria-autocomplete')).toBe('list')
    expect(input.attributes('aria-expanded')).toBe('false')
    expect(
      wrapper.find(`[id="${input.attributes('aria-controls') ?? ''}"]`).attributes('role'),
    ).toBe('listbox')
    expect(wrapper.get('label').attributes('for')).toBe(input.attributes('id'))
  })

  it('attend deux caractères avant de chercher', async () => {
    const search = vi.fn(searchCatalog)
    const wrapper = mountCombobox(search)

    await typeQuery(wrapper, 'M')

    expect(search).not.toHaveBeenCalled()
    expect(wrapper.get('[role="status"]').text()).toBe('Saisissez au moins 2 caractères.')
  })

  it('parcourt les résultats avec les flèches et choisit avec Entrée', async () => {
    const wrapper = mountCombobox()
    await typeQuery(wrapper, 'mon')
    const input = wrapper.get('input')

    expect(input.attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('[role="option"]').map((option) => option.text())).toEqual([
      'Monture TEST A',
      'Monture TEST B',
    ])
    expect(wrapper.get('[role="status"]').text()).toContain('2 résultats')
    expect(input.attributes('aria-activedescendant')).toBeUndefined()

    await key(wrapper, 'ArrowDown')
    await key(wrapper, 'ArrowDown')
    const active = input.attributes('aria-activedescendant') ?? ''
    expect(wrapper.get(`[id="${active}"]`).text()).toBe('Monture TEST B')
    expect(wrapper.get(`[id="${active}"]`).attributes('aria-selected')).toBe('true')

    await key(wrapper, 'ArrowDown')
    expect(wrapper.get(`[id="${input.attributes('aria-activedescendant') ?? ''}"]`).text()).toBe(
      'Monture TEST A',
    )
    await key(wrapper, 'ArrowUp')
    await key(wrapper, 'Enter')

    expect(wrapper.emitted('update:modelValue')).toEqual([['ART-0003']])
    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ value: 'ART-0003' })
    expect((input.element as HTMLInputElement).value).toBe('Monture TEST B')
    expect(input.attributes('aria-expanded')).toBe('false')
  })

  it('ne choisit rien à la place de l’utilisateur : Entrée sans résultat actif ne sélectionne pas', async () => {
    const wrapper = mountCombobox()
    await typeQuery(wrapper, 'examen')

    await key(wrapper, 'Enter')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('Échap referme la liste sans effacer la saisie', async () => {
    const wrapper = mountCombobox()
    await typeQuery(wrapper, 'mon')

    await key(wrapper, 'Escape')

    expect(wrapper.get('input').attributes('aria-expanded')).toBe('false')
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('mon')
  })

  it('choisit à la souris sans perdre le focus du champ', async () => {
    const wrapper = mountCombobox()
    await typeQuery(wrapper, 'examen')

    const option = wrapper.get('[role="option"]')
    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    option.element.dispatchEvent(mousedown)
    expect(mousedown.defaultPrevented).toBe(true)
    await option.trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([['ART-0001']])
  })

  it('annule le choix quand l’utilisateur modifie le texte', async () => {
    const wrapper = mountCombobox()
    await wrapper.setProps({ modelValue: 'ART-0002', selectedLabel: 'Monture TEST A' })
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('Monture TEST A')

    await typeQuery(wrapper, 'Monture TEST')

    expect(wrapper.emitted('update:modelValue')).toEqual([[null]])
    expect(wrapper.emitted('select')).toEqual([[null]])
  })

  it('distingue « aucun résultat » de « recherche indisponible »', async () => {
    const wrapper = mountCombobox()
    await typeQuery(wrapper, 'zz')
    expect(wrapper.get('[role="status"]').text()).toBe('Aucun résultat pour « zz ».')

    const offline = mountCombobox(() => Promise.reject(new Error('Serveur injoignable')))
    await typeQuery(offline, 'monture')
    const status = offline.get('[role="status"]').text()
    expect(status).toContain('Recherche indisponible')
    expect(status).not.toContain('Aucun résultat')
  })

  it('ignore une réponse arrivée après une saisie plus récente', async () => {
    const resolvers: ((options: readonly ComboboxOption[]) => void)[] = []
    const wrapper = mountCombobox(
      () => new Promise<readonly ComboboxOption[]>((resolve) => resolvers.push(resolve)),
    )

    await typeQuery(wrapper, 'mon')
    await typeQuery(wrapper, 'exa')
    resolvers[1]?.([CATALOG[0] as ComboboxOption])
    await flushPromises()
    resolvers[0]?.([CATALOG[1] as ComboboxOption, CATALOG[2] as ComboboxOption])
    await flushPromises()

    expect(wrapper.findAll('[role="option"]').map((option) => option.get('span').text())).toEqual([
      'Examen de vue',
    ])
  })

  it('ramène l’option active dans la partie visible de la liste', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
    })
    try {
      const wrapper = mountCombobox()
      await typeQuery(wrapper, 'mon')
      await key(wrapper, 'ArrowDown')
      await key(wrapper, 'ArrowDown')
      await flushPromises()

      expect(scrollIntoView).toHaveBeenCalledTimes(2)
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' })
      expect(scrollIntoView.mock.contexts.at(-1)).toBe(
        wrapper.get(`[id="${wrapper.get('input').attributes('aria-activedescendant') ?? ''}"]`)
          .element,
      )
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })

  it('pendant une nouvelle recherche, les anciens résultats ne sont ni affichés ni choisissables', async () => {
    const wrapper = mountCombobox()
    await typeQuery(wrapper, 'mon')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(2)

    // Nouvelle saisie : la recherche est temporisée, rien n'est encore revenu.
    await wrapper.get('input').setValue('exa')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
    await key(wrapper, 'ArrowDown')
    await key(wrapper, 'Enter')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.get('[role="status"]').text()).toBe('Recherche en cours…')
  })

  it('une réponse arrivée pendant la temporisation d’une saisie plus récente est ignorée', async () => {
    const resolvers: ((options: readonly ComboboxOption[]) => void)[] = []
    const wrapper = mountCombobox(
      () => new Promise<readonly ComboboxOption[]>((resolve) => resolvers.push(resolve)),
    )
    await typeQuery(wrapper, 'mon')
    // Nouvelle saisie avant la réponse, et avant la fin de sa propre temporisation.
    await wrapper.get('input').setValue('exa')
    resolvers[0]?.([CATALOG[1] as ComboboxOption])
    await flushPromises()

    expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
    expect(wrapper.get('[role="status"]').text()).toBe('Recherche en cours…')
  })

  it('affiche des résultats partiels avec leur avertissement, jamais « aucun résultat » certain', async () => {
    const notice = 'Recherche serveur indisponible : seuls les dossiers préparés sur ce poste.'
    const partial = mountCombobox(() =>
      Promise.resolve({ options: [CATALOG[0] as ComboboxOption], notice }),
    )
    await typeQuery(partial, 'exa')
    expect(partial.findAll('[role="option"]')).toHaveLength(1)
    expect(partial.get('[role="status"]').text()).toContain(notice)
    expect(partial.get('[role="status"]').text()).toContain('1 résultat')

    const none = mountCombobox(() => Promise.resolve({ options: [], notice }))
    await typeQuery(none, 'zz')
    const status = none.get('[role="status"]').text()
    expect(status).toContain(notice)
    expect(status).toContain('Aucun résultat sur ce poste.')
    expect(status).not.toContain('Aucun résultat pour')
  })
})

describe('liste déroulante au clic (browseOnEmpty)', () => {
  it('ouvre immédiatement la liste complète au focus/clic, garde le filtre à 2 caractères, et reste fermée après reset', async () => {
    const calls: string[] = []
    const items: ComboboxOption[] = Array.from({ length: 12 }, (_, index) => ({
      value: `item-${index}`,
      label: `Article ${index + 1}`,
      description: `REF-${index + 1}`,
    }))
    const wrapper = mount(ComboboxField, {
      attachTo: document.body,
      props: {
        label: 'Catalogue',
        modelValue: null,
        browseOnEmpty: true,
        listMaxHeightClass: 'max-h-[min(37.5rem,60vh)]',
        search: async (query: string) => {
          calls.push(query)
          if (query === '') return items
          return items.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
        },
      },
    })

    const input = wrapper.get('input')
    expect(wrapper.get('ul[role="listbox"]').classes()).toContain('max-h-[min(37.5rem,60vh)]')

    // Clic / focus dans le champ vide : ouvre aussitôt sans attendre 200 ms.
    await input.trigger('focus')
    await input.trigger('click')
    await flushPromises()
    expect(calls).toEqual([''])
    expect(input.attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(12)

    // 1 caractère : demande au moins 2 caractères et vide les options.
    await input.setValue('a')
    await flushPromises()
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
    expect(wrapper.get('[role="status"]').text()).toContain('Saisissez au moins 2 caractères.')

    // 2 caractères : recherche filtrée avec suggestions.
    await input.setValue('Article 12')
    vi.advanceTimersByTime(200)
    await flushPromises()
    expect(calls).toEqual(['', 'Article 12'])
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1)
    expect(wrapper.get('[role="option"]').text()).toContain('Article 12')

    // Échap ferme la liste ; clic quand le champ est vidé réouvre la liste.
    await input.trigger('keydown', { key: 'Escape' })
    expect(input.attributes('aria-expanded')).toBe('false')
    wrapper.vm.reset({ focus: true })
    await flushPromises()
    expect(input.attributes('aria-expanded')).toBe('false')
    expect(calls).toEqual(['', 'Article 12'])

    await input.trigger('click')
    await flushPromises()
    expect(calls).toEqual(['', 'Article 12', ''])
    expect(input.attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(12)

    wrapper.unmount()
  })
})
