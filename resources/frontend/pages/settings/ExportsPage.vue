<script setup lang="ts">
/**
 * Exports contrôlés (X02), module « settings », EN LIGNE : demander un export (mot de passe confirmé, 423),
 * suivre sa production par le serveur (tâche planifiée, quelques minutes) et télécharger l'archive pendant 48 h.
 * La gérante (export.global) demande les patients, les ventes, le stock ou la remise complète ; le dossier
 * d'un patient se demande depuis sa fiche (clinical.export). L'archive contient un fichier par table, le
 * dictionnaire des colonnes et un manifeste ; rien n'est produit ni gardé dans le navigateur.
 */
import { computed, ref, shallowRef } from 'vue'

import { ApiError, NetworkUnavailable } from '@/app/api'
import { formatDayFr, formatInstantFr } from '@/app/clinicTime'
import {
  EXPORT_SCOPE_ROLE_LABELS,
  EXPORT_STATUS_LABELS,
  EXPORT_TYPE_LABELS,
  type ExportScopeRole,
  type ExportType,
  exportDownloadUrl,
  getExportManifest,
  listExports,
} from '@/app/services/exports'
import type { MutationOutcome } from '@/app/services/mutations'
import { useMutation } from '@/app/services/useMutation'
import { canOnScreen, revalidateSession } from '@/app/session'
import StateMessage from '@/components/feedback/StateMessage.vue'
import DateField from '@/components/form/DateField.vue'
import SelectField from '@/components/form/SelectField.vue'
import EmptyState from '@/components/layout/EmptyState.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import SectionCard from '@/components/layout/SectionCard.vue'
import StatusChip, { type ChipTone } from '@/components/layout/StatusChip.vue'
import PasswordConfirmDialog from '@/components/session/PasswordConfirmDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { ExportManifest, ExportRequest } from '@/domain/contracts/generated'
import { FILTER_MODE_LABELS } from '@/domain/reports/management'
import { periodError } from '@/domain/reports/statistics'
import { CivilDate } from '@/domain/values/civilDate'
import SalesReadMessage from '@/pages/sales/SalesReadMessage.vue'
import { useServerRead } from '@/pages/today/useServerRead'

const read = useServerRead<ExportRequest[]>(listExports, { isEmpty: (list) => list.length === 0 })
const mutation = useMutation()
const askingPassword = ref(false)
const notice = ref<string | null>(null)
const problem = ref<string | null>(null)
const filterProblem = ref<string | null>(null)
const choice = ref<string | null>(null)
const filterFrom = ref<string | null>(null)
const filterTo = ref<string | null>(null)
const scopeRole = ref<string | null>(null)

const manifest = shallowRef<ExportManifest | null>(null)
const manifestLoading = ref(false)
const manifestError = ref<string | null>(null)

const canGlobal = computed(() => canOnScreen('export.global'))
const options = (['PATIENTS', 'FINANCE', 'STOCK', 'FULL_HANDOVER'] as const).map((type) => ({
  value: type,
  label: EXPORT_TYPE_LABELS[type],
}))
const scopeRoleOptions = (Object.keys(EXPORT_SCOPE_ROLE_LABELS) as ExportScopeRole[]).map(
  (role) => ({
    value: role,
    label: EXPORT_SCOPE_ROLE_LABELS[role],
  }),
)
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
      filterFrom.value = null
      filterTo.value = null
      scopeRole.value = null
      await read.reload()
      return
    case 'reauthentication-required':
      askingPassword.value = true
      return
    case 'refused': {
      const first = Object.values(outcome.error.fields).flat()[0] ?? outcome.error.message
      if (outcome.error.fields['filters'] || outcome.error.fields['filters.scope_role']) {
        filterProblem.value = first
      } else {
        problem.value = first
      }
      return
    }
    case 'session-expired':
      void revalidateSession().catch(() => undefined)
      return
    default:
      return
  }
}

function parsedDate(value: string | null): CivilDate | null | 'invalid' {
  if (value === null || value.trim() === '') return null
  try {
    return CivilDate.parse(value)
  } catch {
    return 'invalid'
  }
}

async function request(): Promise<void> {
  notice.value = null
  problem.value = null
  filterProblem.value = null
  if (choice.value === null) {
    problem.value = 'Choisissez le contenu de l’export.'
    return
  }

  const from = parsedDate(filterFrom.value)
  const to = parsedDate(filterTo.value)
  if (from === 'invalid' || to === 'invalid') {
    filterProblem.value = 'Date de filtre invalide : JJ/MM/AAAA ou AAAA-MM-JJ.'
    return
  }
  if ((from !== null && to === null) || (from === null && to !== null)) {
    filterProblem.value = 'Saisissez les deux bornes « Du » et « Au » pour filtrer par période.'
    return
  }
  if (from !== null && to !== null) {
    const err = periodError(from, to)
    if (err !== null) {
      filterProblem.value = err
      return
    }
  }

  const filters: Record<string, string> = {}
  if (from !== null && to !== null) {
    filters['from'] = from.toString()
    filters['to'] = to.toString()
  }
  if (scopeRole.value !== null && scopeRole.value !== '') {
    filters['scope_role'] = scopeRole.value
  }

  mutation.reset()
  await afterOutcome(
    await mutation.submit({
      name: 'RequestExport',
      route: { method: 'POST', path: '/exports', expectedVersion: 'omitted' },
      payload: {
        export_type: choice.value,
        ...(Object.keys(filters).length > 0 ? { filters } : {}),
      },
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

function hasManifest(item: ExportRequest): boolean {
  return item.status === 'READY' || item.status === 'EXPIRED'
}

function formatFilterSummary(item: ExportRequest): string | null {
  const f = item.filters
  if (!f) return null
  const parts: string[] = []
  if (f.from && f.to) {
    parts.push(
      `Période du ${formatDayFr(CivilDate.fromString(f.from))} au ${formatDayFr(CivilDate.fromString(f.to))}`,
    )
  }
  if (f.scope_role) {
    parts.push(`Portée : ${EXPORT_SCOPE_ROLE_LABELS[f.scope_role]}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

async function loadManifest(id: string): Promise<void> {
  manifestLoading.value = true
  manifestError.value = null
  try {
    const outcome = await getExportManifest(id)
    manifest.value = outcome.data
  } catch (failure) {
    manifest.value = null
    manifestError.value =
      failure instanceof NetworkUnavailable
        ? 'Serveur indisponible : manifeste non chargé.'
        : failure instanceof ApiError
          ? failure.message
          : 'Impossible de charger le manifeste conservé.'
  } finally {
    manifestLoading.value = false
  }
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
      <form class="space-y-4" novalidate @submit.prevent="request">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-start">
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
          <div class="min-w-0 lg:max-w-72 lg:flex-1">
            <SelectField
              v-model="scopeRole"
              label="Portée de profil (optionnel)"
              placeholder="Portée complète du demandeur"
              :options="scopeRoleOptions"
              control-id="export-scope-role"
            />
          </div>
        </div>
        <div class="flex flex-col gap-3 border-t border-line pt-3 lg:flex-row lg:items-start">
          <div class="min-w-0 flex-1">
            <DateField
              v-model="filterFrom"
              label="Du (optionnel)"
              control-id="export-filter-from"
            />
          </div>
          <div class="min-w-0 flex-1">
            <DateField
              v-model="filterTo"
              label="Au (optionnel)"
              control-id="export-filter-to"
              :error="filterProblem"
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
        </div>
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
            <p v-if="formatFilterSummary(item)" class="text-sm text-muted">
              {{ formatFilterSummary(item) }}
            </p>
            <p v-if="item.completed_at" class="text-sm text-muted">
              Produit le {{ formatInstantFr(item.completed_at)
              }}<template v-if="item.expires_at">
                · disponible jusqu’au {{ formatInstantFr(item.expires_at) }}</template
              >
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <AppButton
              v-if="hasManifest(item)"
              variant="secondary"
              :pending="manifestLoading"
              @click="loadManifest(item.id)"
            >
              Voir le manifeste conservé
            </AppButton>
            <a
              v-if="isDownloadable(item)"
              :href="exportDownloadUrl(item.id)"
              class="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-transparent bg-primary px-4 py-2 text-base font-semibold text-primary-contrast shadow-card hover:bg-primary-strong"
              ><AppIcon name="download" :size="18" />Télécharger l’archive<span class="sr-only">
                : {{ typeLabel(item.export_type) }}</span
              ></a
            >
          </div>
        </li>
      </ul>
    </SectionCard>

    <StateMessage v-if="manifestError" state="error" title="Manifeste indisponible">
      {{ manifestError }}
    </StateMessage>

    <div v-if="manifest" id="manifeste-export-panel">
      <SectionCard
        title="Manifeste conservé de l’export"
        title-id="titre-manifeste-export"
        icon="shield"
        :description="`Archive : ${EXPORT_STATUS_LABELS[manifest.archive_status]} · Produit le ${formatInstantFr(manifest.generated_at)}`"
      >
        <template #actions>
          <AppButton variant="ghost" @click="manifest = null">Fermer le manifeste</AppButton>
        </template>
        <div class="space-y-3 text-sm">
          <p class="text-muted">{{ manifest.provenance.note }}</p>
          <p v-if="manifest.archive_sha256" class="break-all">
            <span class="font-semibold">Empreinte {{ manifest.checksum_algorithm }} : </span>
            <code class="font-mono text-xs">{{ manifest.archive_sha256 }}</code>
          </p>
          <div v-if="manifest.excluded_tables.length > 0">
            <p class="font-semibold">
              Tables exclues du périmètre ({{ manifest.excluded_tables.length }}) :
            </p>
            <p class="text-muted">
              {{ manifest.excluded_tables.map((t) => t.table).join(', ') }}
            </p>
          </div>
          <div>
            <p class="font-semibold">Tables incluses ({{ manifest.tables.length }}) :</p>
            <ul class="mt-2 divide-y divide-line rounded-lg border border-line bg-canvas px-3">
              <li
                v-for="tbl in manifest.tables"
                :key="tbl.table"
                class="flex flex-wrap items-baseline justify-between gap-2 py-2 tabular-nums"
              >
                <span class="font-medium">{{ tbl.file }}</span>
                <span class="text-muted">
                  {{ tbl.rows }} ligne(s) · {{ FILTER_MODE_LABELS[tbl.filter_mode] }}
                </span>
              </li>
            </ul>
          </div>
        </div>
      </SectionCard>
    </div>

    <PasswordConfirmDialog
      :open="askingPassword"
      action="La demande d’un export"
      @confirmed="onPasswordConfirmed"
      @cancel="askingPassword = false"
    />
  </section>
</template>
