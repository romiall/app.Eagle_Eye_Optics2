import type { PageHelp } from '../model'

/**
 * Aide du pilotage : statistiques, paramètres (personnel, cabinet, exports) et approbations.
 * Plus deux écrans en validation : préparer ce poste et conflits de synchronisation.
 */
export const PAGES_PILOTAGE: readonly PageHelp[] = [
  {
    route: 'statistiques',
    title: 'Statistiques',
    module: 'reports',
    anyPermission: ['statistics.activity', 'statistics.clinical'],
    purpose:
      'Lisez les chiffres du cabinet sur la période de votre choix : l’activité de l’accueil et les examens, selon vos droits. Ce sont des comptages calculés par le serveur ; aucun nom ni numéro de dossier n’y figure.',
    actions: [
      {
        label: 'Aujourd’hui',
        effect: 'Affiche les chiffres du jour en cours.',
      },
      {
        label: 'Cette semaine',
        effect: 'Affiche la semaine en cours, du lundi au dimanche.',
      },
      {
        label: 'Ce mois',
        effect:
          'Affiche le mois en cours, du premier au dernier jour. C’est le choix fait à l’ouverture de l’écran.',
      },
      {
        label: 'Cette année',
        effect: 'Affiche l’année en cours, du 1er janvier au 31 décembre.',
      },
      {
        label: 'Afficher la période',
        effect:
          'Calcule les tableaux sur les dates saisies dans « Du » et « Au », bornes incluses.',
      },
      {
        label: 'Réessayer',
        effect: 'Relit les chiffres quand « Serveur indisponible » s’affiche.',
      },
    ],
    tasks: [
      {
        id: 'voir-une-periode',
        title: 'Voir l’activité d’une période',
        steps: [
          'Sur l’accueil, cliquez sur « Statistiques » dans la zone « Actions ».',
          'Cliquez sur « Aujourd’hui », « Cette semaine », « Ce mois » ou « Cette année » : la ligne « Période : » rappelle les dates.',
          'Pour d’autres dates, saisissez « Du » et « Au » (JJ/MM/AAAA), puis cliquez sur « Afficher la période ».',
          'Lisez les chiffres du haut de chaque section, puis les tableaux : « Nombre » donne le comptage, « Part » son pourcentage.',
          'Sous chaque tableau, « Part calculée sur … » dit sur quel total le pourcentage est calculé.',
        ],
        result:
          'Les chiffres de la période s’affichent dans « Activité de l’accueil » et dans « Examens », selon vos droits.',
      },
      {
        id: 'comprendre-un-chiffre',
        title: 'Vérifier ce que compte un chiffre',
        steps: [
          'Descendez jusqu’à la carte « Définitions » de la section concernée.',
          'Lisez la ligne du chiffre : elle dit par exemple que les visites annulées ne sont pas comptées.',
          'Regardez « Part calculée sur … » sous le tableau : le total n’est pas le même pour tous les tableaux.',
          'Notez l’heure indiquée par « Données du serveur au … » avant de citer un chiffre.',
        ],
        result:
          'Vous savez ce que chaque nombre compte, sur quel total chaque part est calculée et quand il a été lu.',
      },
    ],
    rules: [
      'Les périodes sont des jours entiers du cabinet, bornes incluses. La semaine va du lundi au dimanche. Un intervalle personnalisé ne dépasse pas 366 jours.',
      'Chaque section demande son droit : « Activité de l’accueil » pour la gérante et l’accueil, « Examens » pour la gérante et le professionnel. La caissière n’a ni l’une ni l’autre, sauf droit ajouté.',
      'Seuls des comptages s’affichent : aucun nom, aucun numéro de dossier, aucun texte clinique. Les mesures ne sont jamais additionnées ni moyennées.',
      'Une consultation compte une fois pour chaque motif coché : les parts des motifs peuvent donc totaliser plus de 100 %.',
      'Les pourcentages ont une décimale, arrondie au plus proche. Sans total de référence, l’écran affiche un tiret au lieu d’inventer une part.',
      'Une lecture qui échoue est signalée par « Serveur indisponible » : elle n’est jamais comptée comme zéro.',
    ],
    next: [
      {
        topic: 'glossaire-optique',
        label: 'Glossaire d’optique',
        why: 'Pour comprendre les amétropies et les orientations des tableaux.',
      },
      {
        topic: 'guide-gerante',
        label: 'Guide de la gérante',
        why: 'Suivre l’activité du cabinet au fil des jours.',
      },
      {
        route: 'agenda',
        label: 'Agenda',
        why: 'D’où viennent « Rendez-vous programmés » et « Patients à revoir ».',
      },
    ],
    tips: [
      'Tant que l’agenda n’est pas ouvert dans votre installation, « Rendez-vous programmés » et « Patients à revoir » affichent « Non disponible dans cette version (agenda) » : ce n’est pas un zéro.',
      'Les « Nouveaux patients » sont ceux dont la première visite connue du cabinet tombe dans la période ; la date de première visite d’un dossier repris de l’historique papier compte.',
      'Un patient sans date de naissance est compté dans « Âge non renseigné ». Les tranches d’âge sont proposées par le cahier des charges et restent à confirmer par le cabinet.',
      'Pour comparer deux périodes, affichez-les l’une après l’autre et notez les nombres : l’écran ne les met pas côte à côte.',
      'Les tableaux ne s’exportent pas pour l’instant : relevez les chiffres à la main si vous devez les reporter ailleurs.',
    ],
    problems: [
      {
        symptom: '« Serveur indisponible »',
        remedy:
          'Le serveur n’a pas répondu : les chiffres ne sont pas à zéro, ils n’ont pas pu être lus. Cliquez sur « Réessayer » quand la connexion est revenue.',
      },
      {
        symptom: '« Date invalide : JJ/MM/AAAA ou AAAA-MM-JJ. »',
        remedy: 'Corrigez « Du » ou « Au » : écrivez par exemple 01/10/2026.',
      },
      {
        symptom: '« La fin de la période précède son début. »',
        remedy:
          'Corrigez les dates de « Du » et « Au », puis cliquez de nouveau sur « Afficher la période ».',
      },
      {
        symptom: 'Un message dit que la période couvre au plus 366 jours',
        remedy: 'Raccourcissez l’intervalle, ou affichez l’année en deux fois.',
      },
      {
        symptom: 'Il manque « Examens » ou « Activité de l’accueil »',
        remedy:
          'Chaque section dépend de vos droits : l’accueil ne voit pas « Examens », le professionnel ne voit pas « Activité de l’accueil ». Demandez à la gérante si c’est nécessaire.',
      },
    ],
    terms: ['Visite', 'Examen', 'Prescription optique', 'Ordonnance de médicaments', 'Orientation'],
  },
  {
    route: 'parametres',
    title: 'Paramètres',
    module: 'settings',
    anyPermission: ['users.manage', 'approval.decide'],
    purpose:
      'C’est le point de départ de l’administration du cabinet : comptes du personnel, identité imprimée sur les documents, autorisations et exports. Chaque carte n’apparaît qu’avec le droit qui l’ouvre.',
    actions: [
      {
        label: 'Personnel',
        effect:
          'Ouvre la liste des comptes : créer un compte, changer un profil, désactiver, réinitialiser un mot de passe.',
        anyPermission: ['users.manage'],
      },
      {
        label: 'Cabinet et documents',
        effect:
          'Ouvre le nom, les coordonnées et les mentions imprimés sur les reçus, factures et ordonnances.',
        anyPermission: ['users.manage'],
      },
      {
        label: 'Autorisations',
        effect:
          'Ouvre l’écran « Approbations » : les demandes d’autorisation des opérations sensibles (remise, dispense, correction).',
        anyPermission: ['approval.decide'],
      },
      {
        label: 'Exports',
        effect:
          'Ouvre les archives de données du cabinet : patients, ventes, stock ou toutes les données.',
        anyPermission: ['export.global'],
      },
      {
        label: 'Préparer ce poste',
        effect:
          'Écran en validation, visible seulement si l’exploitant a ouvert le module du travail sans Internet : pas encore ouvert à la cliente.',
        anyPermission: ['offline.enroll'],
      },
      {
        label: 'Conflits de synchronisation',
        effect:
          'Écran en validation, même condition : la gérante y décide des pièces d’un poste que le serveur n’a pas pu appliquer.',
        anyPermission: ['approval.decide'],
      },
    ],
    tasks: [
      {
        id: 'ouvrir-une-rubrique',
        title: 'Ouvrir une rubrique des paramètres',
        steps: [
          'Cliquez sur « Paramètres » dans le menu, ou dans la zone « Actions » de l’accueil.',
          'Lisez le titre et la phrase de chaque carte : ils disent ce que la rubrique ouvre.',
          'Cliquez sur la carte voulue.',
          'Pour revenir aux cartes, cliquez de nouveau sur « Paramètres » dans le menu.',
        ],
        result: 'La rubrique s’ouvre ; ses réglages sont décrits dans l’aide de son écran.',
      },
      {
        id: 'regler-le-cabinet',
        title: 'Régler le cabinet avant la première journée',
        anyPermission: ['users.manage'],
        steps: [
          'Cliquez sur « Cabinet et documents », puis saisissez le nom, l’adresse, l’identifiant fiscal et les mentions fournis par la cliente.',
          'Cliquez sur « Enregistrer les paramètres » ; retapez votre mot de passe si l’écran le demande.',
          'Revenez aux cartes, cliquez sur « Personnel », puis sur « Créer un compte » pour chaque personne du cabinet.',
          'Remettez en personne chaque mot de passe initial : chaque personne le change à sa première connexion.',
          'Contrôlez l’en-tête sur un PDF : tant que les mentions officielles ne sont pas validées, il porte « DOCUMENT DE TEST ».',
        ],
        result:
          'Le cabinet a ses comptes et ses documents à son identité, encore marqués comme documents de test.',
      },
    ],
    rules: [
      'Chaque carte n’apparaît qu’avec son droit. Par défaut, seule la gérante ouvre cet écran : l’accueil, le professionnel et la caissière obtiennent « Accès refusé ».',
      'La liste des modules ouverts (patients, consultations, ventes…) ne se règle pas ici : l’exploitant, la personne qui gère l’installation, l’ouvre. L’écran le rappelle en bas de page.',
      'Une écriture sensible (compte, cabinet, export, décision) demande de retaper votre mot de passe dans « Confirmer votre mot de passe ». Vos saisies sont conservées, sans doublon à la reprise.',
      'Une confirmation de mot de passe vaut environ un quart d’heure : les opérations sensibles suivantes ne la redemandent pas pendant ce temps.',
      'Rien n’est supprimé : un compte désactivé reste l’auteur de ses actions passées, et les changements de comptes et de cabinet sont consignés dans un journal.',
      'Le fuseau horaire, la monnaie et l’activation des documents officiels ne se changent pas depuis les paramètres : ils relèvent de la mise en service.',
    ],
    next: [
      {
        route: 'parametres-personnel',
        label: 'Personnel',
        why: 'Pour créer ou modifier les comptes.',
      },
      {
        route: 'parametres-cabinet',
        label: 'Cabinet et documents',
        why: 'Pour l’identité imprimée sur les documents.',
      },
      {
        topic: 'premiere-configuration',
        label: 'Première configuration du cabinet',
      },
      {
        topic: 'notion-modules',
        label: 'Comprendre les modules ouverts',
      },
    ],
    tips: [
      'Les cartes « Préparer ce poste » et « Conflits de synchronisation » n’apparaissent que si l’exploitant a ouvert le module du travail sans Internet : il n’est pas encore disponible pour le cabinet.',
      'La carte « Autorisations » ouvre l’écran « Approbations » : c’est là que la gérante accorde ou refuse les demandes de remise, de dispense ou de correction.',
    ],
    problems: [
      {
        symptom: '« Accès refusé »',
        remedy:
          'Votre compte n’a ni le droit de gérer les comptes ni celui de décider des autorisations. Si cela fait partie de votre travail, demandez à la gérante.',
      },
      {
        symptom: '« Aucun paramètre n’est ouvert à ce compte. »',
        remedy:
          'Aucune rubrique ne correspond aux droits de ce compte. Demandez à la gérante d’attribuer le droit nécessaire.',
      },
      {
        symptom: 'Une carte attendue manque',
        remedy:
          'Elle demande un droit que votre compte n’a pas, ou un module que l’installation n’a pas ouvert. Voyez la gérante.',
      },
    ],
    terms: ['Profil', 'Droit', 'Module'],
  },
  {
    route: 'parametres-personnel',
    title: 'Personnel',
    module: 'settings',
    anyPermission: ['users.manage'],
    purpose:
      'Retrouvez ici les comptes nominatifs du cabinet : nom, identifiant, profils et état. Vous y venez pour créer un compte, ouvrir la fiche d’une personne ou vérifier qui peut encore se connecter.',
    actions: [
      {
        label: 'Créer un compte',
        effect: 'Ouvre le formulaire de création d’un compte nominatif.',
      },
      {
        label: 'Page suivante',
        effect:
          'Affiche les 50 comptes suivants. Les boutons de page n’apparaissent que s’il y a plus d’une page.',
      },
      {
        label: 'Page précédente',
        effect: 'Revient aux 50 comptes précédents.',
      },
      {
        label: 'Réessayer',
        effect: 'Relit la liste quand le serveur n’a pas répondu.',
      },
      {
        label: 'Paramètres',
        effect: 'Lien de retour vers les cartes des paramètres.',
      },
    ],
    tasks: [
      {
        id: 'ouvrir-un-compte',
        title: 'Ouvrir la fiche d’un compte',
        steps: [
          'Repérez la personne dans la colonne « Compte », classée par ordre alphabétique ; sinon cliquez sur « Page suivante ».',
          'Vérifiez ses « Profils » et son « État » : « Actif » ou « Désactivé ».',
          'Cliquez sur son nom.',
        ],
        result:
          'La fiche du compte s’ouvre : profils, droits, dérogations et mot de passe s’y gèrent.',
      },
      {
        id: 'ajouter-une-personne',
        title: 'Ajouter une personne au cabinet',
        steps: [
          'Cliquez sur « Créer un compte » en haut de l’écran.',
          'Remplissez le formulaire : voir l’aide de l’écran « Créer un compte ».',
        ],
        result: 'À la fin, la personne apparaît dans la liste avec l’état « Actif ».',
      },
      {
        id: 'verifier-qui-peut-se-connecter',
        title: 'Vérifier qui peut encore se connecter',
        steps: [
          'Parcourez la colonne « État ».',
          'Un compte « Désactivé » ne peut plus se connecter : ouvrez sa fiche pour le réactiver si c’est une erreur.',
        ],
      },
    ],
    rules: [
      'La liste est alphabétique, à raison de 50 comptes par page. Elle n’a pas de zone de recherche.',
      'Un compte n’est jamais supprimé : désactivé, il ne peut plus se connecter et il reste l’auteur de ses actions passées.',
      'Une liste qui n’a pas pu être lue est signalée « Serveur indisponible » : elle n’est jamais présentée comme « Aucun compte ».',
      'Un compte peut cumuler plusieurs profils : la liste les affiche tous.',
      'Seule la gérante ouvre cet écran par défaut : les autres profils obtiennent « Accès refusé ».',
    ],
    next: [
      {
        route: 'parametres-personnel-nouveau',
        label: 'Créer un compte',
        why: 'Pour ajouter une personne.',
      },
      {
        route: 'parametres',
        label: 'Paramètres',
      },
      {
        topic: 'profils',
        label: 'Les quatre profils et leurs droits',
      },
      {
        topic: 'guide-gerante',
        label: 'Guide de la gérante',
      },
    ],
    tips: [
      'Les profils portent les noms « Gérante », « Accueil », « Professionnel (examen) » et « Caisse ».',
      'Sur téléphone, l’identifiant et les profils s’affichent sous le nom, dans la colonne « Compte ».',
    ],
    problems: [
      {
        symptom: '« Serveur indisponible »',
        remedy:
          'Le serveur n’a pas répondu : la liste n’est pas vide pour autant. Cliquez sur « Réessayer » quand la connexion est revenue.',
      },
      {
        symptom: '« Aucun compte »',
        remedy:
          'Le serveur dit n’avoir aucun compte pour ce cabinet : cela ne devrait pas arriver. Prévenez la personne qui a installé l’application.',
      },
    ],
    terms: ['Profil', 'Droit'],
  },
  {
    route: 'parametres-personnel-nouveau',
    title: 'Créer un compte',
    module: 'settings',
    anyPermission: ['users.manage'],
    purpose:
      'Créez le compte nominatif d’une personne du cabinet : un compte par personne, jamais partagé. Son nom figure dans le journal et sur les pièces qu’elle produit. Vous lui remettez en personne son mot de passe initial.',
    actions: [
      {
        label: 'Générer un mot de passe',
        effect:
          'Place un mot de passe aléatoire de 16 caractères dans le champ ; il ne vous est montré qu’une fois, après la création.',
      },
      {
        label: 'Créer le compte',
        effect:
          'Contrôle les champs, demande votre mot de passe si besoin, puis crée le compte sur le serveur.',
      },
      {
        label: 'J’ai noté, ouvrir le compte',
        effect: 'Après la création, efface le mot de passe de l’écran et ouvre la fiche du compte.',
      },
      {
        label: 'Personnel',
        effect: 'Lien de retour vers la liste des comptes.',
      },
    ],
    tasks: [
      {
        id: 'creer-avec-mot-de-passe-genere',
        title: 'Créer un compte avec un mot de passe généré',
        steps: [
          'Saisissez le « Nom affiché » : nom et prénom tels qu’ils doivent figurer dans le journal et sur les pièces.',
          'Saisissez l’« Identifiant de connexion » en minuscules sans accent, par exemple marie.ngono.',
          'Cochez les « Profils » de la personne : « Gérante », « Accueil », « Professionnel (examen) » ou « Caisse ».',
          'Cliquez sur « Générer un mot de passe », puis sur « Créer le compte ».',
          'Si « Confirmer votre mot de passe » s’ouvre, saisissez votre mot de passe, puis cliquez sur « Confirmer et reprendre ».',
          'Notez sur papier le « Mot de passe initial (affiché une seule fois) », puis cliquez sur « J’ai noté, ouvrir le compte ».',
        ],
        result:
          'Le message « Compte créé sur le serveur » s’affiche, puis la fiche du compte s’ouvre. Remettez le mot de passe en personne.',
      },
      {
        id: 'creer-avec-mot-de-passe-choisi',
        title: 'Choisir soi-même le mot de passe initial',
        steps: [
          'Remplissez le nom, l’identifiant et les profils comme pour tout compte.',
          'Saisissez le « Mot de passe initial » : 12 caractères au moins, avec des lettres et des chiffres, différent de l’identifiant.',
          'Cliquez sur « Créer le compte » et confirmez votre mot de passe si l’écran le demande.',
          'Retenez ce mot de passe : l’écran ne le réaffiche pas, il vous demande seulement de le remettre en personne.',
        ],
        result:
          'Le compte est créé ; la personne se connecte avec ce mot de passe et le change aussitôt.',
      },
      {
        id: 'premiere-connexion',
        title: 'Accompagner la première connexion de la personne',
        steps: [
          'Remettez en personne l’identifiant et le mot de passe initial, jamais par message.',
          'La personne saisit « Identifiant » et « Mot de passe », puis clique sur « Se connecter ».',
          'Sur l’accueil, elle clique sur « Changer mon mot de passe ».',
          'Elle saisit « Mot de passe actuel », « Nouveau mot de passe » et « Confirmation du nouveau mot de passe ».',
          'Elle clique sur « Changer le mot de passe ».',
        ],
        result:
          'Le message « Mot de passe changé sur le serveur » confirme : seule la personne connaît désormais son mot de passe.',
      },
    ],
    rules: [
      'Un compte par personne : ne partagez jamais un compte, car son nom figure dans le journal et sur les pièces produites.',
      'L’identifiant compte de 3 à 64 caractères : minuscules sans accent, chiffres, point, tiret ou souligné, et il commence par une lettre ou un chiffre.',
      'Le mot de passe initial compte au moins 12 caractères, avec des lettres et des chiffres, et diffère de l’identifiant. Le serveur applique les mêmes règles que l’écran.',
      'Un mot de passe généré est montré une seule fois, juste après la création, puis oublié par l’application. Un mot de passe saisi n’est jamais réaffiché.',
      'La création est une opération sensible : votre mot de passe est demandé, la saisie est conservée et la création reprend ensuite, sans doublon.',
      'Un compte peut cumuler plusieurs profils. L’adresse électronique est facultative ; un mot de passe oublié se règle avec la gérante.',
    ],
    next: [
      {
        route: 'parametres-personnel',
        label: 'Personnel',
        why: 'Pour vérifier que le compte figure dans la liste.',
      },
      {
        route: 'mot-de-passe',
        label: 'Changer mon mot de passe',
        why: 'L’écran que la personne utilise à sa première connexion.',
      },
      {
        topic: 'profils',
        label: 'Les quatre profils et leurs droits',
      },
      {
        topic: 'notion-securite',
        label: 'Comptes, droits et sécurité',
      },
    ],
    tips: [
      'Notez le mot de passe sur papier avant de cliquer sur « J’ai noté, ouvrir le compte » : une fois l’écran quitté, il n’est plus visible.',
      'Donnez à chaque personne les profils de son travail seulement ; un droit précis peut s’ajouter ensuite sur la fiche du compte.',
    ],
    problems: [
      {
        symptom: 'Un message rouge sous un champ, par exemple « Choisissez au moins un profil. »',
        remedy: 'Corrigez le champ indiqué : le résumé en haut de l’écran les liste tous.',
      },
      {
        symptom: '« Compte non créé » avec « Certaines informations sont à corriger. »',
        remedy:
          'Le serveur refuse un champ, par exemple parce que l’identifiant ou l’adresse existe déjà. Lisez le message sous le champ et corrigez-le.',
      },
      {
        symptom:
          '« Le serveur n’a pas confirmé l’opération : elle a pu être appliquée ou non. Relisez avant de recommencer. »',
        remedy:
          'Ouvrez « Personnel ». Si le compte y figure, il est créé mais son mot de passe n’a pas été montré : sur sa fiche, utilisez « Réinitialiser le mot de passe ». Sinon, recommencez.',
      },
      {
        symptom:
          '« Votre session a pris fin : reconnectez-vous avec le bouton de l’en-tête, puis recommencez. Vos saisies restent à l’écran. »',
        remedy:
          'Reconnectez-vous, puis cliquez de nouveau sur « Créer le compte » : rien n’est perdu.',
      },
      {
        symptom: 'J’ai quitté l’écran sans noter le mot de passe généré',
        remedy:
          'Ouvrez la fiche du compte et utilisez « Réinitialiser le mot de passe » : un nouveau mot de passe est montré une fois.',
      },
    ],
    terms: ['Profil', 'Droit'],
  },
  {
    route: 'parametres-compte',
    title: 'Compte du personnel',
    module: 'settings',
    anyPermission: ['users.manage'],
    purpose:
      'Gérez le compte d’une personne : son identité, ses profils, son état, ses droits en plus ou en moins et son mot de passe. Chaque changement demande votre mot de passe et se garde dans le journal.',
    actions: [
      {
        label: 'Enregistrer le compte',
        effect:
          'Enregistre le nom, l’adresse, les profils et l’état ; un motif est exigé pour désactiver ou retirer un profil.',
      },
      {
        label: 'Enregistrer la dérogation',
        effect:
          'Ajoute, retire ou supprime un droit pour cette personne seulement, avec un motif obligatoire.',
      },
      {
        label: 'Générer un mot de passe',
        effect: 'Remplit les deux champs du nouveau mot de passe avec un mot de passe aléatoire.',
      },
      {
        label: 'Réinitialiser le mot de passe',
        effect:
          'Remplace le mot de passe, déconnecte la personne de ses sessions ouvertes et montre le nouveau mot de passe une fois.',
      },
      {
        label: 'J’ai noté, masquer',
        effect: 'Efface de l’écran le nouveau mot de passe.',
      },
      {
        label: 'Droits effectifs',
        effect:
          'Déplie la liste des droits que la personne détient aujourd’hui, profils et dérogations compris.',
      },
      {
        label: 'Personnel',
        effect: 'Lien de retour vers la liste des comptes.',
      },
    ],
    tasks: [
      {
        id: 'modifier-un-compte',
        title: 'Changer les profils ou désactiver un compte',
        steps: [
          'Dans « Compte et profils », modifiez « Nom affiché », « Adresse électronique (facultative) » ou les cases de « Profils ».',
          'Pour qu’une personne ne puisse plus se connecter, décochez « Compte actif ».',
          'Écrivez le « Motif (obligatoire) » : il est exigé pour une désactivation ou le retrait d’un profil.',
          'Cliquez sur « Enregistrer le compte » ; saisissez votre mot de passe si l’écran le demande.',
        ],
        result:
          'Le message « Compte enregistré sur le serveur » s’affiche ; le changement s’applique dès la prochaine action de la personne.',
      },
      {
        id: 'deroger-a-un-droit',
        title: 'Donner ou retirer un droit à une seule personne',
        steps: [
          'Dans « Dérogation de droit », choisissez le « Droit » ; la ligne dessous dit si le compte le détient aujourd’hui.',
          'Choisissez l’« Effet » : « Autoriser en plus du profil », « Retirer ce droit (l’emporte sur le profil) » ou « Supprimer la dérogation existante ».',
          'Si besoin, saisissez « Valable jusqu’au (facultatif) » ; laissé vide, il n’y a pas de fin.',
          'Écrivez le « Motif (obligatoire) », cliquez sur « Enregistrer la dérogation » et confirmez votre mot de passe.',
        ],
        result:
          'Le message « Dérogation enregistrée sur le serveur » s’affiche ; le compte détient ou perd le droit dès sa prochaine action.',
      },
      {
        id: 'reinitialiser-le-mot-de-passe',
        title: 'Réinitialiser le mot de passe d’une personne',
        steps: [
          'Dans « Réinitialiser le mot de passe », cliquez sur « Générer un mot de passe », ou saisissez deux fois le nouveau.',
          'Écrivez le « Motif (obligatoire) ».',
          'Cliquez sur « Réinitialiser le mot de passe » et confirmez votre mot de passe.',
          'Notez le « Nouveau mot de passe (affiché une seule fois) », puis cliquez sur « J’ai noté, masquer ».',
          'Remettez-le en personne : la personne le change à sa prochaine connexion.',
        ],
        result:
          'Le message « Mot de passe réinitialisé sur le serveur » s’affiche et la personne est déconnectée de ses sessions ouvertes.',
      },
    ],
    rules: [
      'Un compte n’est jamais supprimé : désactivé, il ne peut plus se connecter, ses sessions sont fermées et il reste l’auteur de ses actions passées.',
      'Le cabinet garde toujours au moins une gérante active : le serveur refuse tout changement qui n’en laisserait aucune, et l’écran affiche son message.',
      'Sur votre propre fiche, vous ne modifiez ni vos profils ni votre état et vous ne vous donnez aucune dérogation : une autre gérante le fait.',
      'Le droit de gérer les comptes ne se donne ni ne se retire par dérogation : il n’apparaît pas dans la liste « Droit ».',
      'Une dérogation s’ajoute aux profils pour une personne nommée ; « Retirer ce droit » l’emporte sur le profil. Le motif est conservé dans le journal.',
      'Le mot de passe d’une gérante ne se réinitialise pas ici : la procédure de secours se fait sur le serveur. Chacune change le sien par « Changer mon mot de passe ».',
    ],
    next: [
      {
        route: 'parametres-personnel',
        label: 'Personnel',
      },
      {
        topic: 'profils',
        label: 'Les quatre profils et leurs droits',
      },
      {
        topic: 'notion-securite',
        label: 'Comptes, droits et sécurité',
      },
      {
        route: 'mot-de-passe',
        label: 'Changer mon mot de passe',
        why: 'Pour changer votre propre mot de passe.',
      },
    ],
    tips: [
      'Ouvrez « Droits effectifs » pour voir ce que la personne peut vraiment faire, profils et dérogations compris, tels que le serveur les calcule.',
      'Si quelqu’un d’autre a modifié le compte pendant votre saisie, l’écran refuse l’enregistrement et garde vos saisies : relisez la fiche avant de recommencer.',
      'La date de « Valable jusqu’au (facultatif) » est incluse : la dérogation vaut jusqu’à la fin de ce jour, à l’heure du cabinet.',
    ],
    problems: [
      {
        symptom:
          '« Ce compte a été modifié entre-temps par une autre personne : relisez-le avant de recommencer. Vos saisies restent à l’écran. »',
        remedy: 'Rechargez la fiche pour voir la version actuelle, puis refaites votre changement.',
      },
      {
        symptom: '« Indiquez le motif de la désactivation ou du retrait de profil. »',
        remedy:
          'Remplissez « Motif (obligatoire) » : il est exigé pour désactiver un compte ou retirer un profil.',
      },
      {
        symptom: '« Indiquez le motif (3 caractères au moins). »',
        remedy: 'Le motif d’une dérogation ou d’une réinitialisation compte au moins 3 caractères.',
      },
      {
        symptom:
          '« Le serveur n’a pas confirmé l’opération : elle a pu être appliquée ou non. Relisez avant de recommencer. »',
        remedy: 'Rechargez la fiche et vérifiez l’état du compte avant de refaire l’opération.',
      },
      {
        symptom: '« Compte introuvable »',
        remedy:
          'Ce compte n’existe pas dans ce cabinet ou n’est plus accessible. Revenez à la liste par le lien « Personnel ».',
      },
    ],
    terms: ['Profil', 'Droit'],
  },
  {
    route: 'parametres-cabinet',
    title: 'Cabinet et documents',
    module: 'settings',
    anyPermission: ['users.manage'],
    purpose:
      'Saisissez l’identité du cabinet imprimée sur les reçus, factures et ordonnances : nom, coordonnées, identifiant fiscal, mentions, lignes d’en-tête et de pied. Rien n’est proposé ni inventé : tout vient de la cliente.',
    actions: [
      {
        label: 'Enregistrer les paramètres',
        effect:
          'Contrôle les champs, demande votre mot de passe si besoin, puis enregistre l’identité et les lignes des documents.',
      },
      {
        label: 'Réessayer',
        effect: 'Relit les paramètres quand le serveur n’a pas répondu.',
      },
      {
        label: 'Paramètres',
        effect: 'Lien de retour vers les cartes des paramètres.',
      },
    ],
    tasks: [
      {
        id: 'saisir-l-identite',
        title: 'Saisir l’identité du cabinet',
        steps: [
          'Lisez le bandeau du haut : « Documents de test » signifie que chaque document porte encore « DOCUMENT DE TEST ».',
          'Dans « Identité du cabinet », saisissez « Nom du cabinet », « Adresse », « Téléphone » et « Adresse électronique ».',
          'Saisissez « Identifiant fiscal » et « Mentions professionnelles » tels que la cliente les a fournis ou validés.',
          'Cliquez sur « Enregistrer les paramètres » ; retapez votre mot de passe si l’écran le demande.',
        ],
        result:
          'Le message « Paramètres enregistrés sur le serveur » s’affiche : les prochains documents portent cette identité.',
      },
      {
        id: 'regler-les-documents',
        title: 'Régler l’en-tête et le pied des documents',
        steps: [
          'Dans « Documents », écrivez une information par ligne dans « Lignes d’en-tête » : elles s’impriment sous les coordonnées du cabinet.',
          'Écrivez de même les « Lignes de pied de page ».',
          'Si la cliente en a validé un, saisissez « Conditions de règlement des factures » ; laissé vide, rien n’est imprimé.',
          'Cliquez sur « Enregistrer les paramètres », puis contrôlez le résultat sur un PDF.',
        ],
        result: 'Les documents produits à partir de maintenant portent ces lignes.',
      },
    ],
    rules: [
      'Tout est saisi par la gérante : l’application ne propose ni n’invente aucune mention. L’identifiant fiscal et les mentions viennent de la cliente.',
      'Tant que les mentions réelles ne sont pas validées à la mise en service, chaque document porte « DOCUMENT DE TEST ». Cet écran ne lève pas cette mention.',
      'Le fuseau horaire et la monnaie s’affichent en lecture seule : les dates et montants déjà enregistrés en dépendent.',
      'Une facture déjà émise garde l’identité de son émission : un changement ne vaut que pour les documents produits ensuite.',
      'En-tête et pied comptent six lignes au plus, de 200 caractères chacune ; les conditions de règlement, 1 000 caractères au plus.',
      'L’enregistrement demande de retaper votre mot de passe : vos saisies sont conservées et reprennent ensuite, sans doublon.',
    ],
    next: [
      {
        route: 'parametres-personnel',
        label: 'Personnel',
        why: 'Pour créer les comptes du cabinet.',
      },
      {
        topic: 'notion-documents',
        label: 'Comprendre les documents et l’impression',
      },
      {
        topic: 'premiere-configuration',
        label: 'Première configuration du cabinet',
      },
      {
        route: 'parametres',
        label: 'Paramètres',
      },
    ],
    tips: [
      'Le nom du cabinet est le seul champ obligatoire.',
      'Une ligne par information : passez à la ligne avec Entrée dans « Lignes d’en-tête » et « Lignes de pied de page ».',
      'Contrôlez toujours le résultat sur un PDF avant de remettre un document à un patient.',
    ],
    problems: [
      {
        symptom: '« Saisissez le nom du cabinet (2 caractères au moins). »',
        remedy: 'Complétez « Nom du cabinet » : c’est le seul champ obligatoire.',
      },
      {
        symptom: '« Paramètres non enregistrés » avec « Certaines informations sont à corriger. »',
        remedy:
          'Un champ est refusé : lisez le message rouge sous chaque champ, ou le résumé en haut de l’écran.',
      },
      {
        symptom:
          '« Le serveur n’a pas confirmé l’opération : elle a pu être appliquée ou non. Relisez avant de recommencer. »',
        remedy: 'Rechargez l’écran et vérifiez les valeurs affichées avant de saisir de nouveau.',
      },
      {
        symptom: 'Les documents portent encore « DOCUMENT DE TEST » après l’enregistrement',
        remedy:
          'C’est normal : l’activation des documents officiels ne se fait pas depuis cet écran, mais lors de la mise en service.',
      },
      {
        symptom: 'Une facture émise garde l’ancienne adresse',
        remedy: 'C’est voulu : l’identité d’une facture est figée à son émission.',
      },
    ],
    terms: ['Facture émise', 'Reçu', 'Ordonnance de médicaments'],
  },
  {
    route: 'parametres-exports',
    title: 'Exports',
    module: 'settings',
    anyPermission: ['export.global', 'clinical.export'],
    purpose:
      'Demandez une archive de données du cabinet et téléchargez-la quand le serveur l’a préparée. Elle contient un fichier par table à ouvrir dans un tableur, et des données personnelles et de santé.',
    actions: [
      {
        label: 'Demander l’export',
        effect:
          'Demande l’archive du contenu choisi dans « Contenu de l’export » ; le serveur la prépare en quelques minutes.',
        anyPermission: ['export.global'],
      },
      {
        label: 'Actualiser la liste',
        effect: 'Relit la liste pour voir l’état de chaque export.',
      },
      {
        label: 'Télécharger l’archive',
        effect: 'Télécharge l’archive d’un export prêt. Le lien disparaît quand l’export expire.',
      },
      {
        label: 'Réessayer',
        effect: 'Relit la liste quand le serveur n’a pas répondu.',
      },
    ],
    tasks: [
      {
        id: 'demander-un-export',
        title: 'Demander un export global',
        anyPermission: ['export.global'],
        steps: [
          'Ouvrez « Paramètres », puis la carte « Exports ».',
          'Dans « Contenu de l’export », choisissez « Patients et visites », « Ventes, encaissements et caisse », « Catalogue et stock » ou « Remise complète des données ».',
          'Cliquez sur « Demander l’export ».',
          'Si « Confirmer votre mot de passe » s’ouvre, saisissez votre mot de passe, puis cliquez sur « Confirmer et reprendre ».',
        ],
        result:
          'L’export apparaît dans « Exports récents » avec l’état « Demandé : en attente de production ».',
      },
      {
        id: 'telecharger-l-archive',
        title: 'Télécharger l’archive',
        steps: [
          'Attendez quelques minutes : le serveur prépare l’archive de son côté.',
          'Cliquez sur « Actualiser la liste » jusqu’à voir l’état « Prêt à télécharger ».',
          'Cliquez sur « Télécharger l’archive » sur la ligne de l’export.',
          'Rangez le fichier dans un endroit protégé : il contient des données personnelles et de santé.',
        ],
        result:
          'La ligne indique « disponible jusqu’au … » (48 heures) ; passé ce délai, l’état devient « Expiré ».',
      },
      {
        id: 'exporter-un-dossier-patient',
        title: 'Exporter le dossier d’un seul patient',
        anyPermission: ['clinical.export'],
        steps: [
          'Ouvrez la fiche du patient (Patients, puis son nom).',
          'Cliquez sur « Exporter le dossier » et confirmez votre mot de passe si l’écran le demande.',
          'Cliquez sur le lien « Le télécharger depuis Exports » qui s’affiche.',
          'Sur l’écran « Exports », attendez l’état « Prêt à télécharger », puis cliquez sur « Télécharger l’archive ».',
        ],
        result:
          'Vous obtenez l’archive du seul dossier de ce patient, avec le sens de chaque colonne.',
      },
    ],
    rules: [
      'Chaque export est une archive privée : un fichier par table à ouvrir dans un tableur, le sens de chaque colonne et un contrôle d’intégrité.',
      'Le serveur prépare l’archive en quelques minutes ; elle se télécharge pendant 48 heures, puis l’état devient « Expiré » et le fichier est supprimé.',
      'La demande est une opération sensible : votre mot de passe est confirmé. Le téléchargement est tracé.',
      'Les quatre exports globaux sont réservés à la gérante. Le dossier d’un seul patient se demande depuis sa fiche : gérante et professionnel peuvent le faire.',
      'L’export contient tout le contenu du type choisi : il n’y a pas de filtre par période.',
      'Rien n’est préparé ni gardé dans le navigateur : le lien de téléchargement est privé et passe par votre session.',
    ],
    next: [
      {
        route: 'patients',
        label: 'Patients',
        why: 'Pour exporter le dossier d’un seul patient depuis sa fiche.',
      },
      {
        topic: 'notion-securite',
        label: 'Comptes, droits et sécurité',
      },
      {
        topic: 'exploitation',
        label: 'Exploitation après l’ouverture',
      },
      {
        route: 'parametres',
        label: 'Paramètres',
      },
    ],
    tips: [
      'L’archive contient des données personnelles et de santé : rangez-la sur un support protégé, jamais dans une messagerie ou un dossier partagé.',
      'Le professionnel ne voit pas le formulaire « Demander un export » : il demande un dossier depuis la fiche du patient, puis télécharge l’archive ici.',
    ],
    problems: [
      {
        symptom: '« Choisissez le contenu de l’export. »',
        remedy:
          'Sélectionnez un élément dans « Contenu de l’export » avant de cliquer sur « Demander l’export ».',
      },
      {
        symptom: '« Demande non aboutie »',
        remedy:
          'Le serveur n’a pas confirmé la demande. Cliquez sur « Actualiser la liste » : si l’export y figure, ne le redemandez pas.',
      },
      {
        symptom: '« Échec de la production »',
        remedy:
          'Le serveur n’a pas pu préparer l’archive. Redemandez l’export ; si l’échec se répète, prévenez la personne qui a installé l’application.',
      },
      {
        symptom: 'Le lien « Télécharger l’archive » n’apparaît pas',
        remedy:
          'L’état n’est pas encore « Prêt à télécharger », ou l’export a expiré. Cliquez sur « Actualiser la liste » ; un export « Expiré » se redemande.',
      },
      {
        symptom: '« Aucun export »',
        remedy: 'Aucun export n’a encore été demandé : rien d’anormal.',
      },
    ],
  },
  {
    route: 'approbations',
    title: 'Approbations',
    module: 'settings',
    anyPermission: ['approval.decide', 'approval.request'],
    purpose:
      'Une approbation autorise une seule opération sensible, une seule fois et pour une durée limitée. La gérante y accorde ou refuse les demandes ; les autres comptes y suivent leurs propres demandes, sous le titre « Mes demandes d’approbation ».',
    actions: [
      {
        label: 'En attente',
        effect:
          'Affiche les demandes qui peuvent encore être décidées. C’est l’affichage à l’ouverture de l’écran.',
      },
      {
        label: 'Toutes',
        effect: 'Affiche aussi l’historique : demandes accordées, refusées, échues ou utilisées.',
      },
      {
        label: 'Accorder',
        effect: 'Accorde la demande, une seule fois, avant son échéance. Le motif est facultatif.',
        anyPermission: ['approval.decide'],
      },
      {
        label: 'Refuser',
        effect: 'Refuse la demande. Le motif est obligatoire et rendu à la personne qui a demandé.',
        anyPermission: ['approval.decide'],
      },
      {
        label: 'Page suivante',
        effect: 'Affiche les 25 demandes suivantes, quand il y a plus d’une page.',
      },
      {
        label: 'Réessayer',
        effect: 'Relit la liste quand le serveur n’a pas répondu.',
      },
    ],
    tasks: [
      {
        id: 'demander-une-approbation',
        title: 'Demander une autorisation à la gérante',
        anyPermission: ['approval.request'],
        steps: [
          'Quand un écran refuse une opération parce qu’elle dépasse vos droits, cliquez sur son bouton : « Demander l’autorisation » ou « Demander une autorisation ».',
          'Dans la boîte « Demander : … », lisez ce qui sera demandé, puis écrivez le « Motif de la demande ».',
          'Cliquez sur « Envoyer la demande à la gérante », puis prévenez-la de vive voix.',
          'Quand la gérante a accordé, refaites exactement la même opération avant l’échéance : même montant, mêmes lignes, même mode.',
        ],
        result: 'L’opération identique consomme l’approbation, qui passe à l’état « Utilisée ».',
      },
      {
        id: 'accorder-ou-refuser',
        title: 'Accorder ou refuser une demande',
        anyPermission: ['approval.decide'],
        steps: [
          'Ouvrez « Paramètres », puis la carte « Autorisations » : l’écran affiche d’abord « En attente ».',
          'Sur la carte, vérifiez la nature, le patient ou la facture, le contenu exact, le « Motif » et l’« Échéance ».',
          'Pour accorder, cliquez sur « Accorder » ; le motif de la décision est facultatif pour un accord.',
          'Pour refuser, écrivez d’abord ce motif, puis cliquez sur « Refuser » : il sera rendu à la personne qui a demandé.',
          'Saisissez votre mot de passe dans « Confirmer votre mot de passe », puis cliquez sur « Confirmer et reprendre ».',
        ],
        result:
          'Le message « Décision enregistrée » s’affiche, avec « Approbation accordée et enregistrée sur le serveur. » ou « Refus enregistré sur le serveur. »',
      },
      {
        id: 'retrouver-une-demande',
        title: 'Retrouver une demande passée',
        steps: [
          'Cliquez sur « Toutes » pour voir aussi les demandes décidées, échues ou utilisées.',
          'Lisez le statut de chaque carte : « En attente de la gérante », « Accordée, pas encore utilisée », « Refusée », « Échue » ou « Utilisée ».',
          'Les lignes « Décision » et « Motif de la décision » disent qui a décidé, quand et pourquoi.',
        ],
      },
    ],
    rules: [
      'Une approbation vaut pour une opération précise, une seule fois, avant son « Échéance » (une heure après la décision, par défaut). Si le contenu change, une nouvelle demande est nécessaire.',
      'La personne qui a fait la demande ne la décide pas. Une gérante qui veut agir elle-même exécute directement l’opération.',
      'Un refus exige un motif, rendu à la personne qui a demandé. Un accord peut se donner sans motif.',
      'Décider demande de confirmer votre mot de passe. Une demande échue ou déjà décidée ne se décide plus.',
      'La gérante voit toutes les demandes du cabinet ; les autres comptes ne voient que les leurs.',
      'Une dispense des frais d’examen autorise seulement de démarrer l’examen : elle ne vaut pas règlement.',
    ],
    next: [
      {
        topic: 'notion-approbations',
        label: 'Comprendre les approbations',
      },
      {
        route: 'factures',
        label: 'Factures',
        why: 'Là où une remise ou une correction demande souvent une autorisation.',
      },
      {
        route: 'caisse',
        label: 'Caisse',
        why: 'Pour un mouvement de caisse hors vente.',
      },
      {
        route: 'parametres',
        label: 'Paramètres',
      },
    ],
    tips: [
      'L’accueil, le professionnel et la caissière n’ont pas de lien vers cet écran : ils demandent à la gérante, ou l’ouvrent à l’adresse /parametres/approbations.',
      'Les demandes possibles : dispense des frais d’examen, prix ou remise d’un brouillon de facture, contre-écriture, avoir, remboursement, remise avant règlement complet, casse ou ajustement de stock, mouvement de caisse hors vente.',
      'Dans la file du jour, le bouton s’appelle « Demander une dispense des frais d’examen » ; pour une remise au patient, « Demander l’autorisation de remise ».',
      'Pour un prix ou une remise, la demande porte sur toutes les lignes du brouillon : après l’accord, enregistrez de nouveau le brouillon sans rien modifier.',
    ],
    problems: [
      {
        symptom: '« Décision non enregistrée »',
        remedy:
          'La demande était échue, déjà décidée ou déjà utilisée. L’écran a relu la liste : vérifiez son nouvel état.',
      },
      {
        symptom: '« Indiquez le motif du refus : il est rendu à la personne qui a demandé. »',
        remedy:
          'Écrivez le motif dans « Motif de la décision (obligatoire pour un refus) », puis cliquez de nouveau sur « Refuser ».',
      },
      {
        symptom: '« Contenu exact non vérifiable : ne pas décider sur cette base. »',
        remedy:
          'Ne décidez pas. Demandez à la personne de refaire sa demande depuis l’écran qui l’a bloquée.',
      },
      {
        symptom:
          '« Vous avez fait cette demande : une autre personne habilitée la décide. Pour agir vous-même, exécutez directement l’opération. »',
        remedy:
          'C’est normal : vous ne décidez pas votre propre demande. Une gérante exécute directement l’opération ; sinon, attendez la décision.',
      },
      {
        symptom: '« Serveur indisponible »',
        remedy:
          'Le serveur n’a pas répondu : la liste n’est pas vide pour autant. Cliquez sur « Réessayer ».',
      },
    ],
    terms: ['Approbation', 'Remise commerciale', 'Avoir', 'Remboursement', 'Contre-écriture'],
  },
  {
    route: 'parametres-poste',
    title: 'Préparer ce poste',
    module: 'offline',
    anyPermission: ['offline.enroll'],
    maturity: 'validation',
    purpose:
      'Écran en validation, pas encore ouvert à la cliente : il prépare un ordinateur du cabinet, appelé poste, en vue du travail sans Internet, qui n’est pas encore disponible. Il n’apparaît que si l’exploitant ouvre le module ; ne le proposez pas au personnel.',
    actions: [
      {
        label: 'Vérifier le stockage du poste',
        effect:
          'Contrôle que le navigateur garde durablement les données et signale les blocages (navigation privée, place disponible).',
      },
      {
        label: 'Créer le coffre',
        effect:
          'Crée le coffre chiffré du poste avec le secret local de la gérante ; une clé de récupération s’affiche ensuite.',
      },
      {
        label: 'Confirmer et créer le coffre',
        effect: 'Termine la création une fois la clé de récupération ressaisie sans erreur.',
      },
      {
        label: 'Ouvrir le coffre',
        effect: 'Ouvre le coffre d’un profil avec son secret local.',
      },
      {
        label: 'Enrôler ce poste',
        effect: 'Déclare ce poste au serveur sous un code et un nom.',
      },
      {
        label: 'Préparer l’autorisation',
        effect:
          'Demande au serveur l’autorisation signée d’un profil pour ce poste (72 heures par défaut).',
      },
      {
        label: 'Réserver les numéros',
        effect: 'Réserve des plages de numéros de dossiers, de factures et de reçus pour ce poste.',
      },
      {
        label: 'Synchroniser maintenant',
        effect: 'Échange les pièces du poste avec le serveur, puis relit leur état.',
      },
      {
        label: 'Exporter ce poste (fichier chiffré)',
        effect:
          'Télécharge une sauvegarde chiffrée des pièces du poste ; seule la clé de récupération de la gérante la rouvre.',
      },
      {
        label: 'Verrouiller le coffre',
        effect: 'Ferme le coffre : les données du poste redeviennent illisibles sans secret.',
      },
    ],
    tasks: [
      {
        id: 'preparer-un-poste',
        title: 'Préparer un poste pour la validation',
        steps: [
          'Ouvrez l’écran avec un compte de gérante, sur le poste concerné, avec Chrome ou Edge à jour, en connexion sécurisée et hors navigation privée.',
          'Cliquez sur « Vérifier le stockage du poste » et lisez les lignes de résultat avant d’aller plus loin.',
          'À l’étape « 2. Créer le coffre de ce poste », saisissez le « Secret local de la gérante », puis cliquez sur « Créer le coffre ».',
          'Notez sur papier la « Clé de récupération », hors du poste, ressaisissez-la, puis cliquez sur « Confirmer et créer le coffre ».',
          'À l’étape « 3. Enrôler ce poste », renseignez « Code du poste » et « Nom du poste », puis cliquez sur « Enrôler ce poste ».',
          'Pour chaque personne, cliquez sur « Préparer l’autorisation » puis sur « Ajouter le profil local » : elle saisit elle-même son secret local.',
          'À l’étape « 4. Réserver les numéros de ce poste », cliquez sur « Réserver les numéros ».',
        ],
        result:
          'Le poste est enrôlé, ses profils sont préparés et ses numéros réservés ; rien n’est ouvert à la cliente pour autant.',
      },
      {
        id: 'suivre-la-synchronisation',
        title: 'Suivre l’état de la synchronisation',
        steps: [
          'À l’étape « 5. Synchronisation », lisez les compteurs : pièces enregistrées sur le poste, envoyées, en attente d’une pièce liée, en conflit.',
          'Cliquez sur « Synchroniser maintenant » pour lancer un échange de pièces avec le serveur.',
          'Lisez « Dernier échange réussi » : « jamais » signifie qu’aucun échange n’a encore abouti.',
          'Sous « Pièces à revoir », lisez chaque ligne : la pièce reste conservée sur le poste.',
          'Un conflit se décide dans l’écran « Conflits de synchronisation » de la gérante.',
        ],
        result: 'Vous savez combien de pièces attendent et lesquelles demandent une décision.',
      },
      {
        id: 'sauvegarder-ou-reprendre',
        title: 'Sauvegarder un poste ou en reprendre un ancien',
        steps: [
          'À l’étape « 6. Sauvegarde chiffrée de ce poste », cliquez sur « Exporter ce poste (fichier chiffré) » et rangez le fichier sur un support contrôlé.',
          'Sur un poste neuf déjà enrôlé, choisissez l’« Export de l’ancien poste », saisissez la « Clé de récupération de la gérante », puis cliquez sur « Ouvrir l’export ».',
          'Cliquez sur « Ranger l’export dans ce poste », puis écrivez le « Motif du remplacement ».',
          'Cliquez dans l’ordre sur « 1. Déclarer le remplacement », « 2. Transmettre les pièces de l’ancien poste » et « 3. Clôturer l’ancien poste ».',
        ],
        result:
          'Les pièces de l’ancien poste repartent avec leurs numéros d’origine, jamais renumérotées.',
      },
    ],
    rules: [
      'Cet écran est en validation : il est codé, mais le module n’est pas ouvert à la cliente. Rien de ce qu’il prépare ne s’utilise encore en exploitation.',
      'Le coffre du poste est chiffré. Le secret local ne part jamais au serveur ; la clé de récupération ne s’affiche qu’une fois et se garde hors du poste.',
      'Sans clé de récupération, un secret local perdu rend inaccessibles les données de ce profil sur le poste.',
      'Chaque profil reçoit une autorisation signée par le serveur, valable 72 heures par défaut ; la personne saisit elle-même son secret local.',
      'Le poste numérote lui-même dossiers, factures et reçus dans des plages réservées : un numéro n’est jamais attribué deux fois ni renuméroté.',
      'Un stockage persistant n’est pas une sauvegarde : l’export du poste reste nécessaire.',
    ],
    next: [
      {
        route: 'conflits-synchronisation',
        label: 'Conflits de synchronisation',
        why: 'Où la gérante décide des pièces que le serveur ne peut pas appliquer.',
      },
      {
        topic: 'depannage-limites',
        label: 'Ce que cette version ne fait pas encore',
      },
      {
        topic: 'repetition-generale',
        label: 'Répétition générale avant l’ouverture',
      },
      {
        route: 'parametres',
        label: 'Paramètres',
      },
    ],
    tips: [
      'Même une fois validé, ce mode ne concernerait que la création et la modification de patients, les factures et les encaissements ; visites, examens et avoirs resteraient en ligne.',
      'La navigation privée est interdite pour un poste : l’écran la signale. Il signale aussi quand l’écriture sur disque n’est pas garantie : prévoyez alors un onduleur.',
      'Ne réinstallez pas le navigateur et ne videz pas ses données avant d’avoir exporté le poste et synchronisé ses pièces.',
    ],
    problems: [
      {
        symptom:
          '« Ce secret local est trop faible : au moins 14 caractères, sans votre identifiant ni suite évidente. »',
        remedy:
          'Choisissez un secret plus long, ou cliquez sur « Proposer un secret » et notez-le.',
      },
      {
        symptom: '« La clé ressaisie ne correspond pas à celle affichée : rien n’a été créé. »',
        remedy:
          'Ressaisissez la clé exactement comme affichée, groupe par groupe. Rien n’a été créé : vous pouvez recommencer.',
      },
      {
        symptom: '« Secret local incorrect. »',
        remedy:
          'Vérifiez le secret. Après plusieurs essais ratés, l’écran impose une attente : « Trop de tentatives : patientez avant de réessayer. »',
      },
      {
        symptom: '« Coffre illisible »',
        remedy:
          'Le coffre est endommagé ou écrit par une version plus récente de l’application : rien n’y est modifié. Contactez le support avant toute réinstallation.',
      },
      {
        symptom:
          '« L’autorisation de ce profil sur ce poste a expiré ou a été retirée : préparez de nouveau le profil en ligne (étape 3). Les pièces restent enregistrées sur ce poste. »',
        remedy:
          'Cliquez sur « Préparer l’autorisation » pour ce profil, en ligne, puis relancez « Synchroniser maintenant ».',
      },
    ],
    terms: ['Module', 'Profil'],
  },
  {
    route: 'conflits-synchronisation',
    title: 'Conflits de synchronisation',
    module: 'offline',
    anyPermission: ['approval.decide'],
    maturity: 'validation',
    purpose:
      'Écran en validation, pas encore ouvert à la cliente : la gérante y décide des pièces d’un poste que le serveur n’a pas pu appliquer telles quelles. Il n’apparaît que si l’exploitant ouvre le module correspondant.',
    actions: [
      {
        label: 'À revoir',
        effect: 'Affiche les conflits encore ouverts. C’est l’affichage à l’ouverture de l’écran.',
      },
      {
        label: 'Résolus',
        effect: 'Affiche les conflits déjà décidés, avec la décision, son auteur et son motif.',
      },
      {
        label: 'Décider',
        effect:
          'Ouvre le formulaire de décision d’un conflit : décision, motif, puis enregistrement.',
      },
      {
        label: 'Enregistrer la décision',
        effect:
          'Enregistre la décision après confirmation de votre mot de passe ; la pièce du poste n’est jamais réécrite.',
      },
      {
        label: 'Annuler',
        effect: 'Referme le formulaire sans rien enregistrer.',
      },
    ],
    tasks: [
      {
        id: 'decider-d-un-conflit',
        title: 'Décider d’un conflit',
        steps: [
          'Ouvrez « Paramètres », puis la carte « Conflits de synchronisation » (visible seulement si le module est ouvert).',
          'Dans « À revoir », lisez la pièce : sa nature, le poste, son rang dans le journal, son auteur, puis le « Motif du serveur ».',
          'Vérifiez les faits hors de l’écran : l’encaissement a-t-il vraiment été reçu ? Le reçu a-t-il été imprimé ?',
          'Cliquez sur « Décider », puis choisissez la « Décision » : appliquer la pièce du poste, garder l’état du serveur, la rejeter ou la remplacer.',
          'Écrivez le « Motif (obligatoire, conservé avec la décision) ». Pour une commande correctrice, indiquez son « Identifiant de la commande correctrice ».',
          'Cliquez sur « Enregistrer la décision », saisissez votre mot de passe, puis cliquez sur « Confirmer et reprendre ».',
        ],
        result:
          'Le conflit quitte « À revoir » et apparaît dans « Résolus » avec la décision, son auteur et son motif.',
      },
      {
        id: 'relire-les-decisions',
        title: 'Relire les décisions déjà prises',
        steps: [
          'Cliquez sur « Résolus ».',
          'Lisez sur chaque ligne la « Décision » : sa nature, la personne, la date et le motif.',
        ],
        result: 'Vous retrouvez qui a décidé quoi, quand et pourquoi.',
      },
    ],
    rules: [
      'Cet écran est en validation : il est codé, mais fermé à la cliente tant que l’exploitant n’ouvre pas le module.',
      'Un conflit est une pièce enregistrée sur un poste que le serveur n’a pas pu appliquer telle quelle. Rien n’est écrasé : la pièce du poste reste conservée.',
      'Quatre décisions : appliquer la pièce du poste après vérification, garder l’état du serveur, rejeter la pièce, ou la rejeter et la remplacer par une commande correctrice.',
      'La décision exige un motif, conservé avec elle, et la confirmation de votre mot de passe. Elle ne réécrit jamais la pièce du poste.',
      'Un reçu déjà imprimé et contesté reste une pièce locale : la décision ne le modifie pas et il n’est jamais renuméroté.',
      'Tant qu’un conflit est ouvert, les pièces suivantes du même poste attendent derrière lui.',
    ],
    next: [
      {
        route: 'parametres-poste',
        label: 'Préparer ce poste',
        why: 'Où le poste compte ses pièces et ses conflits.',
      },
      {
        topic: 'depannage-limites',
        label: 'Ce que cette version ne fait pas encore',
      },
      {
        route: 'approbations',
        label: 'Approbations',
        why: 'L’autre écran de décision de la gérante.',
      },
      {
        route: 'parametres',
        label: 'Paramètres',
      },
    ],
    tips: [
      'Prenez le temps de vérifier : « Appliquer la pièce du poste telle quelle (après vérification) » rejoue la pièce comme si le poste avait eu raison.',
      'Les pièces concernées : création ou modification d’un patient, brouillon de facture, émission d’une facture, encaissement, ouverture de caisse.',
      'Dans « Préparer ce poste », l’étape « 5. Synchronisation » compte les conflits à revoir.',
    ],
    problems: [
      {
        symptom: '« Aucun conflit à revoir »',
        remedy:
          'Rien n’attend de décision. Cliquez sur « Résolus » pour relire les décisions passées.',
      },
      {
        symptom: '« Choisissez une décision. »',
        remedy:
          'Ouvrez la liste « Décision » et choisissez l’une des quatre options avant d’enregistrer.',
      },
      {
        symptom: '« Les conflits n’ont pas pu être lus : vérifiez la connexion puis réessayez. »',
        remedy: 'Cliquez de nouveau sur « À revoir » quand la connexion est revenue.',
      },
      {
        symptom: '« Certaines informations sont à corriger. »',
        remedy:
          'Le motif manque ou le serveur refuse un champ : lisez le message sous « Motif (obligatoire, conservé avec la décision) ».',
      },
      {
        symptom: '« Ce compte n’a pas le droit de faire cette opération. »',
        remedy:
          'Seul un compte qui peut décider des autorisations tranche un conflit : voyez la gérante.',
      },
    ],
    terms: ['Brouillon', 'Facture émise', 'Reçu'],
  },
]
