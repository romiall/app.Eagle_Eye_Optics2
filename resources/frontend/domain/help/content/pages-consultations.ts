import type { PageHelp } from '../model'

/**
 * Aide des écrans de l’examen de vue (module `consultations`) : liste des examens, examen par étapes,
 * révisions, prescription optique, ordonnances externes d’un patient et comparaison de deux examens.
 */
export const PAGES_CONSULTATIONS: readonly PageHelp[] = [
  {
    route: 'consultations',
    title: 'Consultations',
    module: 'consultations',
    anyPermission: ['clinical.read'],
    purpose:
      'Retrouvez ici les examens de vue du cabinet, du plus récent au plus ancien : par défaut ceux d’aujourd’hui. Ouvrez un examen pour le poursuivre ou le relire. La liste ne montre aucune valeur médicale.',
    actions: [
      {
        label: 'Nouvelle consultation',
        effect:
          'Ouvre la boîte de démarrage d’un examen : patients de la file du jour, ou recherche d’un autre patient.',
        anyPermission: ['clinical.write'],
      },
      {
        label: 'Jour',
        effect:
          'Choisit le jour des examens affichés, aujourd’hui au départ. Vide, la liste couvre tous les jours.',
      },
      {
        label: 'Aujourd’hui',
        effect: 'Remet le filtre « Jour » sur la date du jour.',
      },
      {
        label: 'Tous les jours',
        effect: 'Vide le filtre « Jour » : les examens de tous les jours s’affichent.',
      },
      {
        label: 'État',
        effect:
          'Ne garde que les examens « Brouillon », « En cours » ou « Terminé ». « Tous les états » les montre tous.',
      },
      {
        label: 'Seulement mes examens',
        effect: 'Ne garde que les examens dont vous êtes le professionnel.',
      },
      {
        label: 'Révisions',
        effect: 'Sur la carte d’un examen terminé, ouvre ses révisions et leur comparaison.',
      },
      {
        label: 'Modifier',
        effect:
          'Sur la carte d’un examen, l’ouvre pour le poursuivre ; un examen terminé s’ouvre en correction : une nouvelle révision, rien n’est écrasé.',
        anyPermission: ['clinical.write', 'clinical.amend'],
      },
      {
        label: 'Supprimer',
        effect:
          'Visible seulement sur un brouillon, pour son professionnel ou la gérante. Après confirmation, supprime l’examen ; la visite revient dans la file du jour.',
        anyPermission: ['clinical.write'],
      },
      {
        label: 'Page suivante',
        effect:
          'Affiche les 50 examens suivants quand la liste compte plusieurs pages ; « Page précédente » revient en arrière.',
      },
    ],
    tasks: [
      {
        id: 'retrouver-un-examen',
        title: 'Retrouver un examen',
        steps: [
          'Par défaut, vous voyez les examens d’aujourd’hui. Pour remonter plus loin, cliquez sur « Tous les jours » ou saisissez une date dans « Jour ».',
          'Dans « État », choisissez « Brouillon », « En cours » ou « Terminé » pour réduire la liste.',
          'Cochez « Seulement mes examens » pour ne voir que ceux dont vous êtes le professionnel.',
          'Repérez la carte du patient : son nom, son numéro de dossier, la date de l’examen et le professionnel.',
          'Cliquez sur la carte pour ouvrir l’examen.',
        ],
        result: 'L’écran « Consultation » s’ouvre sur l’examen, à la première étape.',
      },
      {
        id: 'reprendre-modifier-ou-supprimer-un-examen',
        title: 'Reprendre, modifier ou supprimer un examen',
        anyPermission: ['clinical.write'],
        steps: [
          'Cliquez sur « Tous les jours » : un examen commencé hier se reprend comme les autres.',
          'Dans « État », choisissez « En cours », ou « Brouillon » si aucune étape n’a encore été enregistrée.',
          'Cochez « Seulement mes examens », puis cliquez sur « Modifier » sur la carte de l’examen à poursuivre.',
          'Pour corriger un examen « Terminé », cliquez aussi sur « Modifier » : il s’ouvre en correction, avec un motif obligatoire.',
          'Pour supprimer un examen resté « Brouillon », cliquez sur « Supprimer » sur sa carte, puis confirmez avec « Supprimer le brouillon ».',
          'Pour y renoncer, cliquez sur « Garder le brouillon » : rien n’est supprimé.',
        ],
        result:
          'Un examen poursuivi retrouve ses étapes enregistrées. Un brouillon supprimé disparaît de la liste et sa visite revient dans la file du jour, prête à redémarrer.',
      },
      {
        id: 'demarrer-une-consultation',
        title: 'Démarrer une nouvelle consultation',
        anyPermission: ['clinical.write'],
        steps: [
          'Cliquez sur « Nouvelle consultation », ici ou sur l’accueil : une boîte s’ouvre.',
          'Si le patient attend dans « Dans la file du jour », cliquez sur « Démarrer l’examen » sur sa ligne.',
          'Sinon, dans « Un autre patient », saisissez son nom, son téléphone ou son numéro de dossier (2 caractères au moins), puis choisissez-le.',
          'S’il n’est pas dans la file, cliquez sur « Enregistrer l’arrivée et démarrer l’examen » : l’arrivée est enregistrée avec le motif « Examen de vue », puis l’examen démarre.',
          'Patient sans fiche : cliquez sur « Nouveau patient », ou demandez à l’accueil de créer sa fiche, puis revenez ici.',
        ],
        result: 'L’écran « Consultation » s’ouvre sur le nouvel examen, à la première étape.',
      },
    ],
    rules: [
      'Sans filtre choisi, la liste montre les examens d’aujourd’hui, du plus récent au plus ancien, 50 par page, sans aucune valeur médicale.',
      'Seul un examen « Brouillon » se supprime, par son professionnel ou la gérante. Un examen en cours se poursuit ; un examen terminé se corrige par une révision, jamais supprimé.',
      'Ouvrir un examen est consigné au nom du compte qui le lit : chaque lecture d’un dossier médical laisse une trace.',
      'Un examen se démarre avec « Nouvelle consultation » ou depuis la file du jour ; cliquer sur une carte de cette liste ne démarre jamais un examen.',
      'Une liste que le serveur n’a pas pu fournir n’est jamais présentée comme vide : l’écran dit que le serveur n’a pas répondu.',
      'Seuls les comptes qui peuvent lire les dossiers médicaux, comme la gérante et le professionnel, voient cet écran.',
    ],
    next: [
      {
        route: 'aujourdhui',
        label: 'Aujourd’hui',
        why: 'Pour démarrer l’examen d’un patient arrivé.',
      },
      {
        topic: 'parcours-examen',
        label: 'Faire passer un examen, de l’arrivée à la conclusion',
      },
      {
        topic: 'notion-visite-examen',
        label: 'Visite et examen : ce qui les distingue',
      },
    ],
    tips: [
      'Depuis l’accueil, « Nouvelle consultation » (sous « Actions ») ouvre cette liste avec la boîte de démarrage déjà ouverte ; « Mes examens en cours » et « Examens du jour » l’ouvrent avec les filtres posés.',
      'Le menu « Consultations » ouvre aussi cette liste, sur les examens d’aujourd’hui.',
      'Toute la carte est cliquable pour ouvrir l’examen ; ses boutons « Modifier » et « Supprimer » et le lien « Révisions » sont les seuls autres éléments d’une carte.',
    ],
    problems: [
      {
        symptom: '« Aucun examen ce jour-là pour ces critères »',
        remedy:
          'Aucun examen ne correspond à ce jour et à ces filtres. Cliquez sur « Tous les jours » ou élargissez « État ».',
      },
      {
        symptom: '« Aucun examen pour ces critères »',
        remedy:
          'Aucun examen ne correspond aux filtres : choisissez « Tous les états » ou décochez « Seulement mes examens ».',
      },
      {
        symptom: '« Serveur indisponible »',
        remedy:
          'Le serveur n’a pas répondu : ce n’est pas une liste vide. Cliquez sur « Réessayer » quand la connexion est revenue.',
      },
      {
        symptom: '« Session expirée » ou « Droits insuffisants »',
        remedy:
          'Session expirée : cliquez sur « Se reconnecter » dans l’en-tête, puis sur « Réessayer ». Droits insuffisants : ce compte ne peut pas lire les dossiers médicaux, demandez à la gérante si votre travail l’exige.',
      },
      {
        symptom: 'Pas de bouton « Supprimer » sur la carte d’un examen',
        remedy:
          'Seul un examen « Brouillon » (aucune étape enregistrée) se supprime, par son professionnel ou la gérante. Un examen « En cours » se poursuit avec « Modifier » ; un examen « Terminé » se corrige, il ne se supprime jamais.',
      },
    ],
    terms: ['Examen', 'Brouillon', 'Révision', 'File du jour'],
  },
  {
    route: 'consultation',
    title: 'Consultation',
    module: 'consultations',
    anyPermission: ['clinical.read'],
    purpose:
      'Vous remplissez ici l’examen de vue d’un patient, en sept étapes : du motif de la visite à la conclusion. L’en-tête rappelle le patient, son dossier et sa profession. Vous enregistrez étape par étape, terminez l’examen, puis le corrigez au besoin par une révision.',
    actions: [
      {
        label: 'Précédent',
        effect:
          'Revient à l’étape d’avant. Ce que vous avez saisi reste affiché, même sans être enregistré.',
      },
      {
        label: 'Enregistrer',
        effect:
          'Enregistre l’étape affichée sur le serveur, sans quitter l’étape. Sans modification, l’écran répond « Aucune modification à enregistrer sur cette étape. »',
        anyPermission: ['clinical.write'],
      },
      {
        label: 'Suivant',
        effect:
          'Enregistre l’étape affichée, puis ouvre la suivante quand le serveur a répondu. En lecture seule, il ne fait qu’avancer.',
      },
      {
        label: 'Terminer l’examen',
        effect:
          'Après confirmation, fige la première révision : l’examen passe en lecture seule. Visible pour un examen en cours.',
        anyPermission: ['clinical.complete'],
      },
      {
        label: 'Corriger l’examen',
        effect:
          'Rouvre un examen terminé pour le corriger. Un motif est obligatoire et une nouvelle révision est créée.',
        anyPermission: ['clinical.amend'],
      },
      {
        label: 'Supprimer le brouillon',
        effect:
          'Visible tant qu’aucune étape n’est enregistrée, pour son professionnel ou la gérante. Après confirmation, supprime l’examen et revient à la liste.',
        anyPermission: ['clinical.write'],
      },
      {
        label: 'Révisions et comparaison',
        effect: 'Ouvre les versions figées de l’examen terminé et permet de les comparer.',
      },
      {
        label: 'Prescription optique',
        effect: 'Ouvre la prescription de lunettes liée à cet examen terminé.',
      },
      {
        label: 'Recharger la consultation',
        effect:
          'Apparaît quand quelqu’un d’autre a modifié l’examen : reprend la version du serveur en gardant vos saisies.',
      },
      {
        label: 'Aperçu de la fiche de consultation',
        effect:
          'Prépare le PDF de la fiche de l’examen terminé. L’ordonnance et la lettre ont chacune leur bouton.',
        anyPermission: ['clinical.export'],
      },
      {
        label: 'Retour aux consultations',
        effect: 'Revient à la liste des examens.',
      },
    ],
    tasks: [
      {
        id: 'remplir-les-sept-etapes',
        title: 'Remplir et enregistrer les sept étapes',
        anyPermission: ['clinical.write'],
        steps: [
          'Enregistrez chaque étape avec « Suivant » (à la dernière, « Enregistrer ») : « Enregistré sur le serveur » s’affiche quand le serveur a répondu.',
          'Étape 1, « Motif et lunettes » : cochez les motifs, décrivez les « Plaintes et symptômes » (les boutons de symptômes courants les complètent), puis répondez à « Porte actuellement des lunettes ».',
          'Étape 2, « Antécédents » : dans chaque groupe, cochez les valeurs ou « Aucun connu », qui exclut les autres. Un groupe laissé vide reste « Non renseigné ».',
          'Étape 3, « Acuité visuelle » : choisissez l’échelle utilisée (d’office si le cabinet n’en a qu’une), puis saisissez les valeurs lues ou touchez une valeur usuelle, pour chaque groupe d’acuité.',
          'Étape 4, « Réfraction » : saisissez la sphère, le cylindre et l’axe de chaque œil dans les trois tableaux ; sous l’autoréfracteur, reportez aussi l’« Écart pupillaire total (mm) » du ticket.',
          'Étape 5, « Centrage » : l’écart total déjà saisi à l’étape 4 apparaît ; ajoutez au besoin l’écart de chaque œil. Rien n’est calculé à votre place.',
          'Étape 6, « Médicaments » : cliquez sur « Ajouter un médicament », puis remplissez « Nom du médicament » et « Forme » ; les autres champs sont facultatifs.',
          'Étape 7, « Conclusion et orientation » : rédigez la conclusion et répondez à « Orientation vers un ophtalmologiste » ; si « Oui », le niveau d’urgence est obligatoire.',
        ],
        result:
          'Chaque rubrique renseignée porte une coche dans la liste des étapes. Une orientation « Oui » ajoute « Orienté vers ophtalmologiste » en haut de l’écran.',
      },
      {
        id: 'terminer-et-imprimer',
        title: 'Terminer l’examen puis imprimer ses documents',
        anyPermission: ['clinical.complete'],
        steps: [
          'Enregistrez d’abord toutes les étapes modifiées : seul ce qui est enregistré est figé. Le bouton reste grisé tant qu’une étape porte « non enregistrée ».',
          'Cliquez sur « Terminer l’examen » : une boîte « Terminer l’examen ? » liste les « Rubriques non renseignées », figées telles quelles.',
          'S’il manque le motif ou les plaintes, ou la conclusion, remplissez « Justification d’absence » : sans elle, l’examen ne se termine pas.',
          'Cliquez sur « Terminer l’examen » dans la boîte pour confirmer, ou sur « Annuler » pour revenir.',
          'L’écran affiche « Examen terminé » : l’examen passe en lecture seule et la section « Documents de l’examen » apparaît.',
          'Choisissez un document : « Aperçu de la fiche de consultation », ou « Aperçu de l’ordonnance de médicaments » si des médicaments sont saisis.',
          'Pour une orientation « Oui », « Aperçu de la lettre d’orientation » s’ajoute. Patientez pendant « Préparation du PDF… ».',
          'Vérifiez l’aperçu, puis cliquez sur « Imprimer » (le PDF s’ouvre : imprimez avec Ctrl+P) ou sur « Télécharger le PDF ».',
        ],
        result:
          'Le PDF est prêt. Tant que les documents officiels ne sont pas activés, il porte « DOCUMENT DE TEST ».',
      },
      {
        id: 'corriger-un-examen-termine',
        title: 'Corriger un examen terminé',
        anyPermission: ['clinical.amend'],
        steps: [
          'Sur l’examen terminé, cliquez sur « Corriger l’examen » : l’encart « Correction en cours » apparaît et les étapes redeviennent modifiables.',
          'Modifiez les étapes à corriger. « Suivant » ne fait alors que changer d’étape : rien n’est envoyé avant « Enregistrer la correction ».',
          'Dans « Motif de la correction », répondez à « Pourquoi corrigez-vous cet examen ? » : le motif est obligatoire, 3 caractères au moins.',
          'Cliquez sur « Enregistrer la correction » : toutes les étapes modifiées partent ensemble dans une nouvelle révision.',
          'Pour renoncer, cliquez sur « Abandonner la correction » et confirmez si l’écran le demande : l’examen terminé reste inchangé.',
        ],
        result:
          'La nouvelle révision devient l’examen en vigueur, son motif est lisible par les profils cliniques, et les précédentes restent dans « Révisions et comparaison ».',
      },
    ],
    rules: [
      'Une étape n’est enregistrée qu’après la réponse du serveur : « Enregistré sur le serveur » s’affiche. Dans la liste, une coche marque une rubrique renseignée, « non enregistrée » une saisie en attente.',
      'Une case vide reste « Non renseigné » ou « non mesuré », jamais « Aucun connu » ni zéro. « 0 » et « 0,00 » sont de vraies valeurs.',
      'L’acuité se saisit telle que lue, dans l’échelle choisie pour chaque groupe (loin, près, après correction). Aucune conversion n’est faite : deux échelles différentes ne se comparent pas.',
      'Trois mesures séparées : autoréfracteur, objective, subjective. Deux décimales au plus, jamais arrondies ; l’axe va de 0 à 180. L’écart pupillaire du ticket s’enregistre avec la réfraction, mais appartient au « Centrage ».',
      'Cocher « Autre » ouvre un champ à préciser, obligatoire. Les questions liées à un « Oui » (ancienne correction, niveau d’urgence, motifs) ne sont enregistrées que si la réponse est « Oui ».',
      'Terminer fige la révision 1 : l’examen passe en lecture seule. Une correction crée une nouvelle révision motivée ; les précédentes ne changent jamais. Seul un brouillon se supprime.',
    ],
    next: [
      {
        topic: 'parcours-examen',
        label: 'Faire passer un examen, de l’arrivée à la conclusion',
      },
      {
        topic: 'parcours-ordonnance',
        label: 'Prescrire des lunettes et imprimer l’ordonnance',
      },
      {
        route: 'consultations',
        label: 'Consultations',
        why: 'Pour retrouver ou reprendre un autre examen.',
      },
      {
        topic: 'parcours-suivi',
        label: 'Programmer le contrôle et rappeler le patient',
      },
    ],
    tips: [
      'Au centrage, le total et l’écart de chaque œil se saisissent séparément. L’écran propose la somme OD + OG, à reporter avec « Reporter la somme dans l’écart total » ; si elle diffère du total saisi, « Justification de l’écart » est obligatoire.',
      'Les médicaments se saisissent librement : aucune base de médicaments, aucune posologie complétée. « Monter » et « Descendre » règlent l’ordre de l’ordonnance. Prescrire ne crée ni vente ni mouvement de stock.',
      'Sous l’examen, le bloc « Contrôle recommandé » permet de « Programmer un contrôle » ou d’« Annuler le contrôle » encore actif. Il n’apparaît que si l’agenda est ouvert pour votre compte.',
      'Quitter l’écran avec une saisie en attente demande confirmation : « Des saisies ne sont pas encore enregistrées. Quitter cet écran sans les enregistrer ? » L’examen s’ouvre toujours à l’étape 1.',
      'Pendant l’examen, le bloc « Prescription optique » ouvre la prescription de lunettes. Une fois l’examen terminé, « Transmettre à la caisse » (comptes qui facturent) ouvre la facture avec le patient et la visite déjà choisis ; les autres lisent où la caisse la crée. Sans droit de saisie, l’écran affiche « Lecture seule » : seule la navigation entre les étapes fonctionne.',
    ],
    problems: [
      {
        symptom: '« La consultation a changé entre-temps »',
        remedy:
          'Quelqu’un d’autre a modifié l’examen. Vos saisies sont conservées : cliquez sur « Recharger la consultation », lisez les valeurs éventuellement signalées sous « Valeurs modifiées aussi par une autre personne », puis enregistrez de nouveau.',
      },
      {
        symptom:
          '« Enregistrement non confirmé » ou « Échec de l’enregistrement : vos saisies restent affichées. »',
        remedy:
          'Le serveur n’a pas confirmé. Ne fermez pas l’écran : cliquez sur « Réessayer l’enregistrement », qui renvoie la même saisie sans doublon. Si « Session expirée » s’affiche, reconnectez-vous d’abord.',
      },
      {
        symptom: '« Certaines informations sont à corriger »',
        remedy:
          'L’étape n’est pas enregistrée. Cliquez sur un message de la liste pour aller au champ concerné, corrigez-le, puis enregistrez de nouveau.',
      },
      {
        symptom: '« Aucune échelle d’acuité n’est configurée pour ce cabinet »',
        remedy:
          'Les acuités ne peuvent pas être saisies tant que le cabinet n’a pas ses échelles : demandez à l’exploitant de les créer. Le message « Échelles de démonstration » signale des échelles d’exemple, non validées, à remplacer avant l’ouverture.',
      },
      {
        symptom: 'Le bouton « Terminer l’examen » n’apparaît pas',
        remedy:
          'Il n’existe que pour un examen « En cours » et un compte autorisé à terminer. Enregistrez d’abord au moins une étape ; sinon, demandez à la gérante.',
      },
    ],
    terms: [
      'Examen',
      'Brouillon',
      'Révision',
      'Acuité visuelle',
      'Autoréfracteur',
      'Réfraction subjective',
      'Sphère',
      'Cylindre',
      'Axe',
      'Addition',
      'Écart pupillaire',
      'Collyre',
      'Orientation',
      'Ordonnance de médicaments',
      'Contrôle recommandé',
      'OD',
      'OG',
      'OU',
    ],
  },
  {
    route: 'consultation-historique',
    title: 'Révisions de la consultation',
    module: 'consultations',
    anyPermission: ['clinical.read'],
    purpose:
      'Relisez les révisions figées d’un examen terminé et comparez-en deux, valeur par valeur. Chaque révision reste telle qu’elle a été enregistrée : une correction n’efface jamais la précédente.',
    actions: [
      {
        label: 'Retour à la consultation',
        effect: 'Revient à l’examen.',
      },
      {
        label: 'Révision de référence',
        effect:
          'Choisit la révision de départ. « Aucune (voir une seule révision) » affiche une révision sans comparaison.',
      },
      {
        label: 'Révision à comparer',
        effect:
          'Choisit la révision à lire ou à comparer à la référence ; la plus récente est choisie au départ.',
      },
      {
        label: 'Afficher seulement les différences',
        effect: 'Masque les lignes identiques ; coché au départ. Décochez pour tout voir.',
      },
      {
        label: 'Réessayer',
        effect: 'Relance la lecture d’une révision que le serveur n’a pas pu fournir.',
      },
    ],
    tasks: [
      {
        id: 'comparer-deux-revisions',
        title: 'Comparer deux révisions',
        steps: [
          'Dans « Révisions enregistrées », lisez pour chaque révision sa date, son « Motif » et la puce « Actuelle » de la révision en vigueur.',
          'Dans « Comparaison », choisissez la « Révision de référence » : en général la plus ancienne.',
          'Choisissez la « Révision à comparer » : en général la plus récente.',
          'Lisez la phrase qui annonce le nombre de différences entre les deux révisions.',
          'Parcourez les rubriques : chaque ligne montre les deux valeurs et un changement, « Modifié » (≠), « Ajouté » (+), « Retiré » (−) ou « Identique » (=).',
          'Décochez « Afficher seulement les différences » pour voir aussi les lignes identiques.',
        ],
        result:
          'Vous savez ce qui a changé entre les deux révisions, qui l’a enregistré et pourquoi : l’auteur et le motif sont en haut de la comparaison.',
      },
      {
        id: 'relire-une-revision',
        title: 'Relire une seule révision',
        steps: [
          'Mettez « Révision de référence » sur « Aucune (voir une seule révision) ».',
          'Choisissez la révision voulue dans « Révision à comparer ».',
          'Lisez les rubriques : une valeur absente s’affiche « Non renseigné » ou « Non mesuré ».',
        ],
        result:
          'Le contenu de la révision s’affiche tel qu’il a été enregistré, sans colonne de comparaison.',
      },
    ],
    rules: [
      'Une révision est figée : elle ne change jamais. La révision 1 naît quand l’examen est terminé ; chaque correction ajoute la suivante, avec son auteur et son motif.',
      'Le changement est dit en toutes lettres et par un symbole : la couleur n’est jamais le seul signal.',
      'Une valeur absente est « Non renseigné » ou « Non mesuré », jamais aucun ni zéro.',
      'Une acuité est toujours lue avec son échelle. Si les deux révisions n’ont pas la même, la ligne affiche « Échelles différentes : ces valeurs ne sont pas comparables. »',
      'Lire une révision est consigné au nom de votre compte, comme l’ouverture d’un dossier médical.',
      'Un examen non terminé n’a pas de révision : l’écran affiche « Aucune révision enregistrée ».',
    ],
    next: [
      {
        route: 'consultations',
        label: 'Consultations',
        why: 'Pour retrouver un autre examen.',
      },
      {
        topic: 'notion-examen-prescription',
        label: 'Examen, révision et prescription : ce qui les distingue',
      },
      {
        topic: 'glossaire-optique',
        label: 'Le glossaire de l’optique',
      },
    ],
    tips: [
      'La révision « Actuelle » est celle qui sert aux documents imprimés de l’examen.',
      'Chaque carte porte une empreinte numérique qui permet de contrôler que la révision n’a pas changé. Vous n’avez rien à en faire.',
      'Sur téléphone, la comparaison s’affiche en blocs empilés, sans défilement horizontal.',
    ],
    problems: [
      {
        symptom: '« Aucune révision enregistrée »',
        remedy:
          'L’examen n’est pas terminé. La première révision est figée quand on le termine ; les suivantes viennent des corrections motivées.',
      },
      {
        symptom: '« Révision indisponible »',
        remedy:
          'Le serveur n’a pas répondu pour cette révision et aucune ancienne copie n’est montrée. Cliquez sur « Réessayer ».',
      },
      {
        symptom: '« Consultation indisponible »',
        remedy:
          'Même cause pour l’examen entier. Cliquez sur « Réessayer » quand la connexion est revenue.',
      },
      {
        symptom: '« Aucune différence entre ces deux révisions. »',
        remedy:
          'Les deux révisions ont les mêmes valeurs, ou vous avez choisi deux fois la même. Changez « Révision de référence » ou « Révision à comparer ».',
      },
    ],
    terms: ['Révision', 'Examen', 'Acuité visuelle'],
  },
  {
    route: 'consultation-prescriptions',
    title: 'Prescription optique',
    module: 'consultations',
    anyPermission: ['clinical.read'],
    purpose:
      'Rédigez la prescription de lunettes d’un examen : brouillon, puis version validée. La prescription est distincte des mesures de l’examen et ne copie jamais la réfraction d’elle-même. Une version validée ne change plus : on crée une nouvelle version.',
    actions: [
      {
        label: 'Nouvelle prescription',
        effect: 'Ouvre un brouillon vide quand l’examen n’a pas encore de prescription.',
        anyPermission: ['clinical.write'],
      },
      {
        label: 'Copier une mesure de réfraction…',
        effect:
          'Recopie, après confirmation, une mesure de l’examen (autoréfracteur, objective ou subjective) dans la prescription.',
        anyPermission: ['clinical.write'],
      },
      {
        label: 'Reporter les écarts du centrage',
        effect:
          'Recopie, après confirmation, les écarts pupillaires mesurés à l’étape « Centrage ».',
        anyPermission: ['clinical.write'],
      },
      {
        label: 'Enregistrer le brouillon',
        effect: 'Enregistre le brouillon sur le serveur. Un brouillon peut rester incomplet.',
        anyPermission: ['clinical.write'],
      },
      {
        label: 'Valider la prescription',
        effect:
          'Rend la version définitive et prépare son PDF. Grisé tant qu’une modification n’est pas enregistrée.',
        anyPermission: ['clinical.complete'],
      },
      {
        label: 'Créer une nouvelle version',
        effect:
          'Ouvre un brouillon qui reprend la version validée. L’ancienne version reste lisible.',
        anyPermission: ['clinical.amend'],
      },
      {
        label: 'Aperçu de la prescription',
        effect:
          'Prépare le PDF de la dernière version validée ; le bouton indique le numéro de version.',
      },
      {
        label: 'Annuler',
        effect: 'Abandonne les modifications non enregistrées du brouillon en cours.',
      },
      {
        label: 'Supprimer le brouillon',
        effect:
          'Après confirmation, supprime la prescription tant qu’elle est un brouillon jamais validé ni utilisé. Une validée ne se supprime pas : créez-en une nouvelle version.',
        anyPermission: ['clinical.write'],
      },
      {
        label: 'Retour à la consultation',
        effect: 'Revient à l’examen.',
      },
    ],
    tasks: [
      {
        id: 'rediger-et-valider',
        title: 'Rédiger puis valider la prescription',
        anyPermission: ['clinical.write'],
        steps: [
          'Cliquez sur « Nouvelle prescription ». Le brouillon porte l’avertissement « BROUILLON : ne pas remettre au patient tant qu’elle n’est pas validée. »',
          'Pour reprendre une mesure de l’examen, cliquez sur « Copier une mesure de réfraction… », choisissez-la, puis « Copier dans la prescription ».',
          'Sinon, saisissez la sphère, le cylindre, l’axe, l’addition et la hauteur de montage de chaque œil, OD puis OG.',
          'Si un œil n’a pas de correction, cochez-le sous « Mention d’absence de correction » au lieu de saisir des valeurs.',
          'Dans « Écart pupillaire », saisissez les écarts ou cliquez sur « Reporter les écarts du centrage ».',
          'Dans « Verres », choisissez « Usage », « Type de verre », « Indice » et « Traitements », puis ajoutez des « Observations » si besoin.',
          'Cliquez sur « Enregistrer le brouillon », puis relisez chaque valeur avec les mesures de l’examen.',
          'Cliquez sur « Valider la prescription » : la version devient définitive et sa puce passe à « Validée ».',
        ],
        result: 'La prescription apparaît sous « Dernière version », prête à être imprimée.',
      },
      {
        id: 'nouvelle-version',
        title: 'Corriger une prescription validée',
        anyPermission: ['clinical.amend'],
        steps: [
          'Sous « Dernière version », repérez la version « Validée » : elle ne peut plus être modifiée.',
          'Cliquez sur « Créer une nouvelle version » : un brouillon reprend le contenu de la version validée.',
          'Corrigez les valeurs, puis cliquez sur « Enregistrer le brouillon ».',
          'Relisez, puis cliquez sur « Valider la prescription ».',
        ],
        result:
          'La nouvelle version devient la dernière ; l’ancienne reste lisible sous « Versions précédentes ».',
      },
      {
        id: 'imprimer-la-prescription',
        title: 'Imprimer la prescription validée',
        steps: [
          'Descendez jusqu’à la section « Imprimer la prescription », sous la dernière version validée.',
          'Cliquez sur le bouton « Aperçu de la prescription », complété du numéro de version. Patientez pendant « Préparation du PDF… ».',
          'Vérifiez l’aperçu à l’écran, puis cliquez sur « Imprimer » ou sur « Télécharger le PDF ».',
          'Cliquez sur « Fermer l’aperçu » quand vous avez fini.',
        ],
        result:
          'Vous avez le PDF de la version validée. Tant que les documents officiels ne sont pas activés, il porte « DOCUMENT DE TEST ».',
      },
    ],
    rules: [
      'La prescription est distincte des mesures de l’examen : rien n’y est copié sans votre geste explicite, et la modifier ne change jamais l’examen.',
      'Un brouillon peut rester incomplet. Pour valider, chaque œil porte ses valeurs ou la mention d’absence de correction, et un cylindre non nul exige un axe.',
      'Une version validée est définitive. Pour la corriger, on crée une nouvelle version ; les anciennes restent lisibles et inchangées.',
      'Rien n’est calculé ni complété : les valeurs restent telles que saisies (deux décimales au plus), un cylindre positif n’est jamais transposé, un écart pupillaire n’est jamais déduit.',
      'Valider prépare le PDF ; cela ne crée ni vente ni mouvement de stock.',
      'Seule la dernière version validée s’imprime. Un brouillon ne se remet jamais au patient.',
    ],
    next: [
      {
        topic: 'parcours-ordonnance',
        label: 'De la prescription de lunettes à l’impression',
      },
      {
        topic: 'notion-examen-prescription',
        label: 'Examen, prescription et ordonnance : ce qui les distingue',
      },
      {
        route: 'patients',
        label: 'Patients',
        why: 'Pour transcrire l’ordonnance d’un autre prescripteur, dans l’onglet « Prescriptions » du dossier.',
      },
      {
        topic: 'notion-documents',
        label: 'Les documents PDF et la mention de test',
      },
    ],
    tips: [
      'Si l’examen a déjà un brouillon de prescription, l’écran l’ouvre directement en modification.',
      'Si la somme des écarts OD et OG diffère du total, cliquez sur « Justifier un écart entre le total et OD + OG » pour expliquer l’écart.',
      'La hauteur de montage se saisit en millimètres et doit être strictement positive.',
      'L’ordonnance d’un autre prescripteur ne se saisit pas ici, mais dans l’onglet « Prescriptions » du dossier du patient.',
    ],
    problems: [
      {
        symptom: '« Ce brouillon a été modifié entre-temps »',
        remedy:
          'Une autre personne a modifié le brouillon. Votre saisie est conservée : la liste indique, pour chaque champ, la valeur actuelle et la vôtre. Enregistrez seulement si vous gardez les vôtres.',
      },
      {
        symptom: 'Œil OD : saisissez les valeurs, ou cochez « Aucune correction » pour cet œil.',
        remedy:
          'À la validation, chaque œil doit avoir ses valeurs ou sa case « aucune correction » cochée. Complétez l’œil indiqué.',
      },
      {
        symptom: 'Message « un cylindre non nul exige un axe (0 à 180 degrés) » sous un œil',
        remedy:
          'Saisissez l’axe de cet œil, un nombre entier de 0 à 180. Sans axe, un cylindre non nul bloque la validation.',
      },
      {
        symptom: 'Le bouton « Valider la prescription » est grisé ou absent',
        remedy:
          'Grisé : une modification n’est pas enregistrée, cliquez d’abord sur « Enregistrer le brouillon ». Absent : le brouillon n’a pas encore été enregistré, ou votre compte ne peut pas valider.',
      },
      {
        symptom: '« Prescriptions indisponibles »',
        remedy:
          'Le serveur n’a pas répondu : rien n’est affiché à la place. Cliquez sur « Réessayer » quand la connexion est revenue.',
      },
    ],
    terms: [
      'Prescription optique',
      'Brouillon',
      'Sphère',
      'Cylindre',
      'Axe',
      'Addition',
      'Écart pupillaire',
      'Dioptrie',
      'Verres',
      'Ordonnance externe',
      'OD',
      'OG',
    ],
  },
  {
    route: 'patient-prescriptions',
    title: 'Prescriptions du patient',
    module: 'consultations',
    anyPermission: ['clinical.read'],
    purpose:
      'Onglet « Prescriptions » du dossier d’un patient. Il sert à transcrire les ordonnances de lunettes écrites par un autre prescripteur et apportées par le patient. Les prescriptions faites au cabinet restent dans chaque examen.',
    actions: [
      {
        label: 'Transcrire une ordonnance externe',
        effect:
          'Ouvre un brouillon : prescripteur, date et valeurs recopiés tels qu’ils sont écrits sur l’ordonnance.',
        anyPermission: ['clinical.write'],
      },
      {
        label: 'Enregistrer le brouillon',
        effect:
          'Enregistre la transcription en brouillon sur le serveur ; elle peut rester incomplète.',
        anyPermission: ['clinical.write'],
      },
      {
        label: 'Valider la prescription',
        effect: 'Rend la version définitive. Grisé tant qu’une modification n’est pas enregistrée.',
        anyPermission: ['clinical.complete'],
      },
      {
        label: 'Créer une nouvelle version',
        effect:
          'Corrige une transcription validée : un brouillon reprend son contenu, l’ancienne version reste lisible.',
        anyPermission: ['clinical.amend'],
      },
      {
        label: 'Annuler',
        effect: 'Abandonne les modifications non enregistrées du brouillon.',
      },
      {
        label: 'Supprimer le brouillon',
        effect:
          'Après confirmation, supprime la transcription tant qu’elle est un brouillon jamais validé. Une validée ne se supprime pas : créez-en une nouvelle version.',
        anyPermission: ['clinical.write'],
      },
      {
        label: 'Identité',
        effect: 'Revient à l’identité du patient.',
      },
      {
        label: 'Activité',
        effect: 'Ouvre les visites, examens et pièces du patient, selon vos droits.',
      },
      {
        label: 'Retour aux patients',
        effect: 'Revient à la liste des patients.',
      },
      {
        label: 'Réessayer',
        effect: 'Relance la lecture des ordonnances quand le serveur n’a pas répondu.',
      },
    ],
    tasks: [
      {
        id: 'transcrire-une-ordonnance-externe',
        title: 'Transcrire une ordonnance externe',
        anyPermission: ['clinical.write'],
        steps: [
          'Ouvrez le dossier du patient, puis l’onglet « Prescriptions ».',
          'Cliquez sur « Transcrire une ordonnance externe ».',
          'Saisissez « Prescripteur » et « Date de l’ordonnance » tels qu’ils sont écrits sur le papier : les deux sont obligatoires.',
          'Recopiez la sphère, le cylindre, l’axe et l’addition de chaque œil, OD puis OG, ou cochez la mention d’absence de correction.',
          'Recopiez aussi l’écart pupillaire, l’usage, le type de verre, l’indice et les traitements si l’ordonnance les donne.',
          'Cliquez sur « Enregistrer le brouillon », puis relisez le papier valeur par valeur.',
          'Cliquez sur « Valider la prescription » : la version devient définitive.',
        ],
        result:
          'L’ordonnance apparaît sous « Ordonnances externes », avec la puce « Validée » et le nom du prescripteur.',
      },
      {
        id: 'corriger-une-transcription',
        title: 'Corriger une transcription validée',
        anyPermission: ['clinical.amend'],
        steps: [
          'Repérez la version validée, en tête de la liste.',
          'Cliquez sur « Créer une nouvelle version » : un brouillon reprend la transcription.',
          'Corrigez les valeurs, puis cliquez sur « Enregistrer le brouillon ».',
          'Cliquez sur « Valider la prescription ».',
        ],
        result:
          'La nouvelle version devient la plus récente ; l’ancienne reste lisible sous « Ordonnances et versions précédentes ».',
      },
      {
        id: 'relire-les-ordonnances-externes',
        title: 'Relire les ordonnances externes d’un patient',
        steps: [
          'Ouvrez l’onglet « Prescriptions » du dossier du patient.',
          'Lisez la dernière version : prescripteur, date, correction de chaque œil, écarts pupillaires et verres.',
          'Ouvrez « Ordonnances et versions précédentes » pour voir les autres versions.',
        ],
        result: 'Vous voyez ce qui a été transcrit, sans rien modifier.',
      },
    ],
    rules: [
      'Une ordonnance externe se transcrit sans examen : aucun examen fictif n’est créé. Le prescripteur et la date de l’ordonnance sont obligatoires.',
      'La date de l’ordonnance ne peut pas être dans le futur.',
      'Recopiez les valeurs telles qu’elles sont écrites : rien n’est calculé, arrondi ni complété, et un cylindre positif n’est jamais transposé.',
      'Valider rend la version définitive. Une correction crée une nouvelle version ; les anciennes restent lisibles.',
      'Valider ne crée ni vente ni mouvement de stock. Aucune impression n’est proposée ici : l’original papier de l’ordonnance existe déjà.',
      'L’onglet n’apparaît que pour les comptes qui peuvent lire les dossiers médicaux : l’accueil et la caisse ne le voient pas.',
    ],
    next: [
      {
        route: 'patients',
        label: 'Patients',
        why: 'Pour ouvrir le dossier d’un autre patient.',
      },
      {
        topic: 'parcours-ordonnance',
        label: 'De la prescription de lunettes à l’impression',
      },
      {
        topic: 'notion-examen-prescription',
        label: 'Examen, prescription et ordonnance : ce qui les distingue',
      },
      {
        topic: 'guide-professionnel',
        label: 'Le guide du professionnel',
      },
    ],
    tips: [
      'Les prescriptions faites au cabinet ne figurent pas dans cet onglet : ouvrez l’examen concerné, puis « Prescription optique ».',
      'La date se saisit en JJ/MM/AAAA ou en huit chiffres, par exemple 15102026.',
    ],
    problems: [
      {
        symptom: '« Ordonnances indisponibles »',
        remedy:
          'Le serveur n’a pas répondu : aucune ancienne copie ni liste vide n’est montrée. Cliquez sur « Réessayer ».',
      },
      {
        symptom: '« Aucune ordonnance externe »',
        remedy:
          'Aucune transcription n’existe pour ce patient. Cliquez sur « Transcrire une ordonnance externe » s’il en apporte une.',
      },
      {
        symptom:
          '« Le prescripteur de l’ordonnance externe est obligatoire. » ou « La date de l’ordonnance externe est obligatoire. »',
        remedy:
          'Remplissez « Prescripteur » et « Date de l’ordonnance » : ils figurent en haut de l’ordonnance papier.',
      },
      {
        symptom: '« La date de l’ordonnance ne peut pas être dans le futur. »',
        remedy: 'Corrigez « Date de l’ordonnance » : c’est la date écrite sur le papier.',
      },
      {
        symptom: '« Ce brouillon a été modifié entre-temps »',
        remedy:
          'Une autre personne a modifié le brouillon. Votre saisie est conservée ; l’enregistrer remplace les valeurs listées par les vôtres.',
      },
    ],
    terms: [
      'Ordonnance externe',
      'Prescription optique',
      'Brouillon',
      'Sphère',
      'Cylindre',
      'Axe',
      'Addition',
      'Écart pupillaire',
      'OD',
      'OG',
    ],
  },
  {
    route: 'patient-comparaison',
    title: 'Comparer deux examens',
    module: 'consultations',
    anyPermission: ['clinical.read'],
    maturity: 'validation',
    purpose:
      'Compare deux examens terminés d’un même patient : mesures, échelles et dernière prescription validée de chacun. Dans cette version, aucun bouton n’y mène depuis le dossier ou l’examen : l’écran n’est pas encore ouvert au personnel.',
    actions: [
      {
        label: 'Examen de référence',
        effect:
          'Choisit l’examen de départ de la comparaison ; l’avant-dernier examen terminé au départ.',
      },
      {
        label: 'Examen comparé',
        effect: 'Choisit l’examen comparé à la référence ; le dernier examen terminé au départ.',
      },
      {
        label: 'Seulement les différences',
        effect: 'Masque les lignes identiques ; coché au départ. Décochez pour tout voir.',
      },
      {
        label: 'Ouvrir l’examen de référence',
        effect: 'Ouvre l’examen de référence en entier, à l’écran « Consultation ».',
      },
      {
        label: 'Ouvrir l’examen comparé',
        effect: 'Ouvre l’examen comparé en entier, à l’écran « Consultation ».',
      },
      {
        label: 'Retour à la fiche',
        effect: 'Revient au dossier du patient.',
      },
    ],
    tasks: [
      {
        id: 'comparer-deux-examens',
        title: 'Comparer deux examens terminés',
        steps: [
          'Vérifiez « Examen de référence » (le plus ancien) et « Examen comparé » (le plus récent) ; changez-les si besoin.',
          'Lisez la ligne qui annonce le nombre de différences et les acuités d’échelles différentes, non comparées.',
          'Parcourez chaque rubrique : colonne « Élément », une colonne par examen, puis colonne « Écart ».',
          'Descendez jusqu’à « Prescription validée » pour comparer la dernière prescription validée de chaque examen.',
          'Décochez « Seulement les différences » pour voir aussi les lignes identiques.',
          'Cliquez sur « Ouvrir l’examen de référence » ou « Ouvrir l’examen comparé » pour lire un examen en entier.',
        ],
        result:
          'Vous voyez, rubrique par rubrique, ce qui a changé d’un examen à l’autre. Aucune valeur n’est modifiée.',
      },
    ],
    rules: [
      'Chaque examen est lu à sa révision actuelle. La prescription comparée est la dernière version validée de l’examen, jamais un brouillon.',
      'Une acuité garde son échelle. Si les deux examens n’ont pas la même, la ligne affiche « Échelles différentes : ces valeurs ne sont pas comparables. » et rien n’est converti.',
      'Une valeur absente est « Non renseigné » ou « Non mesuré », jamais aucun ni zéro. Le changement est dit en texte et par un symbole.',
      'Il faut au moins deux examens terminés pour ce patient, fiches fusionnées comprises.',
      'L’écran est en lecture seule : chaque lecture du dossier est consignée au nom de votre compte.',
    ],
    next: [
      {
        route: 'patients',
        label: 'Patients',
        why: 'Pour ouvrir le dossier du patient et ses examens.',
      },
      {
        topic: 'notion-examen-prescription',
        label: 'Examen, révision et prescription : ce qui les distingue',
      },
      {
        topic: 'glossaire-optique',
        label: 'Le glossaire de l’optique',
      },
    ],
    tips: [
      'Aucun menu ni bouton n’ouvre cet écran dans cette version.',
      'Si un examen n’a pas de prescription validée, l’écran le dit au-dessus du tableau de prescription : ses lignes comptent alors comme « Non renseigné ».',
      'Quand le patient a beaucoup d’examens, l’écran signale : « Seuls les examens les plus récents sont proposés : la liste complète est plus longue. »',
    ],
    problems: [
      {
        symptom: '« Pas assez d’examens terminés »',
        remedy:
          'La comparaison porte sur deux examens terminés au moins, fiches fusionnées comprises. Attendez qu’un deuxième examen du patient soit terminé.',
      },
      {
        symptom: '« Même examen choisi deux fois »',
        remedy:
          'Changez « Examen de référence » ou « Examen comparé » : choisissez deux examens différents.',
      },
      {
        symptom: '« Examens non lus »',
        remedy:
          'Le serveur n’a pas répondu et aucune ancienne copie n’est montrée. Rechargez la page quand la connexion est revenue.',
      },
      {
        symptom: '« Examen de référence non lu » ou « Examen comparé non lu »',
        remedy:
          'La lecture de cet examen a échoué. Choisissez un autre examen, ou rechargez la page.',
      },
    ],
    terms: ['Examen', 'Révision', 'Acuité visuelle', 'Prescription optique'],
  },
]
