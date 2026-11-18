/**
 * Commandes du journal que le serveur sait APPLIQUER depuis un poste (O05) : numéro pris dans la plage du poste,
 * propriété de facture importée, réserves sous quota, horloge du poste pour la date de la pièce. Seules celles-ci sont
 * enregistrées sur le poste ; les autres suivent la route directe (en ligne seulement), pour ne jamais dire
 * « enregistré sur ce poste » ce que la synchronisation refuserait.
 *
 * Restent en ligne seulement à ce stade : visite (P02, domaine de l'agenda), consultation et prescriptions, clôture de
 * caisse, contre-écriture, avoir, remboursement, remise, retour, mouvement de stock, rendez-vous, contact, approbations.
 */
export const SYNC_APPLICABLE_COMMANDS: ReadonlySet<string> = new Set([
  'CreatePatient',
  'UpdatePatient',
  'CreateInvoiceDraft',
  'UpdateDraft',
  'IssueInvoice',
  'RegisterPayment',
  'OpenCashSession',
  'RecordCashMovement',
])
