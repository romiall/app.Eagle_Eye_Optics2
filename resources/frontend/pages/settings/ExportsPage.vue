<script setup lang="ts">
/**
 * Exports contrôlés (X02), module « settings », EN LIGNE : demander un export (mot de passe confirmé, 423),
 * suivre sa production par le serveur (tâche planifiée, quelques minutes) et télécharger l'archive pendant 48 h.
 * La gérante (export.global) demande les patients, les ventes, le stock ou la remise complète ; le dossier
 * d'un patient se demande depuis sa fiche (clinical.export). L'archive contient un fichier par table, le
 * dictionnaire des colonnes et un manifeste ; rien n'est produit ni gardé dans le navigateur.
 */
import { computed, ref } from 'vue'

import { formatInstantFr } from '@/app/clinicTime'
import {
  EXPORT_STATUS_LABELS,
  EXPORT_TYPE_LABELS,
  exportDownloadUrl,
  type ExportType,
  listExports,
} from '@/app/services/exports'
import type { MutationOutcome } from '@/app/services/mutations'
import { useMutation } from '@/app/services/useMutation'
import { canOnScreen, revalidateSession } from '@/app/session'
import StateMessage from '@/components/feedback/StateMessage.vue'
import SelectField from '@/components/form/SelectField.vue'
import EmptyState from '@/components/layout/EmptyState.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import SectionCard from '@/components/layout/SectionCard.vue'
import StatusChip, { type ChipTone } from '@/components/layout/StatusChip.vue'
import PasswordConfirmDialog from '@/components/session/PasswordConfirmDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { ExportRequest } from '@/domain/contracts/generated'
import SalesReadMessage from '@/pages/sales/SalesReadMessage.vue'
import { useServerRead } from '@/pages/today/useServerRead'

const read = useServerRead<ExportRequest[]>(listExports, { isEmpty: (list) => list.length === 0 })
const mutation = useMutation()
const askingPassword = ref(false)
const notice = ref<string | null>(null)
const problem = ref<string | null>(null)
const choice = ref<string | null>(null)

const canGlobal = computed(() => canOnScreen('export.global'))
const options = (['PATIENTS', 'FINANCE', 'STOCK', 'FULL_HANDOVER'] as const).map((type) => ({
  value: type,
  label: EXPORT_TYPE_LABELS[type],
}))
const busy = computed(() => mutation.state.value === 'saving')

/** Puce de l'état d'un export : le libellé porte le sens, l'icône et la teinte l'accompagnent. */
const STATUS_TONES: Readonly<Record<ExportRequest['status'], ChipTone>> = {
  REQUESTED: 'info',
  PROCESSING: 'gold',
  READY: 'success',
  FAILED: 'danger',
  EXPIRED: 'neutral',
}
const STATUS_ICONS: Readonly<Record<ExportRequest['status'], string>> = {
  REQUESTED: 'clock',
  PROCESSING: 'refresh',
  READY: 'check-circle',
  FAILED: 'alert',
  EXPIRED: 'history',
}

function typeLabel(type: ExportType): string {
  return EXPORT_TYPE_LABELS[type]
}

async function afterOutcome(outcome: MutationOutcome): Promise<void> {
  switch (outcome.kind) {
    case 'synced':
      notice.value =
        'Export demandé : le serveur le prépare (quelques minutes). Actualisez la liste pour le télécharger.'
      choice.value = null
      await read.reload()
      return
    case 'reauthentication-required':
      askingPassword.value = true
      return
    case 'refused':
      problem.value = Object.values(outcome.error.fields).flat()[0] ?? outcome.error.message
      return
    case 'session-expired':
      void revalidateSession().catch(() => undefined)
      return
    default:
      return
  }
}

async function request(): Promise<void> {
  notice.value = null
  problem.value = null
  if (choice.value === null) {
    problem.value = 'Choisissez le contenu de l’export.'
    return
  }
  mutation.reset()
  await afterOutcome(
    await mutation.submit({
      name: 'RequestExport',
      route: { method: 'POST', path: '/exports', expectedVersion: 'omitted' },
      payload: { export_type: choice.value },
    }),
  )
}

async function onPasswordConfirmed(): Promise<void> {
  askingPassword.value = false
  await afterOutcome(await mutation.retry())
}

function isDownloadable(item: ExportRequest): boolean {
  return (
    item.status === 'READY' && item.expires_at !== null && Date.parse(item.expires_at) > Date.now()
  )
}
</script>

<template>
  <section aria-labelledby="titre-exports" class="page-stack max-w-4xl">
    <PageHeader
      title-id="titre-exports"
      title="Exports"
      icon="download"
      subtitle="Une archive privée par export : un fichier par table (à ouvrir dans un tableur), le sens de chaque colonne et un contrôle d’intégrité. Données personnelles et de santé : conservez-la de façon sécurisée. Le dossier d’un patient s’exporte depuis sa fiche."
    />

    <SectionCard
      v-if="canGlobal"
      title="Demander un export"
      title-id="titre-exports-demande"
      icon="file-plus"
    >
      <!-- Empilé jusqu'à 1024 px : la carte est étroite à côté du menu, et une étiquette qui passe sur
           deux lignes (polices plus larges, CI Linux) décalerait la saisie du bouton aligné sur elle.
           Dès 1024 px la liste et le bouton partagent une ligne, le bouton descend de l'étiquette. -->
      <form
        class="flex flex-col gap-3 lg:flex-row lg:items-start"
        novalidate
        @submit.prevent="request"
      >
        <div class="min-w-0 lg:max-w-80 lg:flex-1">
          <SelectField
            v-model="choice"
            label="Contenu de l’export"
            placeholder="Choisir…"
            :options="options"
            control-id="export-type"
            :error="problem"
            required
          />
        </div>
        <AppButton
          type="submit"
          variant="primary"
          class="sm:self-start lg:mt-(--field-label-offset) lg:self-auto"
          :pending="busy"
          pending-label="Demande en cours…"
          >Demander l’export</AppButton
        >
      </form>
    </SectionCard>
    <StateMessage v-if="notice" state="success" :title="notice" />
    <StateMessage
      v-if="mutation.failureMessage.value && !askingPassword"
      state="offline"
      title="Demande non aboutie"
    >
      {{ mutation.failureMessage.value }}
    </StateMessage>

    <SectionCard title="Exports récents" title-id="titre-exports-liste" icon="archive">
      <template #actions>
        <AppButton variant="secondary" @click="read.reload()">
          <AppIcon name="refresh" :size="18" />
          Actualiser la liste
        </AppButton>
      </template>
      <SalesReadMessage
        v-if="read.state.value !== 'ready' && read.state.value !== 'empty'"
        :state="read.state.value"
        subject="les exports"
        :error="read.error.value"
        @retry="read.reload()"
      />
      <div v-else-if="read.state.value === 'empty'" role="status">
        <EmptyState title="Aucun export" icon="archive" flat>
          Aucun export n’a encore été demandé.
        </EmptyState>
      </div>
      <ul v-else role="list" class="divide-y divide-line">
        <li
          v-for="item in read.data.value ?? []"
          :key="item.id"
          class="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
        >
          <div class="min-w-0 space-y-2">
            <p class="font-semibold break-words">{{ typeLabel(item.export_type) }}</p>
            <StatusChip as="p" :tone="STATUS_TONES[item.status]" :icon="STATUS_ICONS[item.status]">
              {{ EXPORT_STATUS_LABELS[item.status] }}
            </StatusChip>
            <p v-if="item.completed_at" class="text-sm text-muted">
              Produit le {{ formatInstantFr(item.completed_at)
              }}<template v-if="item.expires_at">
                · disponible jusqu’au {{ formatInstantFr(item.expires_at) }}</template
              >
            </p>
          </div>
          <a
            v-if="isDownloadable(item)"
            :href="exportDownloadUrl(item.id)"
            class="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-transparent bg-primary px-4 py-2 text-base font-semibold text-primary-contrast shadow-card hover:bg-primary-strong"
            ><AppIcon name="download" :size="18" />Télécharger l’archive<span class="sr-only">
              : {{ typeLabel(item.export_type) }}</span
            ></a
          >
        </li>
      </ul>
    </SectionCard>

    <PasswordConfirmDialog
      :open="askingPassword"
      action="La demande d’un export"
      @confirmed="onPasswordConfirmed"
      @cancel="askingPassword = false"
    />
  </section>
</template>
