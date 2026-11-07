# offline

Coffre local chiffré, commandes, projections, synchronisation et reprise (fichiers 19 et 23).
Seul ce dossier accède à IndexedDB/Dexie. `projections/` (F10) contient les règles de lecture
sans stockage : états de synchronisation, fusion par identifiant, solde d'une facture vu par le
poste. Coffre et grants (O01, O02), ressources préparées (`allocations/`, O03), moteur de
commandes local, journal commun et verrou entre onglets (`LocalCommandBus.ts`, `command-journal/`,
`locks/`, O04). La synchronisation (`sync/`, O05) est écrite ; `profile-switch/` (P04) dit, d'après les seuls
compartiments du journal commun, quel profil doit s'ouvrir pour envoyer les pièces que le profil ouvert ne sait pas lire.
