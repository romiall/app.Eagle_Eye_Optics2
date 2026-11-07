<script setup lang="ts">
/**
 * État de synchronisation du poste (F10), distinct de l'état du réseau : pièces encore à envoyer
 * (dont celles d'autres profils, qui partent à l'ouverture de leur profil), conflits à revoir, PDF à
 * régénérer ou à déposer, dernier échange réussi. Rien n'est affiché tant qu'aucun poste n'est
 * préparé (aucune pièce locale). « Synchronisé » n'est dit que si rien n'attend, qu'un échange a
 * réussi et que le dernier essai n'a pas échoué. Libellés et symboles : jamais la seule couleur.
 */
import { computed, ref } from 'vue'

import { useSyncStateSource, waitingSentences, waitingTotal } from '@/app/services/sync'
import AppButton from '@/components/ui/AppButton.vue'

const props = withDefaults(defineProps<{ timeZone?: string }>(), { timeZone: 'Africa/Douala' })

const source = useSyncStateSource()
const summary = computed(() => source?.summary.value ?? null)
const syncing = ref(false)
const syncError = ref(false)

function plural(count: number, one: string, many: string): string {
  return `${count} ${count > 1 ? many : one}`
}

function clock(instant: string): string {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: props.timeZone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant))
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '00'
  return `${read('day')}/${read('month')} à ${read('hour')}h${read('minute')}`
}

interface Line {
  key: string
  icon: string
  text: string
  tone: string
}

const lines = computed<Line[]>(() => {
  const value = summary.value
  if (value === null) return []
  const result: Line[] = []
  if (value.conflicts > 0) {
    result.push({
      key: 'conflicts',
      icon: '⚠',
      text: `${plural(value.conflicts, 'conflit', 'conflits')} à revoir`,
      tone: 'text-danger',
    })
  }
  const waiting = value.local + value.pending + value.waitingDependency
  if (waiting > 0) {
    result.push({
      key: 'waiting',
      icon: '↻',
      text: `${plural(waiting, 'pièce', 'pièces')} en attente de synchronisation`,
      tone: 'text-warning',
    })
  }
  if (value.otherProfiles > 0) {
    // Par compartiment quand le poste le sait (P04) : « 3 pièces de la caisse : à envoyer à l’ouverture d’un profil de
    // caisse ou de la gérante ». Le compte total des compartiments doit être celui des pièces d'autres profils, sinon on
    // garde l'annonce générique plutôt qu'un détail incomplet.
    const detail =
      value.otherCompartments !== undefined &&
      waitingTotal(value.otherCompartments) === value.otherProfiles
        ? waitingSentences(value.otherCompartments)
        : []
    if (detail.length > 0) {
      for (const [index, sentence] of detail.entries()) {
        result.push({ key: `others-${index}`, icon: '↻', text: sentence, tone: 'text-warning' })
      }
    } else {
      result.push({
        key: 'others',
        icon: '↻',
        text: `${plural(value.otherProfiles, 'pièce', 'pièces')} d’autres profils : à envoyer à l’ouverture de leur profil`,
        tone: 'text-warning',
      })
    }
  }
  if (value.documentsFailed > 0) {
    result.push({
      key: 'documents',
      icon: '⚠',
      text: `${plural(value.documentsFailed, 'PDF', 'PDF')} à régénérer`,
      tone: 'text-danger',
    })
  }
  if (value.documentsToUpload > 0) {
    result.push({
      key: 'uploads',
      icon: '↻',
      text: `${plural(value.documentsToUpload, 'PDF', 'PDF')} à déposer sur le serveur`,
      tone: 'text-warning',
    })
  }
  if (value.lastAttemptFailed || syncError.value) {
    result.push({
      key: 'failed',
      icon: '⚠',
      text: 'Dernier essai d’échange sans réponse du serveur',
      tone: 'text-warning',
    })
  }
  if (result.length === 0) {
    result.push(
      value.lastExchangeAt === null
        ? { key: 'never', icon: '○', text: 'Jamais synchronisé', tone: 'text-warning' }
        : {
            key: 'synced',
            icon: '✓',
            text: `Synchronisé le ${clock(value.lastExchangeAt)}`,
            tone: 'text-accent',
          },
    )
  } else if (value.lastExchangeAt !== null) {
    result.push({
      key: 'last',
      icon: '·',
      text: `Dernier échange réussi le ${clock(value.lastExchangeAt)}`,
      tone: 'text-muted',
    })
  }
  return result
})

async function syncNow(): Promise<void> {
  if (source?.syncNow === undefined || syncing.value) return
  syncing.value = true
  syncError.value = false
  try {
    await source.syncNow()
  } catch {
    // L'échec est annoncé ; les pièces restent dans le journal du poste.
    syncError.value = true
  } finally {
    syncing.value = false
  }
}
</script>

<template>
  <div v-if="summary" class="flex flex-wrap items-center gap-x-3 gap-y-1">
    <p
      role="status"
      aria-live="polite"
      class="flex flex-wrap items-center gap-x-3 text-sm font-medium"
    >
      <span class="sr-only">Synchronisation du poste : </span>
      <span v-for="line in lines" :key="line.key" :class="['flex items-center gap-1', line.tone]">
        <span aria-hidden="true">{{ line.icon }}</span
        ><span>{{ line.text }}</span>
      </span>
    </p>
    <AppButton
      v-if="source?.syncNow"
      variant="ghost"
      :pending="syncing"
      pending-label="Synchronisation en cours…"
      @click="syncNow"
      >Synchroniser</AppButton
    >
  </div>
</template>
