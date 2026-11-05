import type { PageHelp } from '../model'

/**
 * Aide des écrans d’accès et de la coquille, ouverts à tout compte connecté ou publics : connexion,
 * déverrouillage d’un poste, accueil, accès refusé, page introuvable, mot de passe et documentation.
 */
export const PAGES_ACCES: readonly PageHelp[] = [
  {
    route: 'connexion',
    title: 'Connexion',
    module: null,
    anyPermission: [],
    purpose:
      'Chaque personne du cabinet entre dans l’application avec son propre compte. Cet écran s’ouvre seul tant que vous n’êtes pas connecté. Comme il précède la connexion, il n’a pas de panneau d’aide : seule cette fiche l’explique.',
    actions: [
      {
        label: 'Se connecter',
        effect:
          'Vérifie l’identifiant et le mot de passe, ouvre votre session, puis vous amène à l’écran demandé ou à l’accueil.',
      },
    ],
    tasks: [
      {
        id: 'se-connecter',
        title: 'Se connecter à l’application',
        steps: [
          'Saisissez votre « Identifiant », tel que la gérante vous l’a remis.',
          'Saisissez votre « Mot de passe » : à la première connexion, celui que la gérante vous a transmis en personne.',
          'Cliquez sur « Se connecter » ou appuyez sur Entrée.',
        ],
        result:
          'Vous arrivez sur l’écran d’accueil, ou sur l’écran que vous cherchiez avant d’être invité à vous connecter.',
      },
      {
        id: 'corriger-un-refus',
        title: 'Corriger une connexion refusée',
        steps: [
          'Lisez le résumé « Connexion impossible » en haut du formulaire : il dit ce que l’écran ou le serveur refuse.',
          'Ressaisissez votre « Mot de passe » : après un refus, il est vidé, mais votre « Identifiant » reste en place.',
          'Vérifiez l’identifiant lettre par lettre : le serveur ne dit jamais lequel des deux champs est faux.',
          'Après plusieurs refus rapprochés, attendez quelques minutes : le serveur limite les essais pour protéger les comptes.',
        ],
        result:
          'Vous êtes connecté, ou vous savez qu’il faut demander à la gérante de réinitialiser votre mot de passe.',
      },
    ],
    rules: [
      'Chaque compte est nominatif : l’application ne prévoit ni compte commun ni mot de passe universel. Vos droits dépendent du profil de votre compte.',
      'Les deux champs sont obligatoires. Un champ vide est signalé aussitôt, sans interroger le serveur.',
      'La connexion demande le réseau et le serveur. S’ils ne répondent pas, l’écran le dit et ne vous connecte pas.',
      'Après environ 30 minutes sans activité, la session prend fin : l’application vous demande alors de vous reconnecter.',
    ],
    next: [
      {
        topic: 'se-connecter',
        label: 'Se connecter : le guide complet',
      },
      {
        route: 'mot-de-passe',
        label: 'Changer mon mot de passe',
        why: 'À faire dès la première connexion, avec le mot de passe remis par la gérante.',
      },
      {
        route: 'accueil',
        label: 'Accueil',
        why: 'Votre point de départ une fois connecté.',
      },
    ],
    tips: [
      'Sur un poste partagé, quittez toujours avec « Se déconnecter » : la personne suivante n’hérite pas de votre session.',
      'Seule la gérante crée les comptes (« Paramètres », « Personnel », « Créer un compte ») et remet le mot de passe initial.',
    ],
    problems: [
      {
        symptom:
          '« Connexion impossible » avec un message qui dit que l’identifiant ou le mot de passe est incorrect',
        remedy:
          'Vérifiez l’identifiant et ressaisissez le mot de passe. Si vous êtes sûr de vos saisies, demandez à la gérante de vérifier que votre compte est actif : le serveur répond de la même façon pour un compte désactivé.',
      },
      {
        symptom:
          '« Serveur injoignable : la connexion demande le réseau. Réessayez quand la connexion revient. »',
        remedy:
          'Vérifiez la connexion Internet du poste, puis réessayez. L’en-tête indique « En ligne », « Hors ligne » ou « Serveur injoignable ».',
      },
      {
        symptom: 'Un message dit qu’il y a trop de tentatives',
        remedy:
          'Attendez quelques minutes avant de réessayer. Si vous avez oublié votre mot de passe, ne multipliez pas les essais : demandez à la gérante.',
      },
      {
        symptom: '« Mot de passe oublié » (en bas de l’écran)',
        remedy:
          'Demandez à la gérante de le réinitialiser. Celui d’une gérante ne se réinitialise pas dans l’application : sa procédure de secours se fait sur le serveur.',
      },
    ],
  },
  {
    route: 'deverrouiller',
    title: 'Déverrouiller ce poste',
    module: null,
    anyPermission: [],
    maturity: 'validation',
    purpose:
      'Écran en validation : il n’est pas encore ouvert au cabinet. Sur un poste préparé à l’avance, il passe avant la connexion : vous choisissez votre profil et saisissez votre secret local pour ouvrir le coffre chiffré de ce poste.',
    actions: [
      {
        label: 'Déverrouiller',
        effect:
          'Vérifie le profil et le secret local, ouvre le profil sur ce poste, puis vous amène à l’écran demandé ou à l’accueil.',
      },
      {
        label: 'Se connecter au serveur',
        effect: 'Ouvre l’écran « Connexion » ordinaire : le réseau est nécessaire.',
      },
    ],
    tasks: [
      {
        id: 'deverrouiller-un-poste',
        title: 'Déverrouiller un poste préparé',
        steps: [
          'Choisissez votre « Profil » dans la liste : ici, un profil est une personne préparée sur ce poste, avec son nom et son identifiant.',
          'Saisissez votre « Secret local », celui que vous avez choisi lors de la préparation du poste.',
          'Cliquez sur « Déverrouiller ».',
        ],
        result:
          'Votre profil s’ouvre sur ce poste et vous arrivez sur l’accueil, ou sur l’écran que vous cherchiez.',
      },
      {
        id: 'secret-oublie',
        title: 'Retrouver l’accès après un secret oublié',
        steps: [
          'Ne multipliez pas les essais : après plusieurs échecs, l’écran indique l’heure à laquelle un nouvel essai sera admis.',
          'Demandez à la gérante de réinitialiser votre secret local : elle utilise pour cela la clé de récupération du poste.',
          'En attendant, cliquez sur « Se connecter au serveur » pour vous connecter normalement : le réseau est nécessaire.',
        ],
        result: 'Votre secret local est réinitialisé, ou vous travaillez en ligne en attendant.',
      },
    ],
    rules: [
      'Cet écran ne passe avant la connexion que si ce navigateur contient un coffre de poste. Sans coffre, vous arrivez directement sur « Connexion ».',
      'Le secret n’est jamais conservé : le champ est vidé après chaque essai, réussi ou non.',
      'Les tentatives sont limitées. L’échec ne dit pas si le profil ou le secret est faux : « Profil ou secret incorrect. »',
      'Les droits d’un profil viennent d’une autorisation donnée à l’avance sur le serveur, pour une durée limitée (72 heures par défaut). Sans autorisation valable, le profil s’ouvre sans aucun droit.',
      'Un écran qui lit le serveur reste fermé tant que le serveur n’a pas répondu : l’accueil explique alors pourquoi.',
    ],
    next: [
      {
        route: 'connexion',
        label: 'Connexion',
        why: 'Pour vous connecter au serveur plutôt que d’ouvrir le coffre.',
      },
      {
        topic: 'depannage-limites',
        label: 'Ce que cette version ne fait pas encore',
      },
      {
        topic: 'notion-securite',
        label: 'Sécurité des accès et des données',
      },
    ],
    tips: [
      'Cette fiche décrit un écran en validation : tant que la gérante ne vous a pas dit que votre poste est préparé, vous n’avez rien à y faire.',
    ],
    problems: [
      {
        symptom: '« Profil ou secret incorrect. »',
        remedy:
          'Vérifiez le profil choisi, puis ressaisissez le secret : le champ est vidé après chaque essai.',
      },
      {
        symptom: '« Trop de tentatives sur ce profil : réessayez à » suivi d’une heure',
        remedy: 'Attendez cette heure avant de réessayer.',
      },
      {
        symptom: '« Aucun profil sur ce poste »',
        remedy:
          'Ce poste n’a pas encore de profil préparé : cliquez sur « Se connecter au serveur ».',
      },
      {
        symptom: '« Coffre illisible »',
        remedy:
          'Le coffre est endommagé ou écrit par une version plus récente de l’application. Rien n’y est modifié : contactez le support avant toute réinstallation.',
      },
      {
        symptom: '« L’autorisation de ce profil est altérée : préparez-le de nouveau en ligne. »',
        remedy: 'Demandez à la gérante de préparer de nouveau ce profil depuis le serveur.',
      },
    ],
  },
  {
    route: 'accueil',
    title: 'Accueil',
    module: null,
    anyPermission: [],
    purpose:
      'Votre point de départ après la connexion : les chiffres de la journée, puis les actions et les raccourcis de votre travail. Vous ne voyez que les écrans que votre compte a le droit d’ouvrir et dont le module est ouvert.',
    actions: [
      {
        label: 'Actualiser les chiffres',
        effect:
          'Relit sur le serveur les chiffres du jour : file du jour, rendez-vous et encaissé net. L’heure de la lecture s’affiche sous le titre.',
        anyPermission: ['visit.register', 'agenda.read', 'finance.global.read', 'cash.own_session'],
      },
      {
        label: 'Nouveau patient',
        effect: 'Ouvre le formulaire de création d’une fiche patient.',
        anyPermission: ['patient.create'],
      },
      {
        label: 'Nouvelle consultation',
        effect:
          'Ouvre l’écran « Consultations » avec la boîte pour démarrer un examen : patients de la file du jour, ou recherche d’un autre patient.',
        anyPermission: ['clinical.write'],
      },
      {
        label: 'Rechercher',
        effect:
          'Ouvre l’écran « Patients » pour retrouver un patient par son nom, son téléphone ou son numéro de dossier.',
        anyPermission: ['patient.read'],
      },
      {
        label: 'Rendez-vous',
        effect: 'Ouvre le formulaire « Nouveau rendez-vous » de l’agenda.',
        anyPermission: ['agenda.write'],
      },
      {
        label: 'Consultations du jour',
        effect:
          'Ouvre l’écran « Aujourd’hui » : la file du jour, avec les arrivées et l’état de chaque visite.',
        anyPermission: ['visit.register', 'agenda.read'],
      },
      {
        label: 'Statistiques',
        effect:
          'Ouvre les statistiques de l’activité et des examens, selon les droits de votre compte.',
        anyPermission: ['statistics.activity', 'statistics.clinical'],
      },
      {
        label: 'Paramètres',
        effect: 'Ouvre les paramètres : personnel, cabinet et documents, autorisations, exports.',
        anyPermission: ['users.manage', 'approval.decide'],
      },
      {
        label: 'Changer mon mot de passe',
        effect: 'Ouvre l’écran du même nom, pour remplacer le mot de passe remis par la gérante.',
      },
      {
        label: 'Aide : comment utiliser l’application',
        effect:
          'Ouvre la documentation : guides par profil, parcours pas à pas, glossaire et dépannage.',
      },
      {
        label: 'Se déconnecter',
        effect:
          'Quitte l’écran en cours (il peut demander de confirmer une saisie non enregistrée), ferme la session sur le serveur, puis ouvre « Connexion ».',
      },
    ],
    tasks: [
      {
        id: 'lire-les-chiffres',
        title: 'Lire les chiffres du jour',
        anyPermission: ['visit.register', 'agenda.read', 'finance.global.read', 'cash.own_session'],
        steps: [
          'Repérez le bandeau « Aujourd’hui », sous la salutation. Il n’apparaît que si votre compte lit la file du jour, l’agenda ou la caisse.',
          'Lisez « Patients en attente » (arrivés, pas encore pris en charge), « En consultation » et « Visites terminées » : visites du jour, annulées exclues.',
          'Lisez « Rendez-vous » : les rendez-vous du jour, sans les annulés (« Hors rendez-vous annulés »).',
          'Lisez « Encaissé net » : les encaissements du jour, diminués des contre-écritures et des remboursements.',
          'Sous ce chiffre, « Tout le cabinet » ou « Vos encaissements seulement » dit sur quoi il porte : le serveur en décide selon vos droits.',
          'Cliquez sur « Actualiser les chiffres » pour les relire : ils ne se mettent pas à jour seuls. L’heure de lecture est écrite sous le titre.',
          'Pour le détail, utilisez le lien de la tuile : « Voir la file du jour », « Voir l’agenda » ou « Voir la caisse du jour ».',
        ],
        result:
          'Vous savez où en est la journée et vous ouvrez en un clic l’écran qui détaille un chiffre.',
      },
      {
        id: 'ouvrir-son-travail',
        title: 'Ouvrir son travail depuis l’écran d’accueil',
        steps: [
          'Sous « Actions », cliquez sur la carte de votre tâche, par exemple « Nouveau patient », « Nouvelle consultation » ou « Rechercher ». Seules les cartes ouvertes à votre compte apparaissent.',
          'Plus bas, les raccourcis sont rangés par activité : « Accueil des patients », « Examens », « Caisse et ventes » et « Administration ».',
          'Sous « Accueil des patients » : « Patients à rappeler » et « Enregistrer une arrivée ».',
          'Sous « Examens » : « Nouvelle consultation », « Mes examens en cours » et « Examens du jour ».',
          'Sous « Caisse et ventes » : « Caisse », « Nouvelle facture » et « Factures ».',
          'Sous « Administration » : « Personnel », « Cabinet et documents » et « Catalogue ».',
          'Une activité sans raccourci pour votre compte n’est pas affichée : avec les droits par défaut, la caissière ne voit ni « Examens » ni « Administration ».',
        ],
        result:
          'L’écran de votre tâche s’ouvre : chaque carte ou raccourci mène à un écran que votre compte a le droit d’ouvrir.',
      },
      {
        id: 'reprendre-apres-session-expiree',
        title: 'Reprendre son travail après une session expirée',
        steps: [
          'Quand votre session prend fin, l’en-tête affiche « Session expirée : vos saisies sont conservées » et le bouton « Se reconnecter ».',
          'Cliquez sur « Se reconnecter » : une boîte « Session expirée » s’ouvre au-dessus de votre écran, qui reste affiché.',
          'Saisissez votre « Mot de passe » : seul le compte qui travaillait sur cet écran peut se reconnecter ici.',
          'Cliquez sur « Se reconnecter » dans la boîte. Si le serveur ne répond pas, l’écran affiche « Serveur injoignable : réessayez quand la connexion revient. »',
        ],
        result: 'Vous êtes de nouveau connecté et vos saisies sont toujours à l’écran.',
      },
    ],
    rules: [
      'Une carte, un raccourci ou une entrée du menu n’apparaît que si votre compte a le droit d’ouvrir l’écran et si son module est ouvert dans l’application.',
      'Avec les droits par défaut : le profil accueil voit « Nouveau patient » ; la caissière, « Caisse » et « Nouvelle facture » ; le professionnel, « Nouvelle consultation » et « Mes examens en cours ».',
      'Les chiffres du bandeau viennent du serveur, pour le jour du cabinet. Une tuile sans valeur affiche un tiret et sa raison écrite : jamais un zéro inventé, jamais une ancienne valeur.',
      'Une file du jour plus longue que la lecture donne des minimums, signalés par « Au moins ce nombre : file lue en partie ».',
      'Quand la session a expiré ou que le serveur ne répond pas, l’écran d’accueil n’affiche que le message : cartes, raccourcis et chiffres reviennent avec la session.',
      'La déconnexion n’est confirmée qu’une fois la session fermée par le serveur. Sans réponse, la session reste ouverte et l’écran le dit.',
    ],
    next: [
      {
        topic: 'se-reperer',
        label: 'Se repérer : en-tête, menu et boutons',
      },
      {
        topic: 'journee-type',
        label: 'Une journée type au cabinet',
      },
      {
        route: 'mot-de-passe',
        label: 'Changer mon mot de passe',
        why: 'À faire dès la première connexion.',
      },
      {
        route: 'aide',
        label: 'Documentation',
        why: 'Pour tout lire ou chercher un mot.',
      },
    ],
    tips: [
      'Le premier jour, remplacez le mot de passe remis par la gérante avec « Changer mon mot de passe ».',
      'Sous la salutation « Bonjour », suivie de votre nom, la date du jour du cabinet s’écrit en toutes lettres. Après minuit, cliquez sur « Actualiser les chiffres » pour passer au jour suivant.',
      'Le titre de l’en-tête est un lien vers l’accueil, sur tous les écrans.',
      'L’en-tête indique l’état de la connexion : « En ligne », « Hors ligne » ou « Serveur injoignable ». Cette version enregistre sur le serveur : attendez « En ligne » avant de valider une saisie.',
      'Sur un poste partagé, quittez avec « Se déconnecter » : la personne suivante n’hérite pas de votre session.',
    ],
    problems: [
      {
        symptom: '« Aucune action d’accueil ouverte à ce compte »',
        remedy:
          'Votre compte n’a aucune des actions de la liste : utilisez le menu, s’il en propose. Sinon, demandez à la gérante de vous attribuer les droits de votre travail.',
      },
      {
        symptom: '« Aucun module métier livré pour l’instant »',
        remedy:
          'Aucun écran n’est encore ouvert dans l’application. Les modules s’ouvrent à l’installation, sur demande au prestataire : la gérante ne peut pas les ouvrir elle-même.',
      },
      {
        symptom: '« Serveur injoignable » ou « Session non vérifiée »',
        remedy:
          'Le serveur ne répond pas, ou a répondu par une erreur. Vous n’êtes pas déconnecté : l’application réessaie seule au retour du réseau et toutes les 30 secondes.',
      },
      {
        symptom:
          'Une tuile affiche un tiret et une raison, comme « Serveur indisponible pour l’instant » ou « Session à rouvrir »',
        remedy:
          'Reconnectez-vous si l’en-tête le demande, attendez le retour du serveur, puis cliquez sur « Actualiser les chiffres ». « Non autorisé pour ce compte » veut dire que votre compte n’a pas ce droit.',
      },
      {
        symptom:
          '« Déconnexion impossible : le serveur n’a pas confirmé la fermeture. La session reste ouverte sur ce poste ; réessayez quand la connexion revient. »',
        remedy:
          'Réessayez « Se déconnecter » quand le réseau est revenu. Sur un poste partagé, vérifiez que la session est bien fermée avant de laisser la place.',
      },
    ],
    terms: ['File du jour', 'Profil', 'Droit', 'Module'],
  },
  {
    route: 'acces-refuse',
    title: 'Accès refusé',
    module: null,
    anyPermission: [],
    purpose:
      'L’écran demandé existe, mais votre compte n’a pas le droit de l’ouvrir. L’application ne nomme pas le droit manquant : elle propose de revenir à l’accueil, et la gérante peut ouvrir le droit si la tâche fait partie de votre travail.',
    actions: [
      {
        label: 'Revenir à l’accueil',
        effect: 'Ramène à l’accueil, où se trouvent les écrans ouverts à votre compte.',
      },
    ],
    tasks: [
      {
        id: 'revenir-a-un-ecran-ouvert',
        title: 'Revenir à un écran ouvert à votre compte',
        steps: [
          'Cliquez sur « Revenir à l’accueil ».',
          'Choisissez dans le menu ou sur les cartes de l’accueil un écran proposé à votre compte : seuls ceux-là s’ouvrent.',
          'Si la tâche fait partie de votre travail, dites à la gérante quel écran vous vouliez ouvrir et ce que vous vouliez y faire.',
        ],
        result: 'Vous êtes sur l’accueil et vous savez à qui demander le droit manquant.',
      },
      {
        id: 'ouvrir-un-droit',
        title: 'Ouvrir un droit à un compte',
        anyPermission: ['users.manage'],
        steps: [
          'Cliquez sur « Paramètres », puis sur la carte « Personnel », et ouvrez le compte de la personne.',
          'Ouvrez « Droits effectifs » pour voir ce que le compte peut faire : ils viennent de ses profils et des dérogations en cours.',
          'Pour changer de profil, utilisez « Compte et profils », puis « Enregistrer le compte ».',
          'Pour un seul droit, ouvrez « Dérogation de droit » et choisissez le « Droit » et l’« Effet ».',
          'Indiquez le « Motif », puis cliquez sur « Enregistrer la dérogation ».',
          'Si l’application demande votre mot de passe (« Confirmer votre mot de passe »), saisissez-le et cliquez sur « Confirmer et reprendre ».',
        ],
        result:
          'Le serveur applique le droit tout de suite ; la personne le voit après avoir rechargé la page.',
      },
    ],
    rules: [
      'Les droits d’un compte viennent de son profil (gérante, accueil, professionnel ou caissière) et des dérogations que la gérante a posées sur ce compte.',
      'Une adresse inconnue, ou dont le module n’est pas ouvert, mène à « Page introuvable » et non à cet écran.',
      'Le serveur revérifie chaque action : taper une adresse à la main n’ouvre jamais plus que ce que votre compte permet.',
      'La gestion du personnel reste réservée à la gérante : elle ne se délègue pas par une dérogation.',
      'La page ne nomme pas le droit manquant : dites à la gérante quel écran ou quelle action vous cherchiez.',
    ],
    next: [
      {
        route: 'accueil',
        label: 'Accueil',
        why: 'Pour retrouver les écrans ouverts à votre compte.',
      },
      {
        topic: 'profils',
        label: 'Qui peut faire quoi : les profils et leurs droits',
      },
      {
        topic: 'notion-securite',
        label: 'Sécurité des accès et des données',
      },
      {
        route: 'parametres-personnel',
        label: 'Personnel',
        why: 'Pour la gérante : régler les profils et les droits d’un compte.',
      },
    ],
    tips: [
      'Les cartes et le menu de l’accueil ne montrent que des écrans que votre compte peut ouvrir : passer par eux évite cet écran.',
      'Un changement de droits apparaît dans le menu après un rechargement de la page ou une nouvelle connexion.',
    ],
    problems: [
      {
        symptom:
          '« Ce compte n’a pas le droit d’ouvrir cette page » alors que la tâche fait partie de votre travail',
        remedy:
          'Notez l’écran et ce que vous vouliez faire, puis demandez à la gérante. Elle règle vos droits dans « Paramètres », « Personnel ».',
      },
      {
        symptom: 'Vous attendiez « Accès refusé » et vous voyez « Page introuvable »',
        remedy:
          'Le module de l’écran n’est pas ouvert dans l’application, ce qui répond comme une adresse inconnue : prévenez la gérante, qui contactera le prestataire.',
      },
    ],
    terms: ['Droit', 'Profil'],
  },
  {
    route: 'introuvable',
    title: 'Page introuvable',
    module: null,
    anyPermission: [],
    purpose:
      'L’adresse ouverte ne mène à aucun écran de l’application. Les causes fréquentes : une adresse mal saisie ou ancienne, ou un écran dont le module n’est pas ouvert, qui répond de la même façon.',
    actions: [
      {
        label: 'Retour à l’accueil',
        effect: 'Ramène à l’accueil pour retrouver les écrans de votre compte.',
      },
    ],
    tasks: [
      {
        id: 'retrouver-l-ecran-cherche',
        title: 'Retrouver l’écran que vous cherchiez',
        steps: [
          'Lisez l’adresse dans la barre du navigateur : une faute de frappe ou un lien ancien la rend fausse.',
          'Cliquez sur « Retour à l’accueil », puis ouvrez l’écran par le menu ou par les cartes de l’accueil.',
          'Si l’écran n’apparaît nulle part, son module n’est probablement pas ouvert : prévenez la gérante, qui contactera le prestataire.',
        ],
        result:
          'Vous atteignez l’écran par son chemin normal, ou vous savez que son module est fermé.',
      },
    ],
    rules: [
      'Un écran dont le module n’est pas ouvert répond « Page introuvable », comme une adresse inconnue : aucun écran vide ne s’ouvre.',
      'La liste des modules ouverts appartient à l’installation de l’application : la gérante ne peut pas l’ouvrir depuis les paramètres du cabinet.',
      'Un compte sans droit sur un écran existant et ouvert voit « Accès refusé », pas « Page introuvable ».',
      'Sans session, une adresse inconnue vous mène à « Connexion » : cet écran n’apparaît qu’une fois connecté.',
    ],
    next: [
      {
        route: 'accueil',
        label: 'Accueil',
      },
      {
        topic: 'notion-modules',
        label: 'Les modules : ce qui est ouvert, et pourquoi',
      },
      {
        topic: 'depannage-messages',
        label: 'Comprendre les messages de l’application',
      },
    ],
    tips: [
      'Évitez de saisir une adresse à la main : le menu et les cartes de l’accueil mènent toujours à des écrans qui existent.',
      'L’adresse d’une fiche ou d’une facture contient un identifiant de 26 caractères : copiée incomplète, elle mène ici.',
    ],
    problems: [
      {
        symptom:
          '« Cette adresse ne correspond à aucun écran de l’application. » après un clic sur un lien de l’application',
        remedy:
          'Le module de cet écran n’est pas ouvert. Notez le nom de l’écran, prévenez la gérante, qui contactera le prestataire, et revenez par « Retour à l’accueil ».',
      },
      {
        symptom: 'L’adresse d’un atelier ou d’une communication mène ici',
        remedy:
          'Ces modules ne sont pas disponibles dans cette version : aucun écran n’existe pour eux.',
      },
    ],
    terms: ['Module'],
  },
  {
    route: 'mot-de-passe',
    title: 'Changer mon mot de passe',
    module: null,
    anyPermission: [],
    purpose:
      'Remplacez le mot de passe de votre compte par un mot de passe personnel. C’est le premier geste de votre première journée, quand la gérante vous a remis un mot de passe initial.',
    actions: [
      {
        label: 'Changer le mot de passe',
        effect:
          'Contrôle les trois champs, change le mot de passe sur le serveur et garde votre session ouverte.',
      },
    ],
    tasks: [
      {
        id: 'changer-son-mot-de-passe',
        title: 'Changer son mot de passe',
        steps: [
          'Saisissez votre « Mot de passe actuel » : celui avec lequel vous êtes connecté, ou le mot de passe initial remis par la gérante.',
          'Saisissez le « Nouveau mot de passe » : 12 caractères au moins, avec des lettres et des chiffres, différent de votre identifiant.',
          'Saisissez la « Confirmation du nouveau mot de passe » : exactement le même texte.',
          'Cliquez sur « Changer le mot de passe ».',
        ],
        result:
          'L’écran affiche « Mot de passe changé sur le serveur ». Votre session reste ouverte ; vos autres sessions ont été fermées.',
      },
      {
        id: 'reponse-incertaine',
        title: 'Vérifier le mot de passe quand le serveur n’a pas répondu',
        steps: [
          'Si l’écran affiche « Mot de passe non changé » et dit que le serveur n’a pas répondu, ne recommencez pas tout de suite.',
          'Quand la connexion est revenue, cliquez sur « Se déconnecter » dans l’en-tête.',
          'Reconnectez-vous d’abord avec le nouveau mot de passe ; s’il est refusé, avec l’ancien, puis refaites le changement.',
        ],
        result: 'Vous savez quel mot de passe est en vigueur, et le changement est fait.',
      },
    ],
    rules: [
      'Le nouveau mot de passe compte 12 caractères au moins et 72 octets au plus (environ 70 caractères sans accent), avec des lettres et des chiffres.',
      'Il doit différer de votre identifiant et de l’actuel, et la confirmation doit être identique : sinon l’écran refuse sans interroger le serveur.',
      'Seul le serveur vérifie le mot de passe actuel. S’il est faux, le message s’affiche sous le champ et celui-ci est vidé.',
      'Votre session reste ouverte ; les sessions de votre compte sur d’autres postes ou navigateurs sont fermées par le serveur.',
      'Les trois champs ne sont ni conservés ni réaffichés. Le serveur ne garde qu’une empreinte du mot de passe : la gérante ne peut pas le relire, seulement le réinitialiser.',
    ],
    next: [
      {
        route: 'accueil',
        label: 'Accueil',
      },
      {
        topic: 'se-connecter',
        label: 'Se connecter : première connexion, mot de passe oublié',
      },
      {
        topic: 'notion-securite',
        label: 'Sécurité des accès et des données',
      },
    ],
    tips: [
      'Choisissez une phrase que vous retenez, avec un chiffre : douze caractères se retiennent mieux en plusieurs mots.',
      'Ne communiquez votre mot de passe à personne, pas même à la gérante : elle peut le réinitialiser sans le connaître.',
      'Mot de passe oublié : la gérante le réinitialise dans « Personnel » (« Réinitialiser le mot de passe ») et vous en remet un nouveau en personne ; changez-le dès votre connexion.',
    ],
    problems: [
      {
        symptom:
          'Un message rouge sous « Nouveau mot de passe », comme « Le mot de passe contient des lettres et des chiffres. » ou « Le mot de passe est différent de l’identifiant. »',
        remedy:
          'Corrigez le nouveau mot de passe : douze caractères au moins, au moins une lettre et un chiffre, et pas votre identifiant.',
      },
      {
        symptom: '« La confirmation est différente du nouveau mot de passe. »',
        remedy: 'Retapez la confirmation à l’identique du nouveau mot de passe.',
      },
      {
        symptom: '« Le nouveau mot de passe est différent de l’actuel. »',
        remedy: 'Choisissez un mot de passe que vous n’utilisez pas déjà.',
      },
      {
        symptom: '« Votre session a pris fin : reconnectez-vous, puis recommencez. »',
        remedy:
          'Cliquez sur « Se reconnecter » dans l’en-tête, ou connectez-vous de nouveau, puis refaites le changement.',
      },
      {
        symptom: '« Trop d’essais : patientez une minute avant de recommencer. »',
        remedy: 'Attendez une minute, puis recommencez en vérifiant votre mot de passe actuel.',
      },
    ],
  },
  {
    route: 'aide',
    title: 'Documentation',
    module: null,
    anyPermission: [],
    purpose:
      'Toute la documentation de l’application, à lire sans formation : démarrer, parcours de bout en bout, guides par profil, notions, glossaire et dépannage. Cherchez un mot, parcourez le sommaire ou ouvrez la fiche d’un écran.',
    actions: [
      {
        label: 'Aide : comment utiliser l’application',
        effect: 'Lien de l’accueil qui ouvre cette documentation.',
      },
      {
        label: 'Aide',
        effect:
          'Dans l’en-tête : ouvre l’aide de l’écran où vous êtes, avec un lien vers toute la documentation.',
      },
      {
        label: 'Sommaire',
        effect:
          'Liste les parties et les rubriques : cliquez sur un titre pour aller directement à la rubrique.',
      },
      {
        label: 'Revenir à l’accueil',
        effect: 'Ramène à l’écran d’accueil.',
      },
    ],
    tasks: [
      {
        id: 'chercher-un-mot',
        title: 'Chercher un mot ou une question',
        steps: [
          'Ouvrez la documentation avec « Aide : comment utiliser l’application » sur l’accueil, ou avec « Aide » dans l’en-tête puis le lien vers toute la documentation.',
          'Cliquez dans le champ de recherche et saisissez un ou deux mots : un nom d’écran, un bouton, un terme comme reçu ou avoir.',
          'Peu importent les accents et les majuscules. Chaque mot saisi doit se retrouver dans le résultat ; un mot compte au moins deux lettres.',
          'Parcourez les résultats et cliquez sur celui qui répond à votre question : la rubrique ou la fiche d’écran s’ouvre.',
        ],
        result: 'La rubrique ou la fiche de l’écran s’ouvre.',
      },
      {
        id: 'parcourir-le-sommaire',
        title: 'Parcourir la documentation par le sommaire',
        steps: [
          'Dans le « Sommaire », repérez la partie qui vous concerne : démarrer, parcours pas à pas, guides par profil, notions et règles, glossaire, dépannage.',
          'Pour apprendre votre métier dans l’outil, ouvrez le guide de votre profil : accueil, professionnel, caissière ou gérante.',
          'Pour une tâche précise (accueillir un patient, facturer, ouvrir la caisse), prenez le parcours pas à pas : il suit l’ordre du travail réel.',
          'Un mot inconnu ? Le glossaire explique les termes d’optique et de gestion. Un message d’erreur ? Le dépannage les explique.',
          'À la fin d’une rubrique, les liens mènent aux rubriques voisines et aux écrans concernés.',
        ],
        result: 'Vous trouvez le guide ou le parcours de votre travail.',
      },
      {
        id: 'lire-la-fiche-d-un-ecran',
        title: 'Lire la fiche d’un écran ou voir l’aide comme un autre profil',
        steps: [
          'Dans la référence des écrans, choisissez un écran : sa fiche est celle du panneau d’aide de cet écran.',
          'Une fiche suit toujours le même ordre : où vous êtes, ce que vous pouvez faire, pas à pas, comment ça marche, ensuite, à savoir, si ça ne marche pas.',
          'Pour voir la documentation comme un autre profil la voit (la caissière, par exemple), utilisez le choix du profil.',
          'La partie mise en service apparaît seulement si votre compte gère le personnel : c’est la préparation de la gérante avant l’ouverture.',
        ],
        result:
          'Vous lisez la fiche d’un écran, ou la documentation telle qu’un autre profil la voit.',
      },
    ],
    rules: [
      'Comme le menu, la documentation ne montre que les rubriques et les écrans de votre compte : le droit et le module ouvert comptent tous les deux.',
      'La partie mise en service est réservée aux comptes qui gèrent le personnel : c’est la préparation de la gérante et du prestataire avant l’ouverture au cabinet.',
      'Un libellé entre guillemets français est celui d’un bouton, d’un champ ou d’un message de l’application, recopié exactement.',
      'Une fiche d’écran n’est écrite qu’une fois : le panneau d’aide de l’écran et la référence des écrans affichent le même texte.',
      'La documentation décrit ce que l’application fait aujourd’hui. Une fonction pas encore ouverte est marquée comme telle, et ce qui n’existe pas est dit dans la rubrique des limites.',
    ],
    next: [
      {
        topic: 'bienvenue',
        label: 'Bienvenue : à quoi sert l’application',
      },
      {
        topic: 'se-reperer',
        label: 'Se repérer : en-tête, menu et boutons',
      },
      {
        topic: 'depannage-questions',
        label: 'Questions fréquentes',
      },
      {
        route: 'accueil',
        label: 'Accueil',
      },
    ],
    tips: [
      'Pour une action précise, le panneau d’aide de l’écran est le plus rapide ; la documentation sert à comprendre ou à apprendre.',
      'La gérante peut lire les guides des quatre profils pour savoir ce que verra chaque membre de l’équipe avant d’ouvrir l’outil.',
      'Les termes d’optique (sphère, cylindre, axe) sont expliqués au glossaire et à leur première apparition dans une rubrique.',
    ],
    problems: [
      {
        symptom: 'La recherche ne trouve rien',
        remedy:
          'Saisissez moins de mots, ou un seul : chaque mot doit se retrouver dans le résultat. Essayez le nom de l’écran ou du bouton.',
      },
      {
        symptom: 'Un écran ou une rubrique manque dans la liste',
        remedy:
          'Votre compte n’a pas le droit de l’ouvrir, ou son module n’est pas ouvert : la documentation suit les mêmes règles que le menu.',
      },
      {
        symptom: 'La partie mise en service est absente',
        remedy: 'Elle est réservée aux comptes qui gèrent le personnel, donc à la gérante.',
      },
      {
        symptom: 'Une rubrique cite un bouton que vous ne voyez pas à l’écran',
        remedy:
          'Le bouton dépend d’un droit ou d’un module ouvert. Demandez à la gérante si cette tâche fait partie de votre travail.',
      },
    ],
    terms: ['Profil', 'Droit', 'Module'],
  },
]
