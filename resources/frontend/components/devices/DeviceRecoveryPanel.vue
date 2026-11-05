<script setup lang="ts">
/**
 * Sauvegarde chiffrée du poste et reprise d'un ancien poste (O07 ; runbook docs/runbooks/local-recovery.md).
 *
 * - Export : fichier chiffré téléchargé (journal commun, pièces PDF, ressources), à garder sur un support contrôlé ; seule
 *   la clé de récupération de la gérante le rouvre. Il ne copie aucun droit (ni grant, ni clé du poste).
 * - Reprise sur CE poste neuf : ouvrir l'export de l'ancien poste avec la clé de récupération, le ranger ici, déclarer le
 *   remplacement, transmettre ses pièces signées TELLES QUELLES (mêmes numéros), puis clôturer l'ancien poste. Ce poste
 *   réserve ensuite ses propres numéros (étape 4). Chaque écriture serveur demande le mot de passe de la gérante.
 */
import { onMounted, ref, shallowRef } from 'vue'

import {
  declareReplacement,
  deviceRecoveryStatus,
  type ExportManifest,
  exportThisDevice,
  type ImportReport,
  importOldDeviceExport,
  isRecoveryError,
  isVaultError,
  openOldDeviceExport,
  type RecoveredPushReport,
  reconcileOldDevice,
  transmitRecoveredCommands,
} from '@/app/services/vault'
import StateMessage from '@/components/feedback/StateMessage.vue'
import TextField from '@/components/form/TextField.vue'
import PasswordConfirmDialog from '@/components/session/PasswordConfirmDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { useAdminWrite } from '@/pages/settings/useAdminWrite'

const props = defineProps<{ deviceId: string | null }>()

const RECOVERY_MESSAGES: Record<string, string> = {
  EXPORT_UNREADABLE: 'Ce fichier n’est pas un export de poste lisible.',
  EXPORT_FORMAT_UNSUPPORTED:
    'Cet export vient d’une version que cette application ne sait pas ouvrir.',
  RECOVERY_KEY_INVALID:
    'Clé de récupération incorrecte pour cet export (vérifiez chaque groupe de 5 caractères).',
  EXPORT_CORRUPT:
    'Export altéré ou incomplet : rien n’a été repris. Utilisez une autre copie de l’export.',
  EXPORT_OTHER_CLINIC: 'Cet export vient d’un autre cabinet : il ne peut pas être repris ici.',
  EXPORT_SAME_DEVICE: 'Cet export est celui de CE poste : la reprise se fait sur un poste neuf.',
  EXPORT_WITHOUT_DEVICE:
    'L’ancien poste n’avait jamais été enrôlé : aucune pièce signée à reprendre.',
  RECOVERY_COMPARTMENT_MISSING:
    'Une clé de compartiment manque dans l’export : rien n’a été repris.',
}

const writer = useAdminWrite()
const busy = ref(false)
const problem = ref<string | null>(null)
const exported = shallowRef<{ fileName: string; manifest: ExportManifest } | null>(null)
const fileText = ref<string | null>(null)
const fileName = ref<string | null>(null)
const recoveryKey = ref('')
const opened = shallowRef<ExportManifest | null>(null)
const imported = shallowRef<ImportReport | null>(null)
const reason = ref('')
const replaced = ref(false)
const pushed = shallowRef<RecoveredPushReport | null>(null)
const reconciled = ref(false)
const status = shallowRef<Awaited<ReturnType<typeof deviceRecoveryStatus>>>([])

function explain(error: unknown): string {
  if (isRecoveryError(error)) return RECOVERY_MESSAGES[error.code] ?? 'Reprise impossible.'
  if (isVaultError(error))
    return 'Le coffre de ce poste doit être ouvert par un profil qui détient les compartiments des pièces.'
  return 'Opération impossible pour le moment : rien n’a été modifié.'
}

async function guarded(action: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = true
  problem.value = null
  try {
    await action()
  } catch (error) {
    problem.value = explain(error)
  } finally {
    busy.value = false
  }
}

async function refreshStatus(): Promise<void> {
  try {
    status.value = await deviceRecoveryStatus()
  } catch {
    status.value = []
  }
}

onMounted(() => void refreshStatus())

function exportNow(): Promise<void> {
  return guarded(async () => {
    exported.value = await exportThisDevice()
  })
}

async function chooseFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  opened.value = null
  imported.value = null
  if (file === undefined) return
  fileName.value = file.name
  fileText.value = await file.text()
}

function openFile(): Promise<void> {
  return guarded(async () => {
    if (fileText.value === null) throw new Error('fichier absent')
    opened.value = await openOldDeviceExport(fileText.value, recoveryKey.value)
    recoveryKey.value = ''
  })
}

function importFile(): Promise<void> {
  return guarded(async () => {
    imported.value = await importOldDeviceExport()
    await refreshStatus()
  })
}

function replace(): Promise<void> {
  const report = imported.value
  if (report === null) return Promise.resolve()
  return writer.run(
    () => declareReplacement(report.oldDeviceId, reason.value.trim()),
    () => {
      replaced.value = true
    },
  )
}

function transmit(): Promise<void> {
  const report = imported.value
  if (report === null) return Promise.resolve()
  return writer.run(
    () => transmitRecoveredCommands(report.oldDeviceId),
    async (result) => {
      pushed.value = result
      await refreshStatus()
    },
  )
}

function reconcile(): Promise<void> {
  const report = imported.value
  if (report === null) return Promise.resolve()
  return writer.run(
    () =>
      reconcileOldDevice({
        exportId: report.exportId,
        oldDeviceId: report.oldDeviceId,
        lastDeviceSequence: report.lastDeviceSequence,
        lastEventHash: report.lastEventHash,
        reason: reason.value.trim(),
      }),
    async () => {
      reconciled.value = true
      await refreshStatus()
    },
  )
}
</script>

<template>
  <div class="space-y-6">
    <section aria-labelledby="titre-export-poste" class="space-y-3">
      <h2 id="titre-export-poste" class="text-xl font-semibold">
        6. Sauvegarde chiffrée de ce poste
      </h2>
      <p class="max-w-prose">
        Le stockage du navigateur n’est pas une sauvegarde. À chaque clôture de caisse et lors d’une
        coupure prolongée, exportez ce poste : le fichier chiffré contient les pièces enregistrées
        ici. Gardez-le sur un support contrôlé ; seule la clé de récupération de la gérante permet
        de l’ouvrir, sur un autre poste.
      </p>
      <AppButton
        variant="primary"
        :pending="busy"
        pending-label="Export en cours…"
        @click="exportNow"
        >Exporter ce poste (fichier chiffré)</AppButton
      >
      <StateMessage v-if="exported" state="success" title="Export téléchargé">
        Fichier « {{ exported.fileName }} » : {{ exported.manifest.journal.commands }} pièce(s) du
        journal, dont {{ exported.manifest.journal.pending }} pas encore synchronisée(s). Rangez-le
        sur le support prévu.
      </StateMessage>
    </section>

    <section aria-labelledby="titre-reprise-poste" class="space-y-3">
      <h2 id="titre-reprise-poste" class="text-xl font-semibold">
        7. Reprendre un ancien poste (perdu ou remplacé)
      </h2>
      <p class="max-w-prose">
        Sur CE poste neuf, enrôlé et ouvert par la gérante : les pièces de l’ancien poste repartent
        avec leurs numéros d’origine, jamais renumérotées. Aucun droit de l’ancien poste n’est
        recopié : ce poste réserve ensuite ses propres numéros (étape 4).
      </p>
      <StateMessage v-if="props.deviceId === null" state="empty" title="Enrôlez d’abord ce poste">
        La reprise d’un ancien poste se fait sur un poste déjà enrôlé.
      </StateMessage>
      <template v-else>
        <div class="space-y-1">
          <label for="reprise-fichier" class="field-label block">Export de l’ancien poste</label>
          <input
            id="reprise-fichier"
            type="file"
            accept=".json,application/json"
            class="block min-h-11 w-full max-w-md text-base"
            @change="chooseFile"
          />
          <p v-if="fileName" class="text-sm text-muted">Fichier choisi : {{ fileName }}</p>
        </div>
        <TextField
          v-model="recoveryKey"
          label="Clé de récupération de la gérante"
          hint="11 groupes de 5 caractères. Elle n’est ni conservée ni envoyée."
          autocomplete="off"
          control-id="reprise-cle"
        />
        <AppButton
          variant="secondary"
          :disabled="fileText === null || recoveryKey.trim() === ''"
          :pending="busy"
          @click="openFile"
          >Ouvrir l’export</AppButton
        >

        <StateMessage v-if="opened" state="success" title="Export ouvert et vérifié">
          Ancien poste exporté le {{ opened.created_at }} : {{ opened.journal.commands }} pièce(s)
          du journal, dont {{ opened.journal.pending }} à transmettre ; dernier rang du journal :
          {{ opened.journal.last_device_sequence }}.
        </StateMessage>
        <AppButton v-if="opened && !imported" variant="primary" :pending="busy" @click="importFile"
          >Ranger l’export dans ce poste</AppButton
        >

        <template v-if="imported">
          <StateMessage state="success" title="Export rangé dans ce poste">
            {{ imported.commands }} pièce(s) signée(s) et {{ imported.documents }} PDF repris ; rien
            n’est encore envoyé.
          </StateMessage>
          <TextField
            v-model="reason"
            label="Motif du remplacement"
            hint="Par exemple : poste de la caisse tombé en panne. Conservé dans le journal."
            :error="writer.fieldError('reason')"
            control-id="reprise-motif"
          />
          <div class="flex flex-wrap gap-3">
            <AppButton
              variant="primary"
              :disabled="replaced || reason.trim().length < 3"
              :pending="writer.state.value === 'saving'"
              @click="replace"
              >1. Déclarer le remplacement</AppButton
            >
            <AppButton
              variant="primary"
              :disabled="!replaced || reconciled"
              :pending="writer.state.value === 'saving'"
              @click="transmit"
              >2. Transmettre les pièces de l’ancien poste</AppButton
            >
            <AppButton
              variant="primary"
              :disabled="!replaced || pushed === null || !pushed.complete || reconciled"
              :pending="writer.state.value === 'saving'"
              @click="reconcile"
              >3. Clôturer l’ancien poste</AppButton
            >
          </div>
          <StateMessage
            v-if="pushed"
            :state="pushed.complete ? 'success' : 'conflict'"
            :title="
              pushed.complete
                ? 'Toutes les pièces de l’ancien poste sont consolidées sur le serveur'
                : 'Reprise à poursuivre'
            "
          >
            {{ pushed.accepted }} acceptée(s), {{ pushed.waiting }} en attente d’une pièce liée,
            {{ pushed.conflicts }} à revoir par la gérante (Conflits de synchronisation),
            {{ pushed.rejected }} rejetée(s).
          </StateMessage>
          <StateMessage v-if="reconciled" state="success" title="Ancien poste clôturé">
            Ses numéros non utilisés sont inscrits « non utilisés », jamais réattribués. Réservez
            maintenant les numéros de ce poste (étape 4).
          </StateMessage>
        </template>

        <p v-if="writer.message.value" role="alert" class="font-medium text-warning">
          {{ writer.message.value }}
        </p>
      </template>
      <p v-if="problem" role="alert" class="font-medium text-warning">
        <span aria-hidden="true">⚠ </span>{{ problem }}
      </p>

      <section v-if="status.length > 0" aria-labelledby="titre-reprises" class="space-y-2">
        <h3 id="titre-reprises" class="text-lg font-semibold">
          Reprises enregistrées sur ce poste
        </h3>
        <ul class="space-y-1">
          <li v-for="entry in status" :key="entry.exportId" class="text-sm">
            Export du {{ entry.createdAt }} —
            {{
              entry.state === 'RECONCILED'
                ? 'ancien poste clôturé'
                : entry.pending > 0
                  ? `${entry.pending} pièce(s) à transmettre`
                  : 'pièces transmises'
            }}
          </li>
        </ul>
      </section>
    </section>

    <PasswordConfirmDialog
      :open="writer.state.value === 'reauthentication'"
      action="La reprise d’un ancien poste"
      @confirmed="writer.resume()"
      @cancel="writer.cancel()"
    />
  </div>
</template>
