<script setup lang="ts">
/**
 * Échec d'une écriture d'achats ou d'inventaire (fichier 04) : le message du serveur tel quel, l'état d'écran de l'issue
 * non confirmée et la reprise avec la MÊME clé d'idempotence (jamais deux réceptions, jamais deux ajustements). Les
 * refus par champ (422) sont rendus par l'écran dans son résumé d'erreurs ; la confirmation du mot de passe a sa boîte.
 */
import { computed } from 'vue'

import type { MutationState } from '@/app/services/useMutation'
import StateMessage from '@/components/feedback/StateMessage.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { salesFailureView } from '@/pages/sales/failureView'

const props = defineProps<{
  state: MutationState
  message: string | null
  failureMessage: string | null
  saving: boolean
}>()

const emit = defineEmits<{ retry: [] }>()

const view = computed(() =>
  props.state === 'reauthentication-required' ? null : salesFailureView(props.state),
)
</script>

<template>
  <StateMessage v-if="view" :state="view.state" :title="view.title">
    {{ failureMessage }}
    <template v-if="view.retry" #action>
      <AppButton variant="secondary" :pending="saving" @click="emit('retry')"
        >Réessayer l’enregistrement</AppButton
      >
    </template>
  </StateMessage>
  <StateMessage v-else-if="message" state="error" title="Opération refusée">
    {{ message }}
  </StateMessage>
</template>
