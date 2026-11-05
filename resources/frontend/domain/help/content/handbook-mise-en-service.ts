import type { HandbookTopic } from '../model'

/**
 * Documentation globale, partie « Mise en service » : avant l’installation, première configuration,
 * répétition générale et exploitation. Réservée à la gérante (droit de gérer le personnel).
 */
export const TOPICS_MISE_EN_SERVICE: readonly HandbookTopic[] = [
  {
    id: 'avant-installation',
    title: 'Avant l’installation : ce qu’il faut réunir',
    summary:
      'Ce que le cabinet doit fournir avant l’ouverture, ce qui empêche d’ouvrir et ce qui peut avancer avec des données fictives.',
    module: null,
    anyPermission: ['users.manage'],
    audience: ['MANAGER'],
    intro:
      'L’application n’invente rien : ni taxe, ni prix, ni identité légale, ni série de numéros. Tout est saisi ou choisi par la gérante, ou par le prestataire qui installe et entretient l’application (certains messages l’appellent l’exploitant), à partir de ce que le cabinet fournit.',
    blocks: [
      {
        kind: 'table',
        title: 'À obtenir du cabinet',
        head: ['Information', 'Où elle sert', 'Nécessaire avant l’ouverture ?'],
        rows: [
          [
            'Identité du cabinet : dénomination exacte, capital, objet de l’activité, adresse, téléphone, adresse électronique',
            '« Cabinet et documents »',
            'Oui, pour les documents officiels',
          ],
          [
            'Références légales : immatriculation, identifiant fiscal, mentions professionnelles, logo validé',
            '« Cabinet et documents » ; le logo n’a pas d’écran de réglage',
            'Oui, pour les documents officiels',
          ],
          [
            'Régime fiscal et taxes, validés avec le comptable',
            '« Règles fiscales »',
            'Oui : sans règle validée, les factures portent « aucune taxe configurée »',
          ],
          [
            'Préfixe de chaque série de numéros : factures, reçus, avoirs, remboursements, créances reprises, devis',
            'Réglage du prestataire ; un numéro émis ne change plus',
            'Oui, avant la première pièce réelle',
          ],
          [
            'Catalogue et prix : articles, unité (paire ou unité), prix de vente TTC, article des frais d’examen',
            '« Catalogue »',
            'Oui, avant les ventes réelles',
          ],
          [
            'Stock d’ouverture : comptage par article et emplacement, lot et expiration des collyres',
            '« Stock », section « Stock initial »',
            'Oui, avant de vendre un article géré en stock',
          ],
          [
            'Personnel et profils : qui est gérante, accueil, professionnel ou caissière ; qui encaisse l’examen à l’accueil ; qui autorise remises et remboursements',
            '« Personnel »',
            'Oui, avant de remettre les accès',
          ],
          [
            'Contrôle du paiement de l’examen : l’examen attend-il l’encaissement des frais ?',
            'Réglage du prestataire',
            'À décider ; par défaut, l’écran dit « Paiement de l’examen non contrôlé »',
          ],
          [
            'Mesures de l’examen : échelle d’acuité visuelle réelle, convention du cylindre, tolérance de l’écart pupillaire',
            'Saisie de l’examen ; le prestataire crée l’échelle',
            'Oui, avant les examens',
          ],
          [
            'Agenda : horaires, jours fériés, dimanche, durée de chaque rendez-vous, professionnels et salles',
            '« Configuration de l’agenda »',
            'Non, seulement avant d’ouvrir l’agenda',
          ],
          [
            'Dettes et commandes en cours notées au carnet papier',
            '« Créances papier »',
            'Oui, s’il y en a',
          ],
        ],
      },
      {
        kind: 'points',
        title: 'À prévoir sur place',
        items: [
          'Postes : un navigateur à jour, une imprimante essayée avec chaque document (tout s’imprime depuis le lecteur PDF du navigateur) et une connexion Internet fiable. Le travail sans Internet n’est pas encore disponible.',
          'Bascule : le jour et l’heure où l’application devient le registre de référence, le dernier numéro du carnet papier, le stock compté et la liste certifiée des dettes.',
          'Sauvegarde et assistance : où se range la copie hors du serveur, qui la tient avec sa clé de chiffrement, et qui appeler en cas de panne, sous quel délai.',
        ],
      },
      {
        kind: 'points',
        title: 'Ce qui peut avancer avec des données fictives',
        items: [
          'Former le personnel et répéter les parcours sur des patients et des articles inventés.',
          'Essayer chaque document : tant que les mentions ne sont pas validées, il porte « DOCUMENT DE TEST ».',
          'Régler l’agenda provisoirement, et faire essayer un export et une restauration de sauvegarde.',
        ],
      },
      {
        kind: 'note',
        tone: 'warning',
        text: 'Ne saisissez jamais de valeur provisoire à la place d’une information manquante (taux de taxe, prix, numéro, identité légale) : une facture émise ne se modifie plus et son numéro n’est jamais réutilisé.',
      },
    ],
    related: [
      { topic: 'premiere-configuration', label: 'Première configuration : l’ordre à suivre' },
      { topic: 'repetition-generale', label: 'Répétition générale avant l’ouverture' },
      { topic: 'exploitation', label: 'Exploitation : au quotidien et en cas de problème' },
      { topic: 'notion-modules', label: 'Les modules et leur ouverture' },
      { topic: 'profils', label: 'Les profils et leurs droits' },
      { topic: 'guide-gerante', label: 'Guide de la gérante' },
    ],
    keywords: [
      'préparer l’installation',
      'documents à fournir',
      'informations à demander',
      'liste de contrôle',
      'prérequis',
      'mentions légales',
      'logo',
      'taxes',
      'comptable',
      'séries de numéros',
      'préfixes',
      'catalogue',
      'prix',
      'bascule',
    ],
  },
  {
    id: 'premiere-configuration',
    title: 'Première configuration : l’ordre à suivre',
    summary:
      'Les réglages à faire, dans l’ordre où ils dépendent les uns des autres, avec l’écran de chacun.',
    module: null,
    anyPermission: ['users.manage'],
    audience: ['MANAGER'],
    intro:
      'Chaque étape s’appuie sur la précédente : un article a besoin de sa règle fiscale, un stock d’ouverture a besoin de son article. Sautez une étape dont l’information manque encore : elle se fera plus tard.',
    blocks: [
      {
        kind: 'steps',
        title: 'Dans cet ordre',
        items: [
          'Connectez-vous avec le compte de la gérante. Si le prestataire a choisi son mot de passe, changez-le : « Changer mon mot de passe », sur l’accueil.',
          'Cabinet : « Paramètres », « Cabinet et documents ». Saisissez « Nom du cabinet », « Adresse », « Téléphone », « Adresse électronique », « Identifiant fiscal » et « Mentions professionnelles », puis « Enregistrer les paramètres ».',
          'Comptes : « Paramètres », « Personnel », « Créer un compte ». Un compte par personne, jamais partagé, avec ses « Profils » et un « Mot de passe initial » remis en personne. Un droit particulier s’ajoute par « Dérogation de droit ».',
          'Taxes : « Ventes et caisse », « Règles fiscales », « Nouvelle règle ». Saisissez le « Taux, en % » donné par le comptable, validez et activez la règle. Sans règle validée, les factures portent « aucune taxe configurée ».',
          'Catalogue : « Ventes et caisse », « Catalogue ». Créez chaque article avec « Nouvel article », ou importez un fichier avec « Importer un fichier CSV » (toutes les lignes, ou aucune). Choisissez sa « Règle fiscale », et créez l’article des frais d’examen.',
          'Stock : « Ventes et caisse », « Stock », section « Stock initial ». Ajoutez une ligne par article et emplacement, puis « Enregistrer le stock initial ». Une seule fois par article et emplacement ; un collyre exige son lot et sa date d’expiration.',
          'Caisse : « Ventes et caisse », « Caisse ». Le prestataire crée la caisse principale ; chaque caissière l’ouvre avec « Ouvrir la caisse » et son « Fond de caisse ». Le lien « Catégories de dépenses » apparaît dans la session ouverte de la gérante.',
          'Agenda : « Agenda », « Configuration ». « Nouvelle ressource » pour chaque professionnel ou salle, ses « Horaires », sa « Fermeture exceptionnelle » pour un jour férié, puis « Nouvelle prestation » avec sa durée.',
          'Créances papier, s’il en reste : « Catalogue », « Importer un fichier CSV », section « Créances papier ». Seul le reste dû est repris.',
          'Exports : « Paramètres », « Exports ». Faites un premier export pour vérifier que vous savez le télécharger. Le prestataire fait les sauvegardes et leur essai de restauration.',
        ],
      },
      {
        kind: 'table',
        title: 'Ce que le prestataire ouvre, un écran à la fois, après une courte formation',
        head: ['Ce qui s’ouvre', 'Quand'],
        rows: [
          [
            '« Paramètres », « Patients » et « Aujourd’hui »',
            'En premier : la gérante règle le cabinet et crée les comptes',
          ],
          ['« Consultations »', 'Une fois l’échelle d’acuité réelle créée par le prestataire'],
          [
            '« Ventes et caisse »',
            'Une fois la caisse principale créée par le prestataire ; la gérante saisit ensuite catalogue, prix et taxes',
          ],
          ['« Stock »', 'Quand la gérante est prête à saisir le stock d’ouverture'],
          ['« Statistiques »', 'Avec les écrans précédents'],
          ['« Agenda »', 'Après une courte formation'],
          ['Les postes hors ligne (pas encore disponibles)', 'Ce module reste fermé'],
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Un écran absent du menu n’est pas ouvert, ou le compte n’en a pas le droit. Seul le prestataire ouvre les écrans : rien ne s’ouvre depuis « Paramètres ».',
      },
      {
        kind: 'note',
        tone: 'warning',
        text: 'Plusieurs réglages redemandent votre mot de passe (« Confirmer votre mot de passe ») ; la saisie est conservée et reprend ensuite. Les documents portent « DOCUMENT DE TEST » tant que le prestataire n’a pas activé les documents officiels, une fois les mentions, le logo et le régime fiscal validés.',
      },
    ],
    related: [
      { route: 'parametres-cabinet', label: 'Cabinet et documents' },
      { route: 'parametres-personnel', label: 'Personnel' },
      { route: 'taxes', label: 'Règles fiscales', why: 'À saisir avant le catalogue.' },
      { route: 'stock', label: 'Stock', why: 'Pour le stock d’ouverture.' },
      { route: 'categories-depenses', label: 'Catégories de dépenses' },
      { route: 'agenda-configuration', label: 'Configuration de l’agenda' },
    ],
    keywords: [
      'configurer',
      'réglages',
      'mise en route',
      'paramétrage',
      'démarrage',
      'ordre',
      'stock initial',
      'ouvrir un écran',
      'modules',
      'créances',
    ],
  },
  {
    id: 'repetition-generale',
    title: 'Répétition générale avant l’ouverture',
    summary:
      'Rejouer avec la gérante les gestes d’une vraie journée sur des patients fictifs, en sachant ce que chaque écran doit montrer.',
    module: null,
    anyPermission: ['users.manage'],
    audience: ['MANAGER'],
    intro:
      'Rejouez les gestes d’une vraie journée. Un geste est réussi quand l’écran montre ce qui est écrit dans la dernière colonne. Les repères AT renvoient au plan d’essai du prestataire.',
    blocks: [
      {
        kind: 'steps',
        title: 'Avant de commencer',
        items: [
          'Décidez avec le prestataire où répéter : tout ce qui est enregistré reste (fiches, numéros, factures émises). Une installation d’essai, ou une remise au propre avant l’ouverture, évite de mêler l’essai au réel.',
          'Préparez un jeu fictif : un compte par profil, des patients aux noms inventés, un catalogue d’essai (examen 5 000, monture 30 000 en stock 1, paire de verres 50 000, collyre 4 000 FCFA).',
          'Pour chaque ligne du tableau, faites les gestes, comparez avec la dernière colonne, puis notez que c’est conforme ou l’écart constaté, avec une capture d’écran.',
          'Quand chaque ligne est conforme, la gérante signe le compte rendu d’essai avec le prestataire.',
        ],
      },
      {
        kind: 'table',
        title: 'Les gestes à répéter',
        head: ['Parcours', 'Gestes à faire', 'On doit voir'],
        rows: [
          [
            'Comptes et droits (AT01, AT02)',
            'Créez un compte par profil, connectez-vous avec chacun, désactivez un compte d’essai (« Compte actif »), puis essayez un écran réservé.',
            'Chacun ne voit que ses écrans ; « Accès refusé » sur un écran réservé ; le compte désactivé ne se connecte plus.',
          ],
          [
            'Patients (AT03, AT04)',
            'Avec « Nouveau patient », créez deux patients, un homonyme, deux patients au même téléphone, un sans date de naissance, un avec une date future.',
            'Un numéro de dossier par fiche ; « Des fiches ressemblent à ce patient », sans fusion ; téléphone partagé accepté ; date future refusée ; raison demandée sans date.',
          ],
          [
            'Arrivée (AT05, AT06)',
            'Cliquez sur « Enregistrer une arrivée » pour un « Examen de vue », puis pour un « Achat direct ». Lisez l’encadré de « Aujourd’hui ».',
            'Deux visites dans la file du jour ; aucun examen pour l’achat ; l’encadré dit si le paiement de l’examen est contrôlé.',
          ],
          [
            'Examen (AT18 à AT21)',
            'Cliquez sur « Démarrer l’examen », remplissez les sept étapes en laissant des champs vides et en saisissant un 0, « Terminer l’examen », puis « Corriger l’examen » avec un motif.',
            'Un champ vide et un 0 restent distincts ; l’examen terminé est en lecture seule ; la correction ajoute une révision, l’ancienne reste lisible dans « Révisions et comparaison ».',
          ],
          [
            'Facture (AT07, AT08)',
            'Cliquez sur « Créer une facture » : monture 30 000 et paire de verres 50 000 FCFA, « Enregistrer le brouillon », « Émettre la facture ». Changez ensuite un prix au catalogue. Avec la caisse, essayez une remise.',
            'Un numéro de facture (préfixe de test tant que les séries ne sont pas choisies) ; la facture garde ses lignes et son prix ; la remise donne « Prix ou remise au-delà de vos droits », puis « Demander une autorisation ».',
          ],
          [
            'Acompte et reste (AT10, AT11)',
            'Sur cette facture de 80 000 FCFA : « Montant encaissé » 30 000, « Mode de règlement », puis « Encaisser » en double clic. Plus tard : « Nouvel encaissement », « Encaisser le reste ».',
            'Un seul reçu malgré le double clic ; « Reste à encaisser » 50 000 puis 0 FCFA ; deux reçus sur la même facture, le premier marqué « Acompte » ; aucune nouvelle vente.',
          ],
          [
            'Remise de l’article (AT15 à AT17)',
            'Sur la facture, section « Remise au patient » : « Remettre au patient », « Confirmer la remise ». Refaites l’essai avec un reste à encaisser. Facturez deux fois le dernier exemplaire d’un article.',
            '« Réservé » monte à l’émission, « Physique » baisse à la remise (écran « Stock ») ; avec un reste, la caisse ne peut que « Demander l’autorisation de remise » ; la seconde facture est refusée (« Stock insuffisant »).',
          ],
          [
            'Caisse et clôture (AT25)',
            'Cliquez sur « Ouvrir la caisse » avec un « Fond de caisse » de 10 000 FCFA, encaissez en espèces et en mobile money, puis « Clôturer la caisse » avec un « Montant compté dans le tiroir » faux de 500 FCFA.',
            'Seules les espèces augmentent « Espèces attendues dans le tiroir » ; l’écart exige un « Motif de l’écart » ; « Session de caisse clôturée » est figée ; sans session, les espèces sont refusées (« Caisse non ouverte »).',
          ],
          [
            'Correction (AT13, AT14)',
            'Gérante : « Contre-passer le paiement » avec un motif, « Émettre un avoir » partiel, puis « Rembourser ». Caisse : le bouton devient « Demander l’autorisation ».',
            '« Correction enregistrée » ; paiement, reçu et facture restent tels qu’émis ; l’avoir et le remboursement ont leur numéro ; aucun bouton ne supprime un paiement.',
          ],
          [
            'Export et restauration (AT27)',
            '« Exports » : « Demander l’export », « Télécharger l’archive ». Le prestataire restaure la dernière sauvegarde sur une base à part.',
            'L’archive s’ouvre dans un tableur avec son dictionnaire ; après restauration, la dernière facture, son reçu et les numéros sont retrouvés ; la durée est notée.',
          ],
        ],
      },
      {
        kind: 'points',
        title: 'À essayer aussi',
        items: [
          'Journée de gestion (AT24, AT25) : encaissez aujourd’hui le reste d’une facture émise un autre jour, puis ouvrez « Caisse du jour » : le montant entre dans « Total net encaissé » sans compter comme une vente du jour.',
          'Créance papier (AT26), si le cabinet en a : « Créances papier », pièce de 80 000 FCFA dont 30 000 déjà réglés ; « Reste dû repris » de 50 000 FCFA, puis 30 000 après 20 000 encaissés.',
          'Petits écrans (AT28, AT29) : un téléphone, le clavier seul, puis le zoom à 200 % ; rien n’est coupé et l’identité du patient n’est jamais ressaisie.',
        ],
      },
      {
        kind: 'note',
        tone: 'warning',
        text: 'Une anomalie empêche l’ouverture si elle peut perdre une pièce, doubler un paiement ou un numéro, montrer des données à qui n’y a pas droit, modifier un historique ou afficher un total faux. Un défaut d’affichage mineur est noté et suivi.',
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Le travail sans Internet n’est pas encore disponible : ses scénarios ne se répètent pas. L’atelier, l’envoi automatique de rappels et les exports comptables n’existent pas encore.',
      },
    ],
    related: [
      { topic: 'premiere-configuration', label: 'Première configuration : l’ordre à suivre' },
      { topic: 'exploitation', label: 'Exploitation : au quotidien et en cas de problème' },
      { topic: 'parcours-examen', label: 'Parcours : réaliser un examen' },
      { topic: 'parcours-vente', label: 'Parcours : vendre, émettre, encaisser' },
      { topic: 'parcours-caisse', label: 'Parcours : la caisse du jour' },
      { topic: 'parcours-correction', label: 'Parcours : corriger une erreur' },
    ],
    keywords: [
      'recette',
      'essai',
      'test',
      'scénarios',
      'validation avant ouverture',
      'procès-verbal',
      'données fictives',
      'formation',
      'répétition',
    ],
  },
  {
    id: 'exploitation',
    title: 'Exploitation : au quotidien et en cas de problème',
    summary:
      'Les gestes réguliers de la gérante, la gestion des comptes et des exports, ce que prouvent les sauvegardes et qui appeler.',
    module: null,
    anyPermission: ['users.manage'],
    audience: ['MANAGER'],
    intro:
      'La gérante tient les comptes, les autorisations, les clôtures de caisse et les exports. Le serveur, les sauvegardes et les mises à jour relèvent du prestataire, qui sauvegarde aussi avant chaque mise à jour.',
    blocks: [
      {
        kind: 'points',
        title: 'Au quotidien',
        items: [
          'Le matin, chaque caissière ouvre sa caisse (« Ouvrir la caisse »).',
          'Dans la journée, la gérante traite les demandes « En attente » de « Paramètres », « Autorisations ».',
          'Le soir, chaque caissière clôture (« Clôturer la caisse »). La gérante lit « Caisse du jour » et, dans « Sessions de toutes les caisses », clôture une session oubliée ou examine un écart (« Revoir l’écart »).',
        ],
      },
      {
        kind: 'steps',
        title: 'Une collègue a oublié son mot de passe',
        items: [
          '« Paramètres », « Personnel », puis cliquez sur le nom de la personne.',
          'Dans « Réinitialiser le mot de passe », cliquez sur « Générer un mot de passe » et remplissez « Motif (obligatoire) ».',
          'Cliquez sur « Réinitialiser le mot de passe » et confirmez votre mot de passe.',
          'Notez le mot de passe, affiché une seule fois, et remettez-le en personne ; la personne le changera à sa connexion.',
        ],
      },
      {
        kind: 'note',
        tone: 'warning',
        text: 'Les sessions ouvertes du compte sont fermées. Le mot de passe d’une gérante ne se réinitialise pas depuis l’application, même par une autre gérante : le prestataire fait la procédure de secours, sur le serveur.',
      },
      {
        kind: 'steps',
        title: 'Désactiver un compte (départ, accès perdu)',
        items: [
          '« Paramètres », « Personnel », le nom de la personne ; dans « Compte et profils », décochez « Compte actif » et remplissez « Motif (obligatoire) ».',
          'Cliquez sur « Enregistrer le compte » et confirmez votre mot de passe.',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Le compte ne se connecte plus et ses sessions sont fermées. Il n’est jamais supprimé : ses actions passées gardent son nom. La gérante ne désactive pas son propre compte.',
      },
      {
        kind: 'steps',
        title: 'Exporter des données',
        items: [
          '« Paramètres », « Exports » : choisissez le « Contenu de l’export », puis « Demander l’export » et confirmez votre mot de passe.',
          'Cliquez sur « Actualiser la liste » jusqu’à « Prêt à télécharger » (quelques minutes), puis sur « Télécharger l’archive ».',
        ],
      },
      {
        kind: 'note',
        tone: 'warning',
        text: 'Disponible 48 heures, puis « Expiré ». Un fichier par table, à ouvrir dans un tableur. Données de santé : gardez l’archive sur un support protégé, jamais par message. Ce n’est pas une sauvegarde. Un seul dossier : « Exporter le dossier », sur la fiche du patient.',
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Le prestataire doit sauvegarder chaque nuit, en copie chiffrée (protégée par une clé), garder une copie hors du serveur chaque semaine et refaire un essai de restauration chaque mois. Aucun écran de l’application ne montre l’état des sauvegardes.',
      },
      {
        kind: 'table',
        title: 'Sauvegardes : ce qu’elles prouvent, ce qu’elles ne prouvent pas',
        head: ['Ce que vous constatez', 'Ce que cela prouve', 'Ce que cela ne prouve pas'],
        rows: [
          [
            'Une sauvegarde de la nuit existe',
            'Une copie des données existait à ce moment-là',
            'Qu’elle se relit, ni qu’elle contient le travail fait depuis : une panne peut faire perdre une journée de saisies',
          ],
          [
            'Une copie est gardée hors du serveur',
            'Une panne du serveur n’emporte pas toutes les copies',
            'Que la clé de chiffrement est gardée à part : sans elle, aucune copie chiffrée ne se relit',
          ],
          [
            'Un essai de restauration a réussi',
            'Cette sauvegarde se relit : factures, reçus, numéros et historique y sont retrouvés',
            'Que la sauvegarde suivante se relira : l’essai se refait chaque mois',
          ],
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Avant d’ouvrir « Patients » aux saisies réelles, exigez un essai de restauration réussi et daté. Demandez ensuite la date de la dernière sauvegarde et celle du dernier essai, avec son résultat.',
      },
      {
        kind: 'table',
        title: 'Qui appeler',
        head: ['Ce que vous voyez', 'Qui agit'],
        rows: [
          [
            '« Accès refusé », ou un bouton absent',
            'La gérante : elle attribue le profil ou le droit manquant',
          ],
          [
            'Un écran absent du menu, ou « Page introuvable »',
            'Le prestataire : l’écran n’est pas ouvert',
          ],
          [
            '« Aucune caisse active dans ce cabinet », « Aucun emplacement de stock » ou « Aucune échelle d’acuité n’est configurée pour ce cabinet »',
            'Le prestataire : réglage de mise en service',
          ],
          [
            '« Demandé : en attente de production » depuis plus de quelques minutes, ou « Échec de la production »',
            'Le prestataire',
          ],
          [
            '« Serveur injoignable » ou « Serveur indisponible » qui dure',
            'D’abord la connexion Internet du poste, puis le prestataire',
          ],
          [
            'Mot de passe de la gérante oublié, sauvegarde, mise à jour, documents officiels, séries de numéros',
            'Le prestataire',
          ],
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Le nom du prestataire, son numéro et son délai d’intervention sont à convenir avant l’ouverture. Notez-les près du poste de la gérante.',
      },
      {
        kind: 'note',
        tone: 'warning',
        text: 'Sans Internet, rien ne s’enregistre : le travail sans Internet n’est pas encore disponible. Notez sur papier le patient, l’article, le montant et le mode, puis ressaisissez au retour de la connexion : l’encaissement ressaisi porte la date de sa saisie.',
      },
    ],
    related: [
      { route: 'parametres-personnel', label: 'Personnel' },
      { route: 'parametres-exports', label: 'Exports' },
      { route: 'approbations', label: 'Approbations' },
      { route: 'caisse', label: 'Caisse' },
      { topic: 'notion-securite', label: 'Sécurité, droits et confidentialité' },
      { topic: 'depannage-messages', label: 'Les messages de l’application et que faire' },
    ],
    keywords: [
      'mot de passe oublié',
      'désactiver un compte',
      'départ d’un employé',
      'export',
      'sauvegarde',
      'restauration',
      'panne',
      'assistance',
      'support',
      'qui appeler',
      'maintenance',
      'mise à jour',
    ],
  },
]
