<script setup lang="ts">
/**
 * Boîte « Nouvelle consultation » (C01) : boîte de dialogue modale native (`<dialog>` ouverte par showModal :
 * le reste de la page devient inerte, Échap ferme), focus sur son titre à l'ouverture, rendu au bouton qui l'a
 * ouverte à la fermeture. L'écran des examens la MONTE à la demande (`v-if`) : tant qu'elle n'est pas demandée,
 * aucune boîte n'est dans le document et la file du jour n'est pas lue. Le contenu (file du jour, recherche
 * d'un patient, arrivée puis examen) est dans `StartConsultationPanel`.
 */
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'

import StartConsultationPanel from './StartConsultationPanel.vue'

const emit = defineEmits<{ close: [] }>()

const titleId = `${useId()}-titre`
const dialog = ref<HTMLDialogElement | null>(null)
let opener: HTMLElement | null = null

onMounted(async () => {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const element = dialog.value
  if (element === null) return
  if (typeof element.showModal === 'function') element.showModal()
  else element.setAttribute('open', '')
  await nextTick()
  document.getElementById(titleId)?.focus()
})

onBeforeUnmount(() => {
  const element = dialog.value
  if (element !== null && element.open) {
    if (typeof element.close === 'function') element.close()
    else element.removeAttribute('open')
  }
  if (opener !== null && opener.isConnected) opener.focus()
})

/** Échap : la fermeture native est empêchée ; l'écran démonte la boîte. */
function onCancel(event: Event): void {
  event.preventDefault()
  emit('close')
}
</script>

<template>
  <dialog
    ref="dialog"
    :aria-labelledby="titleId"
    tabindex="-1"
    class="m-auto max-h-[calc(100dvh-2rem)] w-[min(42rem,calc(100%-2rem))] overflow-y-auto rounded-xl border border-t-4 border-line border-t-gold bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40"
    @cancel="onCancel"
    @close="emit('close')"
  >
    <StartConsultationPanel :title-id="titleId" @close="emit('close')" />
  </dialog>
</template>
