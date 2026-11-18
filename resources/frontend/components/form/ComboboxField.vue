<script setup lang="ts">
/**
 * Choix dans une liste avec recherche (fichier 04 : « sélection du catalogue avec flèches/Entrée »,
 * dossier patient de la facture) : motif « combobox » ARIA 1.2 à liste, sélection manuelle. La
 * recherche démarre à `minLength` caractères (2 par défaut) ; ↓/↑ parcourent les résultats, Entrée
 * choisit le résultat actif, Échap ferme la liste. Rien n'est choisi à la place de l'utilisateur :
 * modifier le texte annule le choix précédent.
 *
 * Les résultats viennent de la fonction `search` fournie par l'écran (service de lecture, F10) : le
 * composant n'interroge aucune table ni aucune API lui-même. Une recherche impossible (hors ligne,
 * serveur injoignable, erreur) est dite « indisponible », jamais « aucun résultat ». Une recherche
 * partielle rend ses résultats avec un avertissement (`{ options, notice }`). Les résultats d'une
 * saisie précédente disparaissent dès la nouvelle saisie ; l'option active reste visible.
 */
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

import { controlClasses } from './classes'
import FieldShell from './FieldShell.vue'

export interface ComboboxOption {
  value: string
  label: string
  /** Précision affichée sous le libellé (référence, prix, numéro de dossier). */
  description?: string
}

/**
 * Résultat d'une recherche : une liste, ou une liste partielle avec son avertissement (par exemple
 * les seuls dossiers préparés sur ce poste quand la recherche serveur est indisponible : fichier 04,
 * jamais « aucun dossier » avec certitude).
 */
export type ComboboxSearchResult =
  readonly ComboboxOption[] | { options: readonly ComboboxOption[]; notice: string }

type SearchStatus = 'idle' | 'loading' | 'ready' | 'unavailable'

const props = withDefaults(
  defineProps<{
    label: string
    /** Valeur de l'option choisie, ou null. */
    modelValue: string | null
    /** Libellé de l'option déjà choisie, affiché dans le champ. */
    selectedLabel?: string | null
    search: (query: string) => Promise<ComboboxSearchResult>
    minLength?: number
    debounceMs?: number
    hint?: string | undefined
    error?: string | null
    required?: boolean
    disabled?: boolean
    placeholder?: string | undefined
    controlId?: string | undefined
    unavailableText?: string
    /** Ouvre la liste et lance `search('')` dès l’entrée dans le champ vide. */
    browseOnEmpty?: boolean
    /** Hauteur maximale du `<ul role="listbox">` (classe Tailwind). */
    listMaxHeightClass?: string
  }>(),
  {
    selectedLabel: null,
    minLength: 2,
    debounceMs: 200,
    hint: undefined,
    error: null,
    required: false,
    disabled: false,
    placeholder: undefined,
    controlId: undefined,
    unavailableText: 'Recherche indisponible : rien n’est conclu sur l’existence d’un résultat.',
    browseOnEmpty: false,
    listMaxHeightClass: 'max-h-72',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
  select: [option: ComboboxOption | null]
}>()

const listId = `${useId()}-liste`
const inputRef = ref<HTMLInputElement | null>(null)
const text = ref(props.selectedLabel ?? '')
const options = ref<readonly ComboboxOption[]>([])
const activeIndex = ref(-1)
const open = ref(false)
const status = ref<SearchStatus>('idle')
const notice = ref<string | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null
let requestNumber = 0
let suppressFocusOpen = false

watch(
  () => props.selectedLabel,
  (label) => {
    if (!open.value) text.value = label ?? ''
  },
)

function optionId(index: number): string {
  return `${listId}-${index}`
}

const activeDescendant = computed(() =>
  open.value && activeIndex.value >= 0 ? optionId(activeIndex.value) : undefined,
)

const message = computed(() => {
  const query = text.value.trim()
  if (query.length < props.minLength && !(props.browseOnEmpty && query.length === 0)) {
    return `Saisissez au moins ${props.minLength} caractères.`
  }
  if (status.value === 'loading') return 'Recherche en cours…'
  if (status.value === 'unavailable') return props.unavailableText
  if (status.value === 'ready') {
    const count = options.value.length
    if (count === 0) {
      if (notice.value !== null) return `${notice.value} Aucun résultat sur ce poste.`
      return query === '' ? 'Aucun élément disponible.' : `Aucun résultat pour « ${query} ».`
    }
    const filterHint = query === '' ? ` (saisissez ${props.minLength} caractères pour filtrer)` : ''
    const found = `${count} résultat${count > 1 ? 's' : ''}${filterHint} : flèches haut et bas pour parcourir, Entrée pour choisir.`
    return notice.value === null ? found : `${notice.value} ${found}`
  }
  return ''
})

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

function close(): void {
  open.value = false
  activeIndex.value = -1
}

async function runSearch(query: string): Promise<void> {
  timer = null
  requestNumber += 1
  const number = requestNumber
  try {
    const results = await props.search(query)
    if (number !== requestNumber) return
    if ('notice' in results) {
      options.value = results.options
      notice.value = results.notice
    } else {
      options.value = results
      notice.value = null
    }
    status.value = 'ready'
  } catch {
    if (number !== requestNumber) return
    options.value = []
    notice.value = null
    status.value = 'unavailable'
  }
}

function openBrowse(): void {
  clearTimer()
  requestNumber += 1
  activeIndex.value = -1
  options.value = []
  notice.value = null
  status.value = 'loading'
  open.value = true
  void runSearch('')
}

function reset(opts: { focus?: boolean } = {}): void {
  clearTimer()
  requestNumber += 1
  text.value = ''
  options.value = []
  notice.value = null
  status.value = 'idle'
  close()
  if (opts.focus === true) {
    const element = inputRef.value
    if (element !== null && document.activeElement !== element) {
      suppressFocusOpen = true
      element.focus()
      queueMicrotask(() => {
        suppressFocusOpen = false
      })
    }
  }
}

defineExpose({ reset })

function scheduleSearch(): void {
  clearTimer()
  // Toute réponse encore attendue devient obsolète : seule la dernière saisie compte.
  requestNumber += 1
  activeIndex.value = -1
  // Les résultats de la saisie précédente ne restent ni affichés ni choisissables.
  options.value = []
  notice.value = null
  const query = text.value.trim()
  if (query.length === 0 && props.browseOnEmpty) {
    status.value = 'loading'
    open.value = true
    timer = setTimeout(() => void runSearch(''), props.debounceMs)
    return
  }
  if (query.length < props.minLength) {
    status.value = 'idle'
    open.value = query.length > 0
    return
  }
  status.value = 'loading'
  open.value = true
  timer = setTimeout(() => void runSearch(query), props.debounceMs)
}

// L'option active reste visible dans une liste qui défile (clavier, WCAG 2.4.7).
watch(activeIndex, async (index) => {
  if (index < 0) return
  await nextTick()
  document.getElementById(optionId(index))?.scrollIntoView?.({ block: 'nearest' })
})

function onFocus(): void {
  if (suppressFocusOpen) {
    suppressFocusOpen = false
    return
  }
  if (props.browseOnEmpty && !props.disabled && !open.value && text.value.trim() === '') {
    openBrowse()
  }
}

function onClick(): void {
  if (props.browseOnEmpty && !props.disabled && !open.value && text.value.trim() === '') {
    openBrowse()
  }
}

function onInput(event: Event): void {
  text.value = (event.target as HTMLInputElement).value
  if (props.modelValue !== null) {
    emit('update:modelValue', null)
    emit('select', null)
  }
  scheduleSearch()
}

function choose(index: number): void {
  const option = options.value[index]
  if (option === undefined) return
  text.value = option.label
  close()
  emit('update:modelValue', option.value)
  emit('select', option)
}

function onKeydown(event: KeyboardEvent): void {
  const count = options.value.length
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      if (!open.value) {
        const query = text.value.trim()
        if (query.length >= props.minLength || (props.browseOnEmpty && query.length === 0)) {
          if (status.value === 'idle') {
            if (props.browseOnEmpty && query.length === 0) openBrowse()
            else {
              open.value = true
              scheduleSearch()
            }
          } else {
            open.value = true
          }
        }
        return
      }
      if (count > 0) activeIndex.value = (activeIndex.value + 1) % count
      break
    case 'ArrowUp':
      event.preventDefault()
      if (open.value && count > 0)
        activeIndex.value = activeIndex.value <= 0 ? count - 1 : activeIndex.value - 1
      break
    case 'Enter':
      // Entrée sans résultat actif garde son rôle habituel (envoi du formulaire).
      if (open.value && activeIndex.value >= 0) {
        event.preventDefault()
        choose(activeIndex.value)
      }
      break
    case 'Escape':
      if (open.value) {
        event.preventDefault()
        close()
      }
      break
    default:
      break
  }
}

onBeforeUnmount(() => {
  clearTimer()
  requestNumber += 1
  suppressFocusOpen = false
})
</script>

<template>
  <FieldShell
    v-slot="{ id, describedBy, invalid }"
    :label="props.label"
    :hint="props.hint"
    :error="props.error"
    :required="props.required"
    :control-id="props.controlId"
  >
    <div class="relative">
      <input
        :id="id"
        ref="inputRef"
        :value="text"
        type="text"
        role="combobox"
        autocomplete="off"
        aria-autocomplete="list"
        :aria-expanded="open ? 'true' : 'false'"
        :aria-controls="listId"
        :aria-activedescendant="activeDescendant"
        :aria-invalid="invalid ? 'true' : undefined"
        :aria-describedby="describedBy"
        :placeholder="props.placeholder"
        :required="props.required"
        :disabled="props.disabled"
        :class="controlClasses(invalid)"
        @focus="onFocus"
        @click="onClick"
        @input="onInput"
        @keydown="onKeydown"
        @blur="close"
      />
      <div
        v-show="open"
        class="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-raised"
      >
        <ul
          :id="listId"
          role="listbox"
          :aria-label="props.label"
          :class="['overflow-y-auto', props.listMaxHeightClass]"
        >
          <li
            v-for="(option, index) in options"
            :id="optionId(index)"
            :key="option.value"
            role="option"
            :aria-selected="index === activeIndex ? 'true' : 'false'"
            :class="[
              'min-h-11 cursor-pointer border-l-4 px-3 py-2',
              index === activeIndex
                ? 'border-gold bg-primary-soft text-primary'
                : 'border-transparent text-ink hover:bg-canvas',
            ]"
            @mousedown.prevent
            @click="choose(index)"
          >
            <span class="block font-medium">{{ option.label }}</span>
            <span v-if="option.description" class="block text-sm text-muted">{{
              option.description
            }}</span>
          </li>
        </ul>
        <p v-if="message" aria-hidden="true" class="px-3 py-2 text-sm text-muted">{{ message }}</p>
      </div>
      <p class="sr-only" role="status" aria-live="polite">{{ open ? message : '' }}</p>
    </div>
  </FieldShell>
</template>
