import './styles.css'

import { createEeoApp } from './bootstrap'
import { registerServiceWorker } from './pwa'
import { watchServiceWorkerUpdates } from './services/appUpdate'
import { installDeviceSync } from './services/deviceSync'
import { installVaultWatch } from './services/localIdentity'

const { app, router } = createEeoApp()

void router.isReady().then(() => {
  app.mount('#app')
  // Nouvelle version proposée, jamais imposée (O06) : contrôle des pièces du poste avant l'installation.
  watchServiceWorkerUpdates(registerServiceWorker())
  // Synchronisation automatique du poste préparé (O05) : sans effet tant qu'aucun poste enrôlé n'est ouvert.
  installDeviceSync()
  // Coffre du poste (D12, D13, D27) : activité, verrouillage après inactivité, résumé du cabinet retenu pour le
  // démarrage suivant sans serveur. Sans coffre, rien n'est ouvert.
  installVaultWatch()
})
