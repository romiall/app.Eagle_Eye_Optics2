<script setup lang="ts">
import { computed } from 'vue'
import { type RouteLocationRaw, RouterLink, useRouter } from 'vue-router'

import { canOnScreen } from '@/app/session'
import PageHeader from '@/components/layout/PageHeader.vue'
import AppIcon from '@/components/ui/AppIcon.vue'

/**
 * Hub Communication, CRM & Intégrations (L2) : oriente l’équipe et la gérante vers les modules
 * autorisés selon leurs droits effectifs.
 */
interface CommunicationCard {
  readonly id: string
  readonly routeName: string
  readonly fallbackPath: string
  readonly title: string
  readonly text: string
  readonly icon: string
  readonly permissions: readonly string[]
}

const router = useRouter()

const ALL_CARDS: readonly CommunicationCard[] = [
  {
    id: 'bookings',
    routeName: 'communication-bookings',
    fallbackPath: '/communication/reservations',
    title: 'Réservations en ligne & Google Agenda',
    text: 'Traiter les demandes reçues depuis le portail public et synchroniser les agendas Google.',
    icon: 'calendar-plus',
    permissions: ['agenda.read', 'agenda.write', 'communication.manage', 'integration.manage'],
  },
  {
    id: 'crm',
    routeName: 'communication-crm',
    fallbackPath: '/communication/crm',
    title: 'Prospects, CRM Kommo & liens patients',
    text: 'Gérer les contacts prospects sans dossier clinique, rattacher un patient et synchroniser Kommo.',
    icon: 'users',
    permissions: ['communication.manage', 'integration.manage', 'patient.read'],
  },
  {
    id: 'knowledge',
    routeName: 'communication-knowledge',
    fallbackPath: '/communication/connaissances',
    title: 'Base de connaissances gouvernée',
    text: 'Rédiger, approuver et publier une version unique des fiches consultées par l’assistant.',
    icon: 'clipboard',
    permissions: ['communication.manage', 'knowledge.manage'],
  },
  {
    id: 'handoffs',
    routeName: 'communication-handoffs',
    fallbackPath: '/communication/assistant',
    title: 'Assistant borné & reprises humaines',
    text: 'Tester les réponses sourcées, constater les refus cliniques et prendre le relais humain.',
    icon: 'communication',
    permissions: ['communication.manage', 'conversation.takeover'],
  },
  {
    id: 'consents',
    routeName: 'communication-consents',
    fallbackPath: '/communication/consentements',
    title: 'Consentements, modèles & relances',
    text: 'Enregistrer les opt-in / opt-out, approuver les modèles et suivre les envois transactionnels.',
    icon: 'bell',
    permissions: ['communication.manage'],
  },
  {
    id: 'campaigns',
    routeName: 'communication-campaigns',
    fallbackPath: '/communication/campagnes',
    title: 'Segments & campagnes',
    text: 'Définir des audiences strictement administratives, prévisualiser les exclusions et exécuter.',
    icon: 'mail',
    permissions: ['communication.manage'],
  },
  {
    id: 'outbox',
    routeName: 'communication-outbox',
    fallbackPath: '/communication/boite-envoi',
    title: 'Boîte d’envoi & webhooks',
    text: 'Superviser les événements internes outbox, les webhooks signés et le rattrapage global.',
    icon: 'send',
    permissions: ['integration.manage'],
  },
  {
    id: 'integrations',
    routeName: 'integrations',
    fallbackPath: '/parametres/integrations',
    title: 'Intégrations et connecteurs',
    text: 'Configurer les comptes connecteurs chiffrés et tester la connectivité externe.',
    icon: 'shield',
    permissions: ['integration.manage'],
  },
]

const cards = computed(() =>
  ALL_CARDS.filter((card) => card.permissions.some((permission) => canOnScreen(permission))),
)

function routeTarget(card: CommunicationCard): RouteLocationRaw {
  return router.hasRoute(card.routeName) ? { name: card.routeName } : card.fallbackPath
}
</script>

<template>
  <section aria-labelledby="titre-communication" class="page-stack max-w-5xl">
    <PageHeader
      title-id="titre-communication"
      title="Communication et CRM"
      subtitle="Rendez-vous en ligne, prospects, base de connaissances, consentements, campagnes et supervision des connecteurs."
      icon="communication"
      eyebrow="Relation & canaux"
    />

    <ul v-if="cards.length > 0" role="list" class="card-grid">
      <li v-for="card in cards" :key="card.id" class="min-w-0">
        <RouterLink :to="routeTarget(card)" class="card card-link group h-full gap-3 p-5 sm:p-6">
          <span class="flex items-start justify-between gap-3">
            <span
              aria-hidden="true"
              class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gold-soft text-gold-ink"
            >
              <AppIcon :name="card.icon" :size="22" />
            </span>
            <AppIcon
              name="chevron-right"
              :size="18"
              class="mt-3 text-muted group-hover:text-primary"
            />
          </span>
          <span class="text-lg font-semibold text-ink group-hover:text-primary">{{
            card.title
          }}</span>
          <span class="text-sm text-muted">{{ card.text }}</span>
        </RouterLink>
      </li>
    </ul>

    <div
      v-else
      class="flex max-w-prose items-start gap-3 rounded-xl border border-line bg-surface p-4 text-sm text-muted"
    >
      <AppIcon name="info" :size="18" class="mt-0.5 shrink-0 text-gold" />
      <p>
        Aucun écran de communication n’est ouvert sur ce compte. Contactez la gérante si vos droits
        doivent inclure la gestion des échanges ou des connecteurs.
      </p>
    </div>
  </section>
</template>
