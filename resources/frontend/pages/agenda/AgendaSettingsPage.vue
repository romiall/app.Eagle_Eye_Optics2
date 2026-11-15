<script setup lang="ts">
/**
 * Configuration de l'agenda (S01 ; « Configurer ressources/services/horaires/exceptions »), gérante seulement,
 * EN LIGNE : ressources (professionnel ou salle, pas de l'agenda), leurs créneaux hebdomadaires, leurs fermetures
 * exceptionnelles, et les prestations réservables (durée). Aucun horaire n'est inventé : sans créneau, une ressource
 * n'est proposée à aucun rendez-vous. Chaque écriture passe par le chemin central et la page relit la configuration.
 *
 * Présentation : une carte par rubrique (professionnels et salles, fermetures à venir, prestations), les
 * créneaux hebdomadaires en pastilles, les formulaires ouverts dans un encadré crème sous leur élément.
 */
import { computed, ref } from 'vue'

import { formatInstantFr } from '@/app/clinicTime'
import { getAgendaConfiguration } from '@/app/services/agenda'
import { listStaff } from '@/app/services/staff'
import StateMessage from '@/components/feedback/StateMessage.vue'
import EmptyState from '@/components/layout/EmptyState.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import SectionCard from '@/components/layout/SectionCard.vue'
import StatusChip from '@/components/layout/StatusChip.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { WEEKDAY_LABELS } from '@/domain/agenda/agenda'
import type { AgendaConfiguration, StaffMemberPage } from '@/domain/contracts/generated'
import SalesReadMessage from '@/pages/sales/SalesReadMessage.vue'
import { useServerRead } from '@/pages/today/useServerRead'

import ClosureForm from './settings/ClosureForm.vue'
import OpeningHoursEditor from './settings/OpeningHoursEditor.vue'
import ResourceForm from './settings/ResourceForm.vue'
import ServiceForm from './settings/ServiceForm.vue'

const read = useServerRead<AgendaConfiguration>(() => getAgendaConfiguration())
const staffRead = useServerRead<StaffMemberPage>(() => listStaff())
const staff = computed(() => staffRead.data.value?.data ?? [])
const flash = ref<string | null>(null)
/** Formulaire ouvert : « resource:new », « resource:<id> », « hours:<id> », « closure:<id> », « service:new »… */
const open = ref<string | null>(null)

function saved(message: string): void {
  flash.value = message
  open.value = null
  void read.reload()
}

function toggle(key: string): void {
  flash.value = null
  open.value = open.value === key ? null : key
}

function hoursText(resource: AgendaConfiguration['resources'][number]): string[] {
  return resource.opening_hours.map(
    (hour) => `${WEEKDAY_LABELS[hour.weekday]} ${hour.opens_at}–${hour.closes_at}`,
  )
}
</script>

<template>
  <section aria-labelledby="titre-config-agenda" class="page-stack max-w-4xl">
    <PageHeader
      title-id="titre-config-agenda"
      title="Configuration de l’agenda"
      icon="settings"
      subtitle="Les horaires et les durées sont ceux du cabinet : rien n’est proposé par défaut. Une ressource sans créneau n’apparaît à aucune prise de rendez-vous."
      :back="{ to: { name: 'agenda' }, label: 'Retour à l’agenda' }"
    />

    <StateMessage v-if="flash" state="success" :title="flash" />

    <SalesReadMessage
      v-if="read.state.value !== 'ready'"
      :state="read.state.value"
      subject="la configuration de l’agenda"
      :error="read.error.value"
      @retry="read.reload()"
    />

    <template v-else-if="read.data.value">
      <SectionCard
        title="Professionnels et salles"
        title-id="titre-ressources"
        icon="building"
        description="Chaque ressource porte ses créneaux hebdomadaires et ses fermetures exceptionnelles."
      >
        <template #actions>
          <AppButton variant="secondary" @click="toggle('resource:new')">
            <AppIcon name="plus" />
            Nouvelle ressource
          </AppButton>
        </template>
        <div class="space-y-4">
          <ResourceForm
            v-if="open === 'resource:new'"
            :resource="null"
            :staff="staff"
            @saved="saved"
            @cancel="open = null"
          />
          <EmptyState
            v-if="read.data.value.resources.length === 0"
            title="Aucune ressource."
            icon="building"
            flat
          >
            Créez le premier professionnel ou la première salle de l’agenda.
          </EmptyState>
          <div v-else class="divide-y divide-line">
            <article
              v-for="resource in read.data.value.resources"
              :key="`${resource.id}-${resource.version}`"
              class="space-y-3 py-4 first:pt-0 last:pb-0"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0 space-y-1">
                  <h3 class="text-base font-semibold break-words">
                    {{ resource.name }}
                    <span v-if="!resource.active" class="text-sm font-normal text-muted"
                      >(désactivée)</span
                    >
                  </h3>
                  <p class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                    <span
                      v-if="resource.professional_name"
                      class="inline-flex items-center gap-1.5"
                    >
                      <AppIcon name="user" :size="16" class="text-gold" />
                      {{ resource.professional_name }}
                    </span>
                    <span v-if="resource.professional_name" class="sr-only"> · </span>
                    <span class="inline-flex items-center gap-1.5">
                      <AppIcon name="clock" :size="16" class="text-gold" />
                      Pas de {{ resource.slot_duration_minutes }} min
                    </span>
                  </p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <AppButton variant="ghost" @click="toggle(`resource:${resource.id}`)">
                    <AppIcon name="edit" />
                    Modifier
                  </AppButton>
                  <AppButton variant="ghost" @click="toggle(`hours:${resource.id}`)">
                    <AppIcon name="clock" />
                    Horaires
                  </AppButton>
                  <AppButton variant="ghost" @click="toggle(`closure:${resource.id}`)">
                    <AppIcon name="calendar" />
                    Fermeture exceptionnelle
                  </AppButton>
                </div>
              </div>
              <ul v-if="resource.opening_hours.length > 0" class="flex flex-wrap gap-2">
                <li
                  v-for="line in hoursText(resource)"
                  :key="line"
                  class="rounded-lg border border-line bg-canvas px-3 py-1 text-sm tabular-nums"
                >
                  {{ line }}
                </li>
              </ul>
              <StatusChip v-else as="p" tone="warning" icon="alert"
                >Aucun créneau hebdomadaire.</StatusChip
              >
              <ResourceForm
                v-if="open === `resource:${resource.id}`"
                :resource="resource"
                :staff="staff"
                @saved="saved"
                @cancel="open = null"
              />
              <OpeningHoursEditor
                v-if="open === `hours:${resource.id}`"
                :resource="resource"
                @saved="saved"
              />
              <ClosureForm
                v-if="open === `closure:${resource.id}`"
                :resource="resource"
                @saved="saved"
              />
            </article>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Fermetures et ouvertures à venir"
        title-id="titre-exceptions"
        icon="calendar"
      >
        <p
          v-if="read.data.value.exceptions.length === 0"
          class="flex items-center gap-2 text-muted"
        >
          <AppIcon name="calendar" class="text-gold" />
          Aucune dans les 90 prochains jours.
        </p>
        <ul v-else class="divide-y divide-line">
          <li
            v-for="exception in read.data.value.exceptions"
            :key="exception.id"
            class="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-4"
          >
            <StatusChip :tone="exception.is_available ? 'success' : 'warning'" class="self-start">{{
              exception.is_available ? 'Ouverture' : 'Fermeture'
            }}</StatusChip>
            <p class="min-w-0 text-sm break-words">
              <span class="font-medium tabular-nums"
                >du {{ formatInstantFr(exception.starts_at) }} au
                {{ formatInstantFr(exception.ends_at) }}</span
              >
              <span class="sr-only"> · </span>
              <span class="block text-muted">{{ exception.reason }}</span>
            </p>
          </li>
        </ul>
      </SectionCard>

      <SectionCard
        title="Prestations"
        title-id="titre-prestations"
        icon="stethoscope"
        description="Prestations réservables et durée de leurs rendez-vous."
      >
        <template #actions>
          <AppButton variant="secondary" @click="toggle('service:new')">
            <AppIcon name="plus" />
            Nouvelle prestation
          </AppButton>
        </template>
        <div class="space-y-4">
          <ServiceForm
            v-if="open === 'service:new'"
            :service="null"
            @saved="saved"
            @cancel="open = null"
          />
          <EmptyState
            v-if="read.data.value.services.length === 0"
            title="Aucune prestation."
            icon="stethoscope"
            flat
          />
          <div v-else class="divide-y divide-line">
            <article
              v-for="service in read.data.value.services"
              :key="`${service.id}-${service.version}`"
              class="space-y-3 py-4 first:pt-0 last:pb-0"
            >
              <div class="flex flex-wrap items-center justify-between gap-3">
                <h3 class="min-w-0 text-base font-semibold break-words">
                  {{ service.name }}
                  <span class="font-normal text-muted">· {{ service.duration_minutes }} min</span>
                  <span v-if="!service.active" class="text-sm font-normal text-muted"
                    >(désactivée)</span
                  >
                  <span v-else-if="service.public_booking" class="text-sm font-normal text-muted"
                    >(réservable en ligne)</span
                  >
                </h3>
                <AppButton variant="ghost" @click="toggle(`service:${service.id}`)">
                  <AppIcon name="edit" />
                  Modifier
                </AppButton>
              </div>
              <ServiceForm
                v-if="open === `service:${service.id}`"
                :service="service"
                @saved="saved"
                @cancel="open = null"
              />
            </article>
          </div>
        </div>
      </SectionCard>
    </template>
  </section>
</template>
