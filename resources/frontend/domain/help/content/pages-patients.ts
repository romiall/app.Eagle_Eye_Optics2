import type { PageHelp } from '../model'

/**
 * Aide des écrans du module patients : liste, création, dossier, modification, activité, fusion.
 * Les deux premières fiches servent de modèle de rédaction : voir docs/implementation/help.md.
 */
export const PAGES_PATIENTS: readonly PageHelp[] = [
  {
    route: 'patients',
    title: 'Patients',
    module: 'patients',
    anyPermission: ['patient.read'],
    purpose:
      'C’est ici que tout commence : retrouvez la fiche d’un patient avant de l’accueillir, de l’examiner ou de lui facturer quelque chose. Vous cherchez par le nom, le téléphone ou le numéro de dossier.',
    actions: [
      {
        label: 'Rechercher',
        effect:
          'Affiche les fiches qui correspondent à ce que vous avez saisi dans « Rechercher un patient ».',
      },
      {
        label: 'Nouveau patient',
        effect: 'Ouvre le formulaire de création d’une fiche.',
        anyPermission: ['patient.create'],
      },
      {
        label: 'Créer un patient',
        effect:
          'Même formulaire, proposé à la place des résultats quand la recherche ne trouve personne.',
        anyPermission: ['patient.create'],
      },
      {
        label: 'Créer un nouveau patient',
        effect: 'Même formulaire, proposé sous les résultats quand le patient ne s’y trouve pas.',
        anyPermission: ['patient.create'],
      },
      {
        label: 'Page suivante',
        effect: 'Affiche les 25 résultats suivants ; « Page précédente » revient en arrière.',
      },
      {
        label: 'Réessayer',
        effect: 'Relance la recherche quand le serveur n’a pas répondu.',
      },
    ],
    tasks: [
      {
        id: 'retrouver-un-patient',
        title: 'Retrouver un patient',
        steps: [
          'Saisissez au moins 2 caractères dans « Rechercher un patient » : un nom, un téléphone ou un numéro de dossier comme EE-2026-0001.',
          'Appuyez sur Entrée ou cliquez sur « Rechercher ».',
          'Cliquez sur le nom du patient dans les résultats pour ouvrir sa fiche.',
        ],
        result:
          'Vous arrivez sur le dossier du patient, onglet « Identité ». L’onglet « Activité » donne ses visites, examens, ordonnances et factures selon vos droits.',
      },
      {
        id: 'creer-apres-verification',
        title: 'Créer un patient qui n’existe pas encore',
        anyPermission: ['patient.create'],
        steps: [
          'Lancez d’abord une recherche par le nom, puis par le téléphone : si la fiche existe, ouvrez-la au lieu d’en créer une seconde.',
          'Si la liste ne montre pas le patient, cliquez sur « Créer un nouveau patient » sous les résultats.',
          'Si la recherche affiche « Aucun résultat », cliquez sur « Créer un patient ». « Nouveau patient » en haut de l’écran ouvre le même formulaire.',
        ],
        result: 'Le formulaire « Nouveau patient » s’ouvre : voir l’aide de cet écran.',
      },
    ],
    rules: [
      'La recherche ne se lance qu’à partir de 2 caractères, par Entrée ou par le bouton « Rechercher ». Les résultats s’affichent par pages de 25.',
      'Elle ne tient compte ni des majuscules ni des accents, ni de l’ordre des mots, et accepte un téléphone national ou international.',
      'Plusieurs patients peuvent partager un même téléphone (une famille) : la liste les montre tous.',
      'Sans réponse du serveur, l’écran dit « Recherche serveur indisponible » : ce n’est jamais « Aucun résultat ». Réessayez avant de créer une fiche.',
      'Le texte cherché n’apparaît jamais dans l’adresse du navigateur. Il est gardé le temps de la session pour revenir de la fiche à la liste.',
      'Une fiche archivée reste dans la liste, avec la pastille « Fiche archivée ». Une fiche absorbée par une fusion n’y figure plus : on la rejoint depuis la fiche conservée.',
    ],
    next: [
      {
        route: 'patient-nouveau',
        label: 'Nouveau patient',
        why: 'Quand la recherche ne trouve personne.',
      },
      {
        route: 'arrivee',
        label: 'Enregistrer une arrivée',
        why: 'Quand le patient se présente au cabinet.',
      },
      {
        topic: 'parcours-accueillir',
        label: 'Accueillir un patient, de la recherche à la file du jour',
      },
    ],
    tips: [
      'Cherchez aussi par téléphone avant de créer une fiche : un patient déjà venu se retrouve souvent plus vite ainsi.',
      'Le numéro de dossier (EE-AAAA-NNNN) est celui que le patient peut avoir sur un ancien reçu ou une ordonnance.',
    ],
    problems: [
      {
        symptom: '« Saisissez au moins 2 caractères »',
        remedy: 'Complétez votre saisie : la recherche ne part pas avec un seul caractère.',
      },
      {
        symptom: '« Aucun résultat »',
        remedy:
          'Vérifiez l’orthographe, essayez le téléphone ou le numéro de dossier. Créez la fiche seulement si le patient n’existe vraiment pas.',
      },
      {
        symptom: '« Recherche serveur indisponible »',
        remedy:
          'Le serveur n’a pas répondu : cela ne prouve pas que le patient n’existe pas. Cliquez sur « Réessayer » avant de créer une fiche.',
      },
    ],
    terms: ['Numéro de dossier'],
  },
  {
    route: 'patient-nouveau',
    title: 'Nouveau patient',
    module: 'patients',
    anyPermission: ['patient.create'],
    purpose:
      'Créez la fiche d’un patient qui vient pour la première fois. Son identité, saisie une seule fois ici, est reprise ensuite par l’arrivée, l’examen, les ordonnances et les factures : vous ne la ressaisissez jamais.',
    actions: [
      {
        label: 'Enregistrer le patient',
        effect:
          'Contrôle les champs, cherche les fiches qui ressemblent, puis crée la fiche et lui donne son numéro de dossier.',
      },
      {
        label: 'Annuler',
        effect: 'Revient à la liste des patients sans rien enregistrer.',
      },
      {
        label: 'chercher dans la liste',
        effect: 'Ouvre la recherche pour vérifier que le patient n’existe pas déjà.',
        anyPermission: ['patient.read'],
      },
      {
        label: 'Créer quand même',
        effect:
          'Dans la fenêtre des fiches proches : crée la fiche malgré la ressemblance, quand c’est bien une autre personne.',
      },
      {
        label: 'Revenir au formulaire',
        effect: 'Ferme la fenêtre des fiches proches pour corriger ou abandonner la saisie.',
      },
      {
        label: 'Réessayer l’enregistrement',
        effect:
          'Renvoie la même saisie, sans créer deux fiches, quand l’enregistrement n’est pas confirmé.',
      },
    ],
    tasks: [
      {
        id: 'creer-une-fiche',
        title: 'Créer une fiche patient',
        steps: [
          'Vérifiez d’abord, avec « chercher dans la liste », que le patient n’existe pas déjà.',
          'Remplissez « Nom » (obligatoire) et « Prénom(s) », choisissez le « Sexe » et saisissez la « Date de naissance » (JJ/MM/AAAA ou 8 chiffres).',
          'Saisissez le « Téléphone principal ». Le « Téléphone secondaire », l’adresse et la profession sont facultatifs.',
          'Cliquez sur « Enregistrer le patient ».',
          'Si l’écran affiche « Des fiches ressemblent à ce patient », comparez-les avec le patient. « Ouvrir la fiche » l’ouvre dans un nouvel onglet.',
          'Choisissez « Revenir au formulaire » si c’est le même patient, « Créer quand même » si c’est une autre personne.',
        ],
        result:
          'La fiche est créée avec son numéro de dossier (EE-AAAA-NNNN) et vous arrivez sur le dossier du patient.',
      },
      {
        id: 'date-ou-telephone-inconnus',
        title: 'Enregistrer un patient dont la date de naissance ou le téléphone est inconnu',
        steps: [
          'Laissez le champ vide.',
          'Remplissez la raison qui apparaît dessous : « Raison de l’absence de date de naissance » ou « Raison de l’absence de téléphone ».',
          'Cliquez sur « Enregistrer le patient ».',
        ],
        result:
          'La fiche indique « âge non renseigné » : aucune date ni aucun numéro n’est inventé.',
      },
    ],
    rules: [
      'Seul le nom est toujours obligatoire. Une date de naissance ou un téléphone absent s’explique par une raison.',
      'Une date de naissance dans le futur est refusée.',
      'Un même téléphone peut servir à plusieurs patients : ce n’est pas une erreur.',
      'Si une fiche ressemble déjà, l’écran vous la montre : aucune fiche n’est jamais fusionnée automatiquement, c’est vous qui décidez de créer ou non.',
      'Le numéro de dossier est attribué par le serveur à l’enregistrement.',
    ],
    next: [
      {
        route: 'arrivee',
        label: 'Enregistrer une arrivée',
        why: 'Si le patient est là pour un examen ou un achat.',
      },
      {
        route: 'agenda',
        label: 'Agenda',
        why: 'Pour lui donner un rendez-vous.',
      },
      {
        topic: 'notion-patient',
        label: 'Comprendre le dossier patient et l’identité',
      },
    ],
    tips: [
      'Un patient mineur se crée comme un adulte : saisissez sa propre date de naissance.',
      'Un nom saisi avec une faute se corrige ensuite depuis la fiche (« Modifier ») : l’ancienne valeur reste conservée dans le journal d’audit.',
    ],
    problems: [
      {
        symptom: '« Des fiches ressemblent à ce patient »',
        remedy:
          'Comparez avec les fiches proposées. « Revenir au formulaire » pour corriger ou abandonner, « Créer quand même » seulement si c’est bien une autre personne.',
      },
      {
        symptom: '« Vérification des doublons impossible »',
        remedy:
          'Le serveur n’a pas pu chercher les fiches proches. Revenez au formulaire et réessayez dans un instant ; ne créez sans vérification qu’en cas de nécessité, puis contrôlez la liste.',
      },
      {
        symptom: 'Un message rouge sous un champ',
        remedy:
          'Corrigez le champ indiqué (par exemple « Le nom est obligatoire. ») : le résumé en haut de l’écran les liste tous.',
      },
      {
        symptom: '« Enregistrement non confirmé »',
        remedy:
          'La fiche a pu être créée. Cliquez sur « Réessayer l’enregistrement » sans fermer l’écran : la même saisie est renvoyée, sans créer deux fiches.',
      },
      {
        symptom: '« Session expirée »',
        remedy:
          'Cliquez sur « Se reconnecter » dans l’en-tête : votre saisie est conservée. Puis cliquez sur « Réessayer l’enregistrement ».',
      },
    ],
    terms: ['Numéro de dossier', 'Doublon'],
  },
  {
    route: 'patient',
    title: 'Dossier patient',
    module: 'patients',
    anyPermission: ['patient.read'],
    purpose:
      'Voici le dossier d’un patient : son identité, son contact et son numéro de dossier. Les boutons du haut (arrivée, facture, modification) dépendent de vos droits ; les onglets ouvrent son activité et, pour les comptes cliniques, ses ordonnances externes.',
    actions: [
      {
        label: 'Enregistrer une arrivée',
        effect:
          'Ouvre l’arrivée avec ce patient déjà choisi : examen, achat direct, retrait de commande ou contrôle de suivi.',
        anyPermission: ['visit.register'],
      },
      {
        label: 'Créer une facture',
        effect: 'Ouvre une nouvelle facture au nom de ce patient, sans le ressaisir.',
        anyPermission: ['invoice.create', 'exam_fee.collect'],
      },
      {
        label: 'Modifier',
        effect:
          'Ouvre le formulaire pour corriger l’identité ou le contact : voir l’aide de l’écran « Modifier le patient ».',
        anyPermission: ['patient.update'],
      },
      {
        label: 'Exporter le dossier',
        effect:
          'Demande l’archive du dossier (votre mot de passe peut être demandé) ; elle se télécharge ensuite depuis « Exports ».',
        anyPermission: ['clinical.export'],
      },
      {
        label: 'Fusionner avec une autre fiche',
        effect:
          'Ouvre l’écran de fusion pour réunir cette fiche en double avec la fiche à conserver. Réservé à la gérante.',
        anyPermission: ['patient.merge'],
      },
      {
        label: 'Activité',
        effect:
          'Onglet : ouvre l’historique du patient (visites et, selon vos droits, examens, ordonnances, pièces financières).',
      },
      {
        label: 'Prescriptions',
        effect:
          'Onglet des comptes cliniques : ouvre les ordonnances externes transcrites pour ce patient.',
        anyPermission: ['clinical.read'],
      },
      {
        label: 'Retour aux patients',
        effect: 'Revient à la liste de recherche, où votre dernière recherche est gardée.',
      },
      {
        label: 'Ouvrir la fiche conservée',
        effect: 'Sur une fiche fusionnée : ouvre la fiche qui l’a absorbée.',
      },
      {
        label: 'Réessayer',
        effect: 'Relit la fiche quand le serveur n’a pas répondu.',
      },
    ],
    tasks: [
      {
        id: 'accueillir-ou-facturer',
        title: 'Accueillir ou facturer un patient depuis son dossier',
        anyPermission: ['visit.register', 'invoice.create', 'exam_fee.collect'],
        steps: [
          'Contrôlez le nom, le numéro de dossier et la date de naissance dans le bandeau du haut et dans la carte « Identité ».',
          'Si le patient vient pour un examen, un achat ou un retrait, cliquez sur « Enregistrer une arrivée » : il rejoint la file du jour.',
          'S’il faut le facturer, cliquez sur « Créer une facture » : le patient est déjà choisi, vous ne le ressaisissez pas.',
          'Si une information est fausse ou manque, cliquez sur « Modifier » : voir l’aide de l’écran « Modifier le patient ».',
        ],
        result:
          'Vous poursuivez sur l’écran d’arrivée, de facture ou de modification, avec l’identité du patient déjà reprise.',
      },
      {
        id: 'exporter-le-dossier',
        title: 'Exporter le dossier d’un patient',
        anyPermission: ['clinical.export'],
        steps: [
          'Descendez à la carte « Dossier » et cliquez sur « Exporter le dossier ».',
          'Si la fenêtre « Confirmer votre mot de passe » s’ouvre, saisissez votre « Mot de passe », puis cliquez sur « Confirmer et reprendre ».',
          'Attendez le message « Export demandé : le serveur le prépare. » ; la préparation prend quelques minutes.',
          'Cliquez sur « Le télécharger depuis Exports ».',
          'Sur « Exports », repérez la ligne « Dossier d’un patient » et cliquez sur « Actualiser la liste » jusqu’à voir « Prêt à télécharger ».',
          'Cliquez sur « Télécharger l’archive » : elle reste disponible 48 heures.',
        ],
        result:
          'Vous obtenez une archive privée du dossier. Elle contient des données de santé : conservez-la de façon sécurisée.',
      },
      {
        id: 'rejoindre-la-fiche-conservee',
        title: 'Rejoindre la fiche conservée après une fusion',
        steps: [
          'Si l’écran affiche « Cette fiche a été fusionnée dans une autre », cliquez sur « Ouvrir la fiche conservée ».',
          'Sur la fiche conservée, le bandeau « Cette fiche réunit d’autres fiches fusionnées » liste les anciens numéros de dossier.',
          'Cliquez sur « voir la fiche absorbée » pour relire une ancienne fiche, ou ouvrez l’onglet « Activité » pour voir l’activité réunie.',
        ],
        result:
          'Vous travaillez sur la fiche conservée, qui porte l’identité et l’historique réunis du patient.',
      },
    ],
    rules: [
      'Cet écran ne montre que l’identité administrative : aucune donnée clinique, aucun prix d’achat. Les examens et les ordonnances se lisent ailleurs, selon vos droits.',
      'Un champ vide s’affiche « Non renseigné », avec la raison saisie quand il y en a une. Sans date de naissance, l’âge est « âge non renseigné » : aucune date n’est inventée.',
      'Les boutons du haut ne s’affichent que si votre profil en a le droit et si la fonction est ouverte au cabinet. Sur une fiche archivée ou fusionnée, arrivée, facture et modification disparaissent.',
      'Le bas de l’écran indique l’heure de réponse du serveur (« Données du serveur au … »). Sans réponse, la fiche est « Fiche indisponible », jamais une ancienne copie présentée comme à jour.',
      'Cette version n’a aucun bouton pour supprimer une fiche. Une erreur se corrige avec « Modifier » ; un patient enregistré deux fois se réunit par une fusion, réservée à la gérante.',
      'Le numéro de dossier est attribué à la création et ne change jamais. La carte « Dossier » donne aussi la date de création et la « Dernière modification ».',
    ],
    next: [
      {
        route: 'arrivee',
        label: 'Enregistrer une arrivée',
        why: 'Quand le patient se présente au cabinet.',
      },
      {
        topic: 'parcours-vente',
        label: 'Vendre : de la facture à l’encaissement',
        why: 'Pour facturer ce patient.',
      },
      {
        route: 'parametres-exports',
        label: 'Exports',
        why: 'Pour télécharger l’archive d’un dossier exporté.',
      },
      {
        topic: 'notion-patient',
        label: 'Comprendre le dossier patient et l’identité',
      },
    ],
    tips: [
      'Par défaut : la gérante voit tous les boutons ; l’accueil enregistre l’arrivée et modifie ; le professionnel enregistre l’arrivée et exporte le dossier ; la caissière crée la facture.',
      'L’onglet « Prescriptions » n’existe que pour les comptes cliniques (gérante, professionnel) : l’accueil et la caissière ne voient que « Identité » et « Activité ».',
      'Pour revenir à votre recherche, cliquez sur « Retour aux patients » : le texte cherché est gardé le temps de la session.',
    ],
    problems: [
      {
        symptom: '« Fiche indisponible »',
        remedy:
          'Le serveur n’a pas répondu. Cliquez sur « Réessayer » ; si le message revient, vérifiez la connexion Internet du poste avant de continuer.',
      },
      {
        symptom: '« Fiche introuvable »',
        remedy:
          'Ce dossier n’existe pas ou n’est plus accessible. Cliquez sur « Retour aux patients » et cherchez le patient par son nom, son téléphone ou son numéro de dossier.',
      },
      {
        symptom: '« Session expirée »',
        remedy:
          'Cliquez sur « Se reconnecter » dans l’en-tête, puis sur « Réessayer » : la fiche se relit.',
      },
      {
        symptom: '« Droits insuffisants »',
        remedy:
          'Ce compte n’a pas le droit de consulter cette fiche. Demandez à la gérante de vérifier les droits de votre compte.',
      },
      {
        symptom:
          'Un bouton attendu (« Modifier », « Créer une facture », « Enregistrer une arrivée ») n’apparaît pas',
        remedy:
          'Il dépend de votre profil, des fonctions ouvertes au cabinet et de l’état de la fiche : une fiche archivée ou fusionnée ne l’offre plus. Demandez à la gérante.',
      },
    ],
    terms: ['Numéro de dossier', 'Visite', 'Ordonnance externe'],
  },
  {
    route: 'patient-modifier',
    title: 'Modifier le patient',
    module: 'patients',
    anyPermission: ['patient.update'],
    purpose:
      'Corrigez l’identité ou le contact d’un patient déjà enregistré. Seuls les champs que vous changez sont enregistrés. Si quelqu’un d’autre a modifié la fiche pendant votre saisie, rien n’est écrasé en silence : l’écran vous le signale.',
    actions: [
      {
        label: 'Enregistrer les modifications',
        effect:
          'Contrôle les champs puis enregistre seulement ceux que vous avez changés ; vous revenez ensuite sur le dossier.',
      },
      {
        label: 'Annuler',
        effect:
          'Revient au dossier sans rien enregistrer ; le navigateur demande confirmation si des saisies ne sont pas enregistrées.',
      },
      {
        label: 'Recharger la fiche',
        effect:
          'Relit la fiche après « La fiche a changé entre-temps » et reporte vos modifications sur la version actuelle.',
      },
      {
        label: 'Réessayer l’enregistrement',
        effect:
          'Renvoie la même saisie, sans doublon, quand l’enregistrement n’est pas confirmé ou que la session a expiré.',
      },
      {
        label: 'Réessayer',
        effect: 'Relit la fiche quand le serveur n’a pas répondu à l’ouverture de l’écran.',
      },
    ],
    tasks: [
      {
        id: 'corriger-une-information',
        title: 'Corriger une information de la fiche',
        steps: [
          'Ouvrez le dossier du patient, puis cliquez sur « Modifier ».',
          'Vérifiez le nom et le numéro de dossier du bandeau : vous modifiez bien la bonne fiche.',
          'Changez le champ voulu, par exemple « Nom » ou « Téléphone principal ». Les autres champs restent tels quels.',
          'Cliquez sur « Enregistrer les modifications ».',
        ],
        result:
          'Vous revenez sur le dossier avec le message « Modifications enregistrées. » ; « Dernière modification » indique la nouvelle heure.',
      },
      {
        id: 'reprendre-apres-un-conflit',
        title: 'Reprendre quand la fiche a été modifiée par quelqu’un d’autre',
        steps: [
          'Si l’écran affiche « La fiche a changé entre-temps », ne fermez pas l’écran : vos saisies sont conservées.',
          'Cliquez sur « Recharger la fiche » : vos modifications sont reportées sur la version actuelle de la fiche.',
          '« Fiche rechargée » veut dire qu’aucun de vos champs n’a été changé par l’autre personne : cliquez sur « Enregistrer les modifications ».',
          'Si l’écran affiche « Champs modifiés aussi par une autre personne », lisez la « valeur actuelle » de chaque champ. Votre saisie reste en place.',
          'Gardez votre valeur, ou remettez la valeur actuelle si c’est la bonne, puis cliquez sur « Enregistrer les modifications ».',
        ],
        result:
          'Votre correction est enregistrée sur la fiche la plus récente ; rien n’a été écrasé sans que vous le voyiez.',
      },
      {
        id: 'retirer-date-ou-telephone',
        title: 'Retirer une date de naissance ou un téléphone devenus inconnus',
        steps: [
          'Videz le champ « Date de naissance » ou « Téléphone principal ».',
          'Remplissez la raison qui apparaît dessous : « Raison de l’absence de date de naissance » ou « Raison de l’absence de téléphone ».',
          'Cliquez sur « Enregistrer les modifications ».',
        ],
        result:
          'Le dossier affiche « Non renseigné » avec la raison : aucune date ni aucun numéro n’est inventé.',
      },
    ],
    rules: [
      'Seuls les champs que vous avez changés sont envoyés. Un téléphone ressaisi avec d’autres espaces, ou un champ vidé qui était déjà vide, n’est pas une modification.',
      'Sans changement, l’écran affiche « Aucune modification à enregistrer. » et n’envoie rien.',
      'Le nom reste obligatoire. Une date de naissance ou un téléphone retiré demande sa raison ; une date de naissance dans le futur est refusée. Le numéro de dossier ne se modifie pas.',
      'Chaque modification est tracée : l’ancienne et la nouvelle valeur de chaque champ changé sont conservées dans le journal d’audit. Sa consultation à l’écran n’est pas encore disponible.',
      'Si une autre personne modifie la même fiche pendant votre saisie, l’enregistrement est refusé et vos saisies sont conservées : vous rechargez la fiche, puis vous décidez.',
      'Un champ que vous n’avez pas touché reprend la valeur actuelle de la fiche : le travail de l’autre personne n’est pas annulé.',
    ],
    next: [
      {
        route: 'patients',
        label: 'Patients',
        why: 'Pour ouvrir un autre dossier.',
      },
      {
        route: 'arrivee',
        label: 'Enregistrer une arrivée',
        why: 'Une fois la fiche corrigée, si le patient est au cabinet.',
      },
      {
        topic: 'notion-patient',
        label: 'Comprendre le dossier patient et l’identité',
      },
      {
        topic: 'depannage-messages',
        label: 'Comprendre un message de l’écran',
      },
    ],
    tips: [
      'Corrigez la fiche existante plutôt que d’en créer une seconde : deux fiches pour une même personne ne se réunissent que par une fusion, réservée à la gérante.',
      'Par défaut, seules la gérante et l’accueil modifient une fiche. Le professionnel et la caissière la lisent sans pouvoir la changer.',
      'Un téléphone partagé par plusieurs patients (une famille) n’est pas une erreur à corriger.',
      'Si vous quittez l’écran avec des saisies non enregistrées, le navigateur demande : « Des saisies ne sont pas encore enregistrées. Quitter cet écran sans les enregistrer ? »',
      'Une fiche archivée ou fusionnée n’a plus de bouton « Modifier » sur le dossier.',
    ],
    problems: [
      {
        symptom: '« La fiche a changé entre-temps »',
        remedy:
          'Quelqu’un a modifié la fiche pendant votre saisie. Cliquez sur « Recharger la fiche » : vos modifications sont reportées, rien n’est perdu.',
      },
      {
        symptom: '« Champs modifiés aussi par une autre personne »',
        remedy:
          'Pour chaque champ listé, comparez la « valeur actuelle » avec votre saisie, gardez la bonne, puis cliquez de nouveau sur « Enregistrer les modifications ».',
      },
      {
        symptom: '« Certaines informations sont à corriger »',
        remedy:
          'Cliquez sur un message du résumé pour aller au champ : par exemple « Le nom est obligatoire. » ou « Date de naissance absente : indiquez la raison. »',
      },
      {
        symptom: '« Enregistrement non confirmé »',
        remedy:
          'L’enregistrement a pu être appliqué. Cliquez sur « Réessayer l’enregistrement » sans fermer l’écran : la même saisie est renvoyée, sans doublon.',
      },
      {
        symptom: '« Session expirée »',
        remedy:
          'Cliquez sur « Se reconnecter » dans l’en-tête : vos saisies sont conservées. Puis cliquez sur « Réessayer l’enregistrement ».',
      },
    ],
    terms: ['Numéro de dossier'],
  },
  {
    route: 'patient-activite',
    title: 'Activité du patient',
    module: 'patients',
    anyPermission: ['patient.read'],
    purpose:
      'Retrouvez l’historique d’un patient, du plus récent au plus ancien : ses visites et, selon vos droits, ses examens, ses ordonnances et ses pièces financières. Une nouvelle entrée s’ajoute, elle ne remplace jamais une précédente.',
    actions: [
      {
        label: 'Tout',
        effect:
          'Montre toutes les sections que votre compte peut voir ; le nombre entre parenthèses est le total de la section.',
      },
      {
        label: 'Visites',
        effect: 'Ne garde que les arrivées au cabinet : motif et statut.',
      },
      {
        label: 'Examens',
        effect: 'Ne garde que les examens de vue : état et professionnel, sans aucun résultat.',
        anyPermission: ['clinical.read'],
      },
      {
        label: 'Ordonnances',
        effect:
          'Ne garde que les prescriptions optiques et les ordonnances de médicaments, sans leur contenu.',
        anyPermission: ['clinical.read'],
      },
      {
        label: 'Pièces financières',
        effect: 'Ne garde que les factures émises, les reçus, les avoirs et les remboursements.',
        anyPermission: ['invoice.read'],
      },
      {
        label: 'Page précédente',
        effect: 'Revient aux 25 éléments précédents.',
      },
      {
        label: 'Page suivante',
        effect: 'Affiche les 25 éléments suivants.',
      },
      {
        label: 'Réessayer',
        effect: 'Relit l’activité quand le serveur n’a pas répondu.',
      },
      {
        label: 'Revenir à la première page',
        effect: 'Reprend au début quand la page demandée n’existe plus.',
      },
      {
        label: 'Retour aux patients',
        effect: 'Revient à la liste de recherche.',
      },
    ],
    tasks: [
      {
        id: 'lire-l-activite',
        title: 'Lire l’activité d’un patient',
        steps: [
          'Ouvrez le dossier du patient, puis cliquez sur l’onglet « Activité ».',
          'Lisez les cartes de la plus récente à la plus ancienne : date, titre, puis détails (état, professionnel, montant).',
          'Pour ne voir qu’une nature d’éléments, cliquez sur « Visites », « Examens », « Ordonnances » ou « Pièces financières » ; « Tout » les remet toutes.',
          'S’il y a plusieurs pages, cliquez sur « Page suivante » ; « Page précédente » revient en arrière.',
        ],
        result:
          'Vous avez le fil du dossier : ce qui s’est passé, quand, et avec quel montant pour les pièces financières.',
      },
      {
        id: 'comprendre-une-piece',
        title: 'Comprendre une ligne de facture, de reçu ou d’avoir',
        anyPermission: ['invoice.read'],
        steps: [
          'Cliquez sur « Pièces financières » pour ne garder que les factures émises, les reçus, les avoirs et les remboursements.',
          'Sur une facture, lisez « Montant » puis « Reste dû » : c’est ce qui reste à encaisser, tel que le serveur le calcule.',
          'Exemple : pour une facture de 80 000 FCFA dont 30 000 FCFA sont encaissés, « Reste dû » affiche 50 000 FCFA.',
          'Sur un reçu, lisez « Encaissement » (montant et mode, par exemple Espèces) puis la facture concernée.',
          'Si un encaissement a été annulé par une contre-écriture, le reçu reste là et la ligne « Contre-passé » donne le montant annulé.',
        ],
        result: 'Vous savez ce qui a été émis, encaissé, annulé ou remboursé pour ce patient.',
      },
      {
        id: 'ouvrir-un-examen',
        title: 'Ouvrir un examen ou une prescription depuis l’activité',
        anyPermission: ['clinical.read'],
        steps: [
          'Cliquez sur « Examens » ou « Ordonnances » pour réduire la liste.',
          'Repérez la carte « Examen de vue », ou celle dont le titre commence par « Prescription optique ».',
          'Quand le titre est un lien, cliquez dessus : l’examen ou la prescription s’ouvre.',
        ],
        result:
          'Vous êtes sur l’examen ou sa prescription ; la liste d’activité elle-même n’affiche jamais de résultat médical.',
      },
    ],
    rules: [
      'La liste va du plus récent au plus ancien, 25 éléments par page. Rien n’est supprimé ni remplacé : une correction ou une nouvelle pièce s’ajoute à la suite.',
      'Chaque compte ne voit que ses sections : les visites pour tous ; les examens et ordonnances avec l’accès clinique (gérante, professionnel) ; les pièces financières avec l’accès aux factures (gérante, caissière).',
      'Une section interdite n’apparaît nulle part : ni bouton, ni nombre, ni message. Avec une seule section visible (l’accueil), il n’y a pas de boutons de filtre.',
      'Aucune valeur médicale n’est affichée : ni motif d’examen, ni mesure, ni médicament. La liste donne seulement la date, l’état, le professionnel, le type et le numéro.',
      'Une facture donne son « Reste dû » tel que le serveur le calcule, sans affirmer plus : un reste nul peut venir d’encaissements comme d’un avoir.',
      'Seules les pièces réelles sont listées : les brouillons de facture n’y figurent pas. Un titre n’est un lien que si l’écran existe dans cette version et s’ouvre pour votre compte.',
    ],
    next: [
      {
        route: 'factures',
        label: 'Factures',
        why: 'Pour ouvrir une facture et ses reçus.',
      },
      {
        route: 'consultations',
        label: 'Consultations',
        why: 'Pour retrouver un examen dans la liste du cabinet (comptes cliniques).',
      },
      {
        topic: 'notion-visite-examen',
        label: 'Comprendre la différence entre une visite et un examen',
      },
      {
        topic: 'notion-facture',
        label: 'Comprendre la facture émise, le reçu et l’avoir',
      },
    ],
    tips: [
      'Le nombre entre parenthèses d’un bouton de filtre est le total de la section, pas celui de la page affichée.',
      'Un titre qui n’est pas un lien ne s’ouvre pas : retrouvez la facture ou le reçu dans l’écran « Factures », en ouvrant « Ventes et caisse ».',
      'Sur une fiche conservée après une fusion, l’activité des fiches absorbées s’ajoute à la sienne ; ses éléments n’indiquent pas encore leur fiche d’origine.',
      'Pour lire ce que contient un examen, ouvrez l’examen lui-même : cette liste n’en donne aucun résultat.',
    ],
    problems: [
      {
        symptom: '« Activité indisponible »',
        remedy:
          'Le serveur n’a pas répondu. Cela ne prouve pas que le dossier est vide : cliquez sur « Réessayer » avant de conclure quoi que ce soit.',
      },
      {
        symptom: '« Aucune activité enregistrée »',
        remedy:
          'Le serveur a répondu et n’a rien à montrer pour les sections que vous pouvez voir (« Aucune visite enregistrée » pour l’accueil). C’est normal pour une fiche toute récente.',
      },
      {
        symptom: '« Cette page ne contient plus d’éléments »',
        remedy:
          'L’activité a changé depuis l’affichage précédent. Cliquez sur « Revenir à la première page ».',
      },
      {
        symptom: 'Je ne vois pas les examens ou les factures du patient',
        remedy:
          'Votre profil n’a pas ce droit, ou la fonction n’est pas ouverte au cabinet : la section n’apparaît alors nulle part. Demandez à la gérante.',
      },
      {
        symptom: '« Session expirée »',
        remedy:
          'Cliquez sur « Se reconnecter » dans l’en-tête, puis sur « Réessayer » : l’activité se relit.',
      },
    ],
    terms: [
      'Visite',
      'Examen',
      'Prescription optique',
      'Ordonnance de médicaments',
      'Facture émise',
      'Reçu',
      'Avoir',
      'Remboursement',
      'Contre-écriture',
      'Reste à encaisser',
    ],
  },
  {
    route: 'patient-fusion',
    title: 'Fusionner deux fiches',
    module: 'patients',
    anyPermission: ['patient.merge'],
    purpose:
      'Réunissez deux fiches ouvertes pour la même personne. La fiche d’où vous venez est celle qui sera absorbée : elle garde son numéro et son historique, puis renvoie vers la fiche conservée. Réservé à la gérante.',
    actions: [
      {
        label: 'Retour à la fiche',
        effect: 'Revient au dossier de la fiche à absorber, sans rien fusionner.',
      },
      {
        label: 'Fiche à conserver',
        effect:
          'Champ de recherche : saisissez un nom, un téléphone ou un numéro de dossier (2 caractères au moins), puis choisissez la fiche dans la liste.',
      },
      {
        label: 'Motif de la fusion',
        effect:
          'Champ obligatoire : expliquez pourquoi (5 caractères au moins) ; le motif est conservé dans le journal.',
      },
      {
        label: 'Fusionner les deux fiches',
        effect:
          'Contrôle le motif puis ouvre la demande de confirmation ; rien n’est encore fusionné.',
      },
      {
        label: 'Fusionner',
        effect:
          'Dans la demande de confirmation : lance la fusion définitive. Votre mot de passe peut alors être demandé.',
      },
      {
        label: 'Ne pas fusionner',
        effect: 'Ferme la demande de confirmation sans rien fusionner.',
      },
      {
        label: 'Confirmer et reprendre',
        effect: 'Valide votre mot de passe puis relance la fusion, sans l’envoyer deux fois.',
      },
      {
        label: 'Ouvrir la fiche conservée',
        effect: 'Si la fiche est déjà fusionnée : ouvre celle qui l’a absorbée.',
      },
    ],
    tasks: [
      {
        id: 'fusionner-un-doublon',
        title: 'Réunir deux fiches d’un même patient',
        steps: [
          'Ouvrez la fiche en double (celle qui doit disparaître des recherches), puis cliquez sur « Fusionner avec une autre fiche ».',
          'Dans « Fiche à conserver », saisissez le nom, le téléphone ou le numéro de dossier de la bonne fiche, puis choisissez-la dans la liste.',
          'Lisez le tableau des deux identités : une ligne marquée « diffère » est à vérifier avec le patient avant d’aller plus loin.',
          'Lisez « Rattaché à la fiche absorbée » : visites, examens, prescriptions optiques, factures émises et rendez-vous à venir restent sur leur fiche d’origine.',
          'Si l’écran affiche « Fusion impossible pour l’instant », réglez ce que la liste indique : voir la tâche suivante.',
          'Saisissez le « Motif de la fusion » (5 caractères au moins), puis cliquez sur « Fusionner les deux fiches ».',
          'Dans « Fusionner définitivement ces deux fiches ? », relisez les deux numéros de dossier, puis cliquez sur « Fusionner ». « Ne pas fusionner » annule.',
          'Si l’écran demande « Confirmer votre mot de passe », saisissez-le, puis cliquez sur « Confirmer et reprendre ».',
        ],
        result:
          'Vous arrivez sur la fiche conservée, qui liste l’ancienne fiche dans « Cette fiche réunit d’autres fiches fusionnées ». La fusion est définitive.',
      },
      {
        id: 'lever-un-refus',
        title: 'Lever ce qui bloque une fusion',
        steps: [
          'Lisez la liste sous « Fusion impossible pour l’instant » : chaque ligne dit ce qui bloque.',
          'Visite ou examen en cours : menez l’examen à son terme dans « Aujourd’hui », ou cliquez sur « Annuler la visite » si l’examen n’a pas commencé.',
          'Brouillon de facture : ouvrez-le depuis « Factures », puis cliquez sur « Abandonner le brouillon » (ou terminez la vente).',
          'Rendez-vous à venir : dans « Agenda », cliquez sur « Annuler » sur sa carte, indiquez le motif, puis cliquez sur « Annuler le rendez-vous ».',
          'Fiche conservée archivée ou déjà fusionnée : choisissez une autre fiche à conserver.',
          'Rouvrez ensuite l’écran de fusion et choisissez de nouveau la « Fiche à conserver » : l’aperçu est relu.',
        ],
        result:
          'Le message « Fusion impossible pour l’instant » disparaît et le champ « Motif de la fusion » s’affiche.',
      },
    ],
    rules: [
      'Jamais automatique : l’application compare les deux identités, la gérante décide. Même deux fiches identiques ne sont pas réunies sans sa demande.',
      'Une fusion ne se défait pas. Elle reste tracée dans le journal avec votre motif ; cette version n’a aucune fonction pour la défaire.',
      'Rien n’est réécrit ni supprimé : visites, examens, prescriptions et pièces restent sur leur fiche d’origine, et aucune facture émise ne change d’identité. La fiche absorbée garde son numéro et renvoie vers la fiche conservée.',
      'La fiche conservée garde son identité telle quelle ; son onglet « Activité » réunit les deux activités. La fiche absorbée sort des résultats de recherche.',
      'La fusion est refusée tant qu’une visite ou un examen est en cours, qu’un brouillon de facture existe, qu’un rendez-vous est à venir, ou si la fiche conservée est archivée ou déjà fusionnée.',
      'C’est une opération sensible : votre mot de passe peut être demandé. Vos saisies sont conservées et la fusion reprend sans être enregistrée deux fois.',
    ],
    next: [
      {
        route: 'aujourdhui',
        label: 'Aujourd’hui',
        why: 'Pour terminer ou annuler une visite en cours.',
      },
      {
        route: 'factures',
        label: 'Factures',
        why: 'Pour abandonner un brouillon de facture.',
      },
      {
        route: 'agenda',
        label: 'Agenda',
        why: 'Pour annuler un rendez-vous à venir.',
      },
      {
        topic: 'notion-patient',
        label: 'Comprendre le dossier patient et l’identité',
      },
    ],
    tips: [
      'Avant de fusionner, vérifiez avec le patient (date de naissance, téléphone). Deux personnes d’une même famille peuvent partager un téléphone et un nom proche : ce ne sont pas des doublons.',
      'Le sens compte : la fiche conservée reste dans les recherches avec son numéro de dossier ; la fiche absorbée n’y figure plus. Relisez les deux numéros dans la demande de confirmation.',
      'La recherche de « Fiche à conserver » ne propose jamais la fiche à absorber, ni une fiche archivée ou déjà fusionnée.',
      'Si la liste affiche « D’autres patients correspondent : précisez la recherche. », saisissez le nom complet ou le numéro de dossier.',
    ],
    problems: [
      {
        symptom: '« Fusion impossible pour l’instant »',
        remedy:
          'Chaque ligne dit ce qui bloque : visite ou examen en cours, brouillon de facture, rendez-vous à venir, fiche conservée archivée ou déjà fusionnée. Réglez-le, puis rouvrez l’écran.',
      },
      {
        symptom: '« Cette fiche est déjà fusionnée »',
        remedy:
          'La fiche d’où vous venez a déjà été absorbée. Cliquez sur « Ouvrir la fiche conservée » et travaillez sur celle-là.',
      },
      {
        symptom: '« Aperçu non lu »',
        remedy:
          'L’aperçu de la fusion n’a pas pu être lu : aucune fusion n’est possible sans lui. Choisissez de nouveau la fiche à conserver, ou rouvrez l’écran.',
      },
      {
        symptom: '« Indiquez le motif de la fusion »',
        remedy:
          'Complétez le « Motif de la fusion » : il est obligatoire et reste dans le journal.',
      },
      {
        symptom: '« Fiche à absorber non lue »',
        remedy:
          'La fiche d’où vous venez n’a pas pu être lue (serveur indisponible, droits ou fiche inconnue). Cliquez sur « Retour à la fiche », puis rouvrez la fusion.',
      },
    ],
    terms: ['Doublon', 'Numéro de dossier', 'Visite', 'Brouillon', 'Facture émise'],
  },
]
