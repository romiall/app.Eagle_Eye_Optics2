import type { PageHelp } from '../model'

/**
 * Fiches d’aide des écrans Communication, CRM, Réservations en ligne et Intégrations (L2).
 * Aucune promesse d’envoi sans connexion ni consentement ; les libellés cités entre « … »
 * correspondent mot pour mot aux écrans Vue correspondants.
 */
export const PAGES_COMMUNICATION: readonly PageHelp[] = [
  {
    route: 'integrations',
    title: 'Intégrations et connecteurs',
    module: 'settings',
    anyPermission: ['integration.manage'],
    purpose:
      'Configurer les comptes connecteurs externes avec chiffrement des secrets au repos, superviser la santé globale et tester la connectivité. L’écran exige une connexion serveur et la confirmation du mot de passe de la gérante.',
    actions: [
      {
        label: 'Boîte d’envoi et webhooks',
        effect: 'Ouvre le journal des événements outbox et des notifications entrantes signées.',
      },
      {
        label: 'Actualiser la santé',
        effect: 'Relit les compteurs globaux des connecteurs, outbox, webhooks et agendas.',
      },
      {
        label: 'Tester la connexion',
        effect: 'Vérifie la joignabilité du fournisseur configuré sans exposer le secret.',
      },
      {
        label: 'Modifier',
        effect:
          'Charge le compte dans le formulaire pour ajuster son statut ou remplacer son secret.',
      },
      {
        label: 'Enregistrer le compte',
        effect:
          'Chiffre les identifiants saisis et demande le mot de passe de confirmation (HTTP 423).',
      },
      {
        label: 'Mettre à jour le compte',
        effect:
          'Enregistre les modifications du compte sélectionné avec contrôle de version optimiste.',
      },
    ],
    tasks: [
      {
        id: 'integrations-add-test',
        title: 'Ajouter puis vérifier un compte connecteur',
        steps: [
          'Choisissez le fournisseur, saisissez l’identifiant externe et le nom affiché.',
          'Collez si besoin l’objet JSON des identifiants secrets ; laissez vide ensuite pour conserver le secret existant.',
          'Cliquez sur « Enregistrer le compte » puis confirmez votre mot de passe si le serveur le demande.',
          'Cliquez sur « Tester la connexion » sur la ligne créée pour contrôler la joignabilité.',
        ],
        result: 'Le compte apparaît dans la liste avec son statut et le résultat du test.',
      },
    ],
    rules: [
      'Un secret enregistré n’est jamais renvoyé en clair à l’écran : il reste chiffré côté serveur.',
      'La création ou la modification d’un connecteur exige une réauthentification récente de la gérante.',
      'Aucun envoi SMS ou WhatsApp ne fonctionne si le compte fournisseur reste désactivé.',
    ],
    terms: [],
    next: [
      {
        route: 'communication-outbox',
        label: 'Boîte d’envoi et webhooks',
        why: 'Suivre les envois sortants et les réceptions webhook des connecteurs.',
      },
      {
        route: 'communication',
        label: 'Communication et CRM',
        why: 'Accéder aux écrans métier reliés aux connecteurs.',
      },
      {
        route: 'parametres',
        label: 'Paramètres',
        why: 'Revenir à l’administration générale du cabinet.',
      },
    ],
    problems: [
      {
        symptom:
          'Le serveur demande de confirmer le mot de passe après avoir cliqué sur « Enregistrer le compte ».',
        remedy:
          'Saisissez votre mot de passe dans la boîte de confirmation : l’opération protégée reprend aussitôt avec vos saisies.',
      },
    ],
  },
  {
    route: 'communication',
    title: 'Communication et CRM',
    module: 'communication',
    anyPermission: [
      'communication.manage',
      'knowledge.manage',
      'conversation.takeover',
      'integration.manage',
      'agenda.read',
      'site.publish',
    ],
    purpose:
      'Regrouper les accès aux réservations en ligne, prospects CRM, fiches de connaissances, reprises humaines de l’assistant, consentements, campagnes et supervision technique. Chaque tuile n’apparaît qu’avec les droits requis et une connexion serveur active.',
    actions: [
      {
        label: 'Réservations en ligne & Google Agenda',
        effect: 'Ouvre la file des demandes publiques et l’état de synchronisation Google Agenda.',
        anyPermission: [
          'agenda.read',
          'agenda.write',
          'communication.manage',
          'integration.manage',
        ],
      },
      {
        label: 'Prospects, CRM Kommo & liens patients',
        effect: 'Ouvre l’annuaire des prospects administratifs et le miroir Kommo CRM.',
        anyPermission: ['communication.manage', 'integration.manage', 'patient.read'],
      },
      {
        label: 'Base de connaissances gouvernée',
        effect: 'Ouvre la gestion des fiches informatives approuvées et publiées.',
        anyPermission: ['communication.manage', 'knowledge.manage'],
      },
      {
        label: 'Assistant borné & reprises humaines',
        effect: 'Ouvre la console de test borné, refus cliniques et bascules vers conseiller.',
        anyPermission: ['communication.manage', 'conversation.takeover'],
      },
      {
        label: 'Consentements, modèles & relances',
        effect: 'Ouvre le registre opt-in / opt-out, les modèles et les tentatives d’envoi.',
        anyPermission: ['communication.manage'],
      },
      {
        label: 'Segments & campagnes',
        effect:
          'Ouvre la segmentation administrative, les prévisualisations et le gel de campagne.',
        anyPermission: ['communication.manage'],
      },
      {
        label: 'Site public : showroom & contenus',
        effect: 'Ouvre la préparation des fiches de montures et des textes du site, à publier.',
        anyPermission: ['site.publish'],
      },
      {
        label: 'Boîte d’envoi & webhooks',
        effect: 'Ouvre le suivi outbox, les webhooks reçus et le rattrapage global.',
        anyPermission: ['integration.manage'],
      },
      {
        label: 'Intégrations et connecteurs',
        effect: 'Ouvre la configuration des connecteurs chiffrés.',
        anyPermission: ['integration.manage'],
      },
    ],
    tasks: [],
    rules: [
      'L’ensemble du module Communication exige une connexion active au serveur.',
      'Aucun envoi SMS ou WhatsApp ne part sans consentement accordé et modèle approuvé.',
    ],
    terms: [],
    next: [
      { route: 'agenda', label: 'Agenda', why: 'Consulter le planning des rendez-vous confirmés.' },
      { route: 'suivis', label: 'Suivis et relances', why: 'Voir les tâches de suivi ouvertes.' },
      { route: 'patients', label: 'Patients', why: 'Consulter ou créer les dossiers patients.' },
    ],
  },
  {
    route: 'communication-bookings',
    title: 'Réservations publiques & Google Agenda',
    module: 'communication',
    anyPermission: ['agenda.read', 'agenda.write', 'communication.manage', 'integration.manage'],
    purpose:
      'Traiter les demandes de rendez-vous soumises sur le portail public, les confirmer ou les refuser dans l’agenda du cabinet et piloter la synchronisation Google Agenda. L’écran exige une connexion serveur pour éviter tout conflit d’horaire.',
    actions: [
      {
        label: 'Actualiser la boîte',
        effect: 'Recharge les demandes publiques reçues et l’état des agendas.',
      },
      {
        label: 'Confirmer',
        effect: 'Transforme la demande publique en rendez-vous confirmé sur la ressource choisie.',
      },
      {
        label: 'Refuser',
        effect: 'Clôture la demande publique comme refusée sans créer de rendez-vous.',
      },
      {
        label: 'Synchroniser Google Agenda',
        effect: 'Déclenche une synchronisation incrémentale ou complète des agendas associés.',
      },
      {
        label: 'Associer l’agenda Google',
        effect: 'Relie une ressource réservable du cabinet à un calendrier Google externe.',
      },
    ],
    tasks: [
      {
        id: 'bookings-validate',
        title: 'Valider une demande publique de rendez-vous',
        steps: [
          'Filtrez la boîte sur le statut souhaité (« À confirmer » ou « Reçue »).',
          'Vérifiez ou sélectionnez la ressource d’affectation et saisissez un motif administratif si utile.',
          'Cliquez sur « Confirmer » pour créer le rendez-vous ou « Refuser » pour décliner.',
        ],
        result:
          'La demande change de statut et un rendez-vous confirmé apparaît à l’agenda si acceptée.',
      },
    ],
    rules: [
      'Une demande publique ne crée jamais de dossier clinique automatiquement.',
      'Le créneau est revérifié sous verrou lors de la confirmation pour empêcher les doubles réservations.',
    ],
    terms: [],
    next: [
      { route: 'agenda', label: 'Agenda', why: 'Visualiser le créneau confirmé sur le planning.' },
      {
        route: 'communication-crm',
        label: 'Prospects et CRM',
        why: 'Compléter le suivi administratif du prospect.',
      },
      {
        route: 'communication',
        label: 'Communication et CRM',
        why: 'Revenir au hub Communication.',
      },
    ],
  },
  {
    route: 'communication-crm',
    title: 'Prospects, CRM Kommo et liens patients',
    module: 'communication',
    anyPermission: ['communication.manage', 'integration.manage', 'patient.read'],
    purpose:
      'Gérer les contacts prospects de façon strictement administrative, rattacher explicitement un prospect à un dossier patient existant et synchroniser les pistes Kommo CRM. L’écran nécessite une connexion active.',
    actions: [
      {
        label: 'Rechercher',
        effect: 'Filtre les prospects par nom, téléphone ou adresse électronique.',
      },
      {
        label: 'Enregistrer le prospect',
        effect: 'Crée un contact prospect administratif sans ouvrir de dossier médical.',
      },
      {
        label: 'Rattacher un patient',
        effect: 'Ouvre la sélection d’un dossier patient existant à associer au prospect.',
      },
      {
        label: 'Valider le rattachement',
        effect: 'Enregistre le lien vérifié entre le prospect et le dossier patient choisi.',
      },
      {
        label: 'Synchroniser Kommo CRM',
        effect: 'Met à jour le miroir local des pistes commerciales depuis Kommo.',
      },
      {
        label: 'Ouvrir la console assistant',
        effect: 'Bascule vers le suivi détaillé des conversations et transferts humains.',
      },
    ],
    tasks: [
      {
        id: 'crm-link-patient',
        title: 'Rattacher un prospect à un patient existant',
        steps: [
          'Recherchez le prospect dans l’annuaire puis cliquez sur « Rattacher un patient ».',
          'Recherchez le dossier patient existant ou saisissez son identifiant ULID.',
          'Cliquez sur « Valider le rattachement » pour conserver le lien administratif.',
        ],
        result: 'Le prospect affiche l’identifiant du dossier patient lié.',
      },
    ],
    rules: [
      'La création d’un prospect n’ouvre jamais de dossier clinique dans l’application.',
      'Aucune donnée médicale n’est envoyée vers Kommo CRM ni stockée dans les notes de piste.',
    ],
    terms: [],
    next: [
      {
        route: 'communication-handoffs',
        label: 'Assistant et reprises humaines',
        why: 'Inspecter les conversations associées.',
      },
      { route: 'patients', label: 'Patients', why: 'Consulter la liste des dossiers patients.' },
      {
        route: 'communication',
        label: 'Communication et CRM',
        why: 'Revenir au hub Communication.',
      },
    ],
  },
  {
    route: 'communication-knowledge',
    title: 'Base de connaissances gouvernée',
    module: 'communication',
    anyPermission: ['communication.manage', 'knowledge.manage'],
    purpose:
      'Rédiger les fiches d’information du cabinet, faire approuver chaque révision brouillon puis publier la version active unique consultée par l’assistant. L’écran nécessite une connexion au serveur.',
    actions: [
      {
        label: 'Créer la fiche et sa révision 1',
        effect: 'Enregistre une nouvelle fiche et sa première révision au statut brouillon.',
      },
      {
        label: 'Ajouter une révision',
        effect:
          'Prépare une nouvelle version brouillon d’une fiche existante sans toucher à la version publiée.',
      },
      {
        label: 'Approuver la révision',
        effect: 'Valide le contenu d’une révision brouillon avant sa publication.',
      },
      {
        label: 'Publier cette révision',
        effect:
          'Active cette révision comme unique source publiée pour l’assistant et retire la précédente.',
      },
    ],
    tasks: [
      {
        id: 'knowledge-publish',
        title: 'Publier une nouvelle révision de connaissance',
        steps: [
          'Créez une fiche ou cliquez sur « Ajouter une révision » pour enregistrer un brouillon.',
          'Cliquez sur « Approuver la révision » après relecture managériale.',
          'Cliquez sur « Publier cette révision » pour la rendre active.',
        ],
        result: 'La révision passe au statut publiée active pour l’assistant borné.',
      },
    ],
    rules: [
      'Une seule révision publiée peut être active à la fois pour une même fiche.',
      'Les révisions non publiées ne sont jamais citées par l’assistant borné.',
    ],
    terms: [],
    next: [
      {
        route: 'communication-handoffs',
        label: 'Assistant et reprises humaines',
        why: 'Tester l’assistant sur les fiches publiées.',
      },
      {
        route: 'communication',
        label: 'Communication et CRM',
        why: 'Revenir au hub Communication.',
      },
    ],
  },
  {
    route: 'communication-handoffs',
    title: 'Assistant borné et reprises humaines',
    module: 'communication',
    anyPermission: ['communication.manage', 'conversation.takeover'],
    purpose:
      'Inspecter les conversations omnicanales, tester un tour borné de l’assistant sur la base publiée et basculer ou reprendre la main entre conseiller humain et assistant. L’écran exige une connexion serveur.',
    actions: [
      {
        label: 'Inspecter',
        effect:
          'Charge le détail de la conversation, ses exécutions auditées et l’historique des transferts.',
      },
      {
        label: 'Exécuter un tour d’assistant',
        effect:
          'Soumet un message à l’assistant borné et affiche la réponse, les sources et d’éventuels refus cliniques.',
      },
      {
        label: 'Basculer vers un conseiller humain',
        effect:
          'Passe la conversation en prise en charge humaine avec motif et résumé administratif.',
      },
      {
        label: 'Rendre la main à l’assistant',
        effect: 'Réactive le traitement automatisé borné après l’intervention d’un conseiller.',
      },
    ],
    tasks: [
      {
        id: 'handoffs-takeover',
        title: 'Prendre le relais humain sur une conversation',
        steps: [
          'Sélectionnez la conversation avec « Inspecter ».',
          'Saisissez le motif du transfert et un résumé purement administratif.',
          'Cliquez sur « Basculer vers un conseiller humain » pour interrompre l’assistant.',
        ],
        result:
          'La conversation passe en mode relais humain et consigne l’événement dans l’historique.',
      },
    ],
    rules: [
      'Toute question clinique déclenche un refus automatique explicite sans avis médical.',
      'Chaque tour d’assistant est audité avec les versions de connaissances et résultats d’outils assainis.',
    ],
    terms: [],
    next: [
      {
        route: 'communication-knowledge',
        label: 'Base de connaissances',
        why: 'Mettre à jour les fiches citées par l’assistant.',
      },
      {
        route: 'communication-crm',
        label: 'Prospects et CRM',
        why: 'Rattacher le prospect ou consulter les pistes Kommo.',
      },
    ],
  },
  {
    route: 'communication-consents',
    title: 'Consentements, modèles et relances',
    module: 'communication',
    anyPermission: ['communication.manage'],
    purpose:
      'Tenir le registre immuable des accords et révocations de contact, approuver les modèles par canal, paramétrer les politiques de relance et auditer les tentatives d’envoi. L’écran requiert une connexion serveur active.',
    actions: [
      {
        label: 'Enregistrer l’opt-in',
        effect:
          'Ajoute un accord vérifiable pour le patient ou prospect, le canal et la finalité saisis.',
      },
      {
        label: 'Révoquer immédiatement (opt-out)',
        effect:
          'Enregistre une révocation immuable bloquant immédiatement tout futur envoi sur ce couple canal/finalité.',
      },
      {
        label: 'Créer le modèle',
        effect: 'Enregistre un nouveau code de modèle par canal et finalité.',
      },
      {
        label: 'Nouvelle révision',
        effect: 'Prépare une nouvelle version de texte à soumettre à approbation.',
      },
      {
        label: 'Approuver le modèle',
        effect:
          'Valide une révision de modèle afin qu’elle devienne utilisable pour les relances ou campagnes.',
      },
      {
        label: 'Enregistrer la politique',
        effect: 'Crée une règle horodatée de rappel ou de relance.',
      },
      {
        label: 'Envoyer le message transactionnel',
        effect:
          'Déclenche un envoi dédupliqué pour une tâche de contact après contrôle du consentement.',
      },
      {
        label: 'Rapprocher le statut',
        effect: 'Actualise le statut de remise d’une tentative auprès du fournisseur.',
      },
    ],
    tasks: [
      {
        id: 'consents-record',
        title: 'Consigner un opt-in ou une révocation',
        steps: [
          'Identifiez exactement un patient ou un prospect, puis choisissez le canal et la finalité.',
          'Indiquez la destination exacte et la preuve vérifiable.',
          'Cliquez sur « Enregistrer l’opt-in » ou « Révoquer immédiatement (opt-out) ».',
        ],
        result: 'Une nouvelle séquence immuable est ajoutée au registre des consentements.',
      },
    ],
    rules: [
      'Aucun envoi SMS, WhatsApp ou courriel ne part sans opt-in actif et non révoqué.',
      'Le registre des consentements est immuable : toute modification ajoute une nouvelle séquence.',
    ],
    terms: [],
    next: [
      {
        route: 'communication-campaigns',
        label: 'Segments et campagnes',
        why: 'Utiliser les modèles approuvés dans une campagne.',
      },
      { route: 'suivis', label: 'Suivis et relances', why: 'Consulter les tâches de relance.' },
      {
        route: 'communication',
        label: 'Communication et CRM',
        why: 'Revenir au hub Communication.',
      },
    ],
  },
  {
    route: 'communication-campaigns',
    title: 'Segments d’audience et campagnes',
    module: 'communication',
    anyPermission: ['communication.manage'],
    purpose:
      'Construire des segments sur critères strictement administratifs, prévisualiser les admissibles et exclusions opt-out, demander l’autorisation d’envoi puis geler et exécuter par lots. L’écran exige une connexion serveur.',
    actions: [
      {
        label: 'Enregistrer le segment',
        effect: 'Crée ou met à jour un segment d’audience sans aucun critère médical.',
      },
      {
        label: 'Créer la campagne brouillon',
        effect:
          'Associe un segment et une révision de modèle approuvée dans un brouillon de campagne.',
      },
      {
        label: 'Piloter',
        effect:
          'Ouvre les commandes de prévisualisation, approbation, gel et exécution de la campagne.',
      },
      {
        label: 'Prévisualiser l’audience',
        effect: 'Calcule le nombre de destinataires admissibles et de contacts exclus par opt-out.',
      },
      {
        label: 'Demander l’autorisation d’envoi',
        effect: 'Soumet une demande d’approbation exacte de campagne pour décision managériale.',
      },
      {
        label: 'Geler la campagne',
        effect: 'Fige la liste des destinataires et approuve l’envoi avant l’exécution par lots.',
      },
      {
        label: 'Exécuter un lot d’envoi',
        effect: 'Transmet un lot de messages pour les seuls destinataires admissibles.',
      },
      {
        label: 'Suspendre la campagne',
        effect: 'Interrompt une campagne active ou en cours.',
      },
    ],
    tasks: [
      {
        id: 'campaigns-freeze',
        title: 'Préparer et geler une campagne autorisée',
        steps: [
          'Créez un segment administratif puis une campagne avec un modèle approuvé.',
          'Cliquez sur « Piloter » puis sur « Prévisualiser l’audience » pour vérifier les exclusions.',
          'Utilisez « Demander l’autorisation d’envoi », puis cliquez sur « Geler la campagne ».',
        ],
        result: 'Les destinataires éligibles et exclusions sont figés avant l’exécution par lots.',
      },
    ],
    rules: [
      'Aucun critère clinique (diagnostic, pathologie, prescription) n’est admis dans un segment.',
      'Aucun message SMS ou WhatsApp de campagne ne part vers un contact exclu ou sans opt-in marketing.',
    ],
    terms: [],
    next: [
      {
        route: 'communication-consents',
        label: 'Consentements et modèles',
        why: 'Gérer les opt-in/opt-out et modèles.',
      },
      {
        route: 'approbations',
        label: 'Approbations',
        why: 'Suivre ou décider les demandes d’envoi CAMPAIGN_SEND.',
      },
      {
        route: 'communication',
        label: 'Communication et CRM',
        why: 'Revenir au hub Communication.',
      },
    ],
  },
  {
    route: 'communication-outbox',
    title: 'Boîte d’envoi et webhooks',
    module: 'communication',
    anyPermission: ['integration.manage'],
    purpose:
      'Suivre la boîte d’envoi des événements métier, contrôler le journal des webhooks signés et déclencher manuellement un lot ou un rattrapage global des intégrations. L’écran nécessite une connexion serveur.',
    actions: [
      {
        label: 'Traiter un lot outbox',
        effect: 'Exécute le traitement d’un lot borné d’événements en attente ou à reprendre.',
      },
      {
        label: 'Lancer le rattrapage global',
        effect: 'Exécute en cascade le traitement outbox, webhooks, statuts d’envoi et agendas.',
      },
      {
        label: 'Configurer les connecteurs',
        effect: 'Ouvre l’écran des comptes connecteurs chiffrés.',
      },
    ],
    tasks: [],
    rules: [
      'Les webhooks entrants ne sont traités qu’après vérification de leur signature et déduplication.',
    ],
    terms: [],
    next: [
      {
        route: 'integrations',
        label: 'Intégrations et connecteurs',
        why: 'Ajuster les connecteurs si un test échoue.',
      },
      {
        route: 'communication',
        label: 'Communication et CRM',
        why: 'Revenir au hub Communication.',
      },
    ],
  },
  {
    route: 'communication-site',
    title: 'Site public : showroom et contenus',
    module: 'communication',
    anyPermission: ['site.publish'],
    purpose:
      'Décrire les montures que le public peut voir et rédiger les textes du site (accueil, horaires, contact…). Écrire enregistre un brouillon : rien ne sort sur le site tant que vous ne l’avez pas publié, avec votre mot de passe.',
    actions: [
      {
        label: 'Enregistrer la fiche en brouillon',
        effect: 'Crée la fiche d’une monture du catalogue ; elle reste invisible du public.',
      },
      {
        label: 'Enregistrer les modifications',
        effect: 'Modifie la fiche choisie et la remet en brouillon.',
      },
      {
        label: 'Modifier la fiche',
        effect: 'Charge la fiche dans le formulaire pour la corriger.',
      },
      {
        label: 'Déposer l’image',
        effect: 'Ajoute une photo à la fiche, avec son texte alternatif et sa note de droits.',
      },
      {
        label: 'Retirer l’image',
        effect: 'Détache la photo de la fiche.',
      },
      {
        label: 'Appliquer',
        effect:
          'Publie, retire du site ou archive la fiche selon la décision choisie, après confirmation de votre mot de passe.',
      },
      {
        label: 'Enregistrer le brouillon',
        effect: 'Garde le texte d’un contenu en brouillon, sans le montrer au public.',
      },
      {
        label: 'Publier le brouillon',
        effect: 'Rend le texte visible du public et archive la version précédente.',
      },
      {
        label: 'Retirer du site',
        effect: 'Archive le contenu publié : le public ne le voit plus.',
      },
    ],
    tasks: [
      {
        id: 'site-publier-fiche',
        title: 'Publier une monture sur le site',
        steps: [
          'Dans « Nouvelle fiche », choisissez l’article du catalogue, puis saisissez le titre et la description publics.',
          'Cliquez sur « Enregistrer la fiche en brouillon ».',
          'Sur la fiche créée, ajoutez une photo avec « Déposer l’image » : le texte alternatif et la note de droits sont obligatoires.',
          'Choisissez « Publier sur le site » dans la liste « Décision », puis cliquez sur « Appliquer ».',
          'Confirmez votre mot de passe.',
        ],
        result: 'La fiche est publiée : le public la voit sur le site.',
      },
      {
        id: 'site-publier-contenu',
        title: 'Publier un texte du site',
        steps: [
          'Repérez le contenu voulu dans « Contenus du site » (accueil, horaires, contact…).',
          'Modifiez le titre et le texte, puis cliquez sur « Enregistrer le brouillon ».',
          'Relisez, cliquez sur « Publier le brouillon » et confirmez votre mot de passe.',
        ],
        result: 'Le nouveau texte est public ; l’ancienne version est archivée.',
      },
    ],
    rules: [
      'Seul ce qui est publié sort de l’application : jamais de coût d’achat, de quantité en stock ni de donnée de patient.',
      'Une fiche ne peut être publiée que si son article est actif et coché « Visible sur le site public » dans le catalogue.',
      'Modifier une fiche publiée la remet en brouillon : publiez-la de nouveau après relecture.',
      'Chaque photo porte un texte alternatif et une note de droits : sans eux, elle n’est pas acceptée.',
      'Publier, retirer ou archiver demande votre mot de passe à chaque décision.',
    ],
    terms: [],
    next: [
      {
        route: 'catalogue',
        label: 'Catalogue',
        why: 'Cocher la visibilité publique d’un article avant d’écrire sa fiche.',
      },
      {
        route: 'communication-bookings',
        label: 'Réservations publiques & Google Agenda',
        why: 'Traiter les demandes de rendez-vous reçues depuis le site.',
      },
      {
        route: 'communication',
        label: 'Communication et CRM',
        why: 'Revenir au hub Communication.',
      },
    ],
    tips: [
      'Le numéro WhatsApp du site n’est qu’un lien : l’application n’envoie aucun message à ce numéro. Écrivez-le en chiffres, avec l’indicatif.',
    ],
    problems: [
      {
        symptom: 'La fiche ne se publie pas : son article n’est plus actif ou plus visible.',
        remedy:
          'Dans le catalogue, réactivez l’article et cochez « Visible sur le site public », puis publiez de nouveau.',
      },
      {
        symptom: 'Une photo est refusée.',
        remedy:
          'Utilisez une image JPEG, PNG ou WebP de 3 Mo au plus, avec son texte alternatif et sa note de droits.',
      },
      {
        symptom: 'Un message dit que la fiche a changé.',
        remedy:
          'Quelqu’un l’a modifiée entre-temps : l’écran se relit. Vérifiez la fiche, puis recommencez.',
      },
    ],
  },
]
