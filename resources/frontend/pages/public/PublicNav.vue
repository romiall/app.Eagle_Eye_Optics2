<script setup lang="ts">
/**
 * Navigation des pages publiques (showroom, prise de rendez-vous) : deux liens, jamais d'accès au reste de
 * l'application. Le visiteur n'a pas de compte ; la connexion du personnel n'est pas proposée ici.
 */
import LinkButton from '@/components/ui/LinkButton.vue'
</script>

<template>
  <nav aria-label="Pages du site public" class="flex flex-wrap gap-3">
    <LinkButton :to="{ name: 'public-showroom' }" variant="secondary">Showroom</LinkButton>
    <LinkButton :to="{ name: 'public-booking' }" variant="secondary">Prendre rendez-vous</LinkButton>
  </nav>
</template>
