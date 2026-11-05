import type { HandbookTopic } from '../model'

// Rubriques « Notions et règles », première partie : dossier patient, visite et examen, examen et
// prescription, documents PDF, sécurité et modules. Chaque texte décrit ce que l’application fait.
export const TOPICS_NOTIONS_BASE: readonly HandbookTopic[] = [
  {
    id: 'notion-patient',
    title: 'Le dossier patient et l’identité',
    summary:
      'Une personne, une seule fiche : saisie une fois, reprise partout et protégée des doublons.',
    module: 'patients',
    anyPermission: ['patient.read'],
    intro:
      'Chaque personne a une seule fiche. Son identité est saisie à la création, puis reprise automatiquement par l’arrivée, l’examen, les ordonnances et les factures : vous ne la ressaisissez jamais.',
    blocks: [
      {
        kind: 'points',
        title: 'Ce que contient la fiche',
        items: [
          'Identité : nom, prénom(s), sexe, date de naissance (l’âge est recalculé chaque jour) et profession.',
          'Contact : téléphone principal, téléphone secondaire, adresse ou quartier.',
          'Dossier : le « Numéro de dossier » (par exemple EE-2026-0001), attribué à l’enregistrement et jamais modifié, la date de création et la « Dernière modification ».',
          'Aucune donnée médicale ici : les examens et les ordonnances ont leurs propres écrans, selon vos droits. L’onglet « Activité » liste les visites, examens, ordonnances et pièces financières que votre compte peut voir.',
          'L’accueil et la gérante créent et modifient les fiches ; le professionnel et la caissière les lisent.',
        ],
      },
      {
        kind: 'table',
        title: 'Ce qui est obligatoire, ce qui peut manquer',
        head: ['Information', 'Règle', 'Si vous ne l’avez pas'],
        rows: [
          ['Nom', 'Obligatoire.', 'Pas de fiche sans nom.'],
          ['Prénom(s)', 'Facultatif.', 'Laissez vide : un prénom peut être inconnu.'],
          [
            'Date de naissance',
            'Connue, jamais dans le futur.',
            'Laissez vide et remplissez « Raison de l’absence de date de naissance » : la fiche affiche « âge non renseigné ». Aucune date n’est inventée.',
          ],
          [
            'Téléphone principal',
            'Renseigné, ou sa raison d’absence.',
            'Laissez vide et remplissez « Raison de l’absence de téléphone ».',
          ],
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Un même téléphone peut servir à plusieurs patients (une famille) : ce n’est jamais une erreur. Sur la fiche, un champ vide s’affiche « Non renseigné ».',
      },
      {
        kind: 'steps',
        title: 'Quand deux fiches se ressemblent',
        items: [
          'Cliquez sur « Enregistrer le patient » : l’application cherche d’abord les fiches proches (même nom et prénom, ou même téléphone).',
          'Si elle en trouve, « Des fiches ressemblent à ce patient » les montre avec la raison : « Nom proche », « Même téléphone » ou « Même date de naissance ».',
          'Cliquez sur « Ouvrir la fiche » pour comparer : elle s’ouvre dans un nouvel onglet, votre saisie reste intacte.',
          'Même personne : « Revenir au formulaire », puis quittez sans enregistrer. Personne différente : « Créer quand même ».',
        ],
      },
      {
        kind: 'note',
        tone: 'warning',
        text: 'Aucune fiche n’est jamais fusionnée automatiquement : l’application signale, c’est vous qui décidez. Si la recherche des fiches proches est impossible, « Vérification des doublons impossible » propose « Créer sans vérification » : à n’utiliser qu’en cas de nécessité, puis contrôlez la liste des patients.',
      },
      {
        kind: 'points',
        title: 'Une personne enregistrée deux fois : la fusion',
        items: [
          'Seule la gérante fusionne, depuis la fiche en double : « Fusionner avec une autre fiche » ouvre l’écran « Fusionner deux fiches ».',
          'Elle choisit la « Fiche à conserver », compare les deux identités côte à côte, écrit le « Motif de la fusion », puis confirme avec son mot de passe.',
          'Rien n’est effacé : la fiche absorbée garde son numéro et son historique, et renvoie vers la fiche conservée (« Ouvrir la fiche conservée »). Les pièces déjà émises gardent le numéro de dossier imprimé.',
          'La fusion est refusée (« Fusion impossible pour l’instant ») tant qu’une visite ou un examen est en cours, qu’un brouillon de facture existe ou qu’un rendez-vous à venir est pris sur la fiche en double. Une fusion ne se défait pas.',
        ],
      },
      {
        kind: 'points',
        title: 'Corriger une fiche sans rien perdre',
        items: [
          '« Modifier » ouvre la fiche : changez ce qui est faux, puis « Enregistrer les modifications ». Le numéro de dossier ne se modifie pas.',
          'Chaque changement est consigné dans le journal de l’application : qui, quand, ancienne et nouvelle valeur. Cette trace n’a pas encore d’écran de lecture.',
          'Si une autre personne a modifié la fiche pendant votre saisie, l’écran affiche « La fiche a changé entre-temps » : vos saisies sont gardées, cliquez sur « Recharger la fiche » et relisez les champs signalés.',
          'Une fiche « Fiche archivée » ou « Fiche fusionnée » est signalée par une puce et ne reçoit plus d’arrivée.',
        ],
      },
    ],
    related: [
      {
        route: 'patients',
        label: 'Patients',
        why: 'Pour retrouver une fiche avant d’en créer une.',
      },
      { route: 'patient-nouveau', label: 'Nouveau patient' },
      { topic: 'parcours-accueillir', label: 'Accueillir un patient, pas à pas' },
      { topic: 'notion-securite', label: 'Droits, traçabilité et confidentialité' },
    ],
    keywords: [
      'fiche',
      'dossier',
      'identité',
      'doublon',
      'doublons',
      'homonyme',
      'fusion',
      'fusionner',
      'numéro de dossier',
      'téléphone partagé',
      'date de naissance inconnue',
      'âge',
      'archivée',
      'corriger une fiche',
    ],
  },
  {
    id: 'notion-visite-examen',
    title: 'La visite, la file du jour et l’examen',
    summary:
      'Ce qu’est une visite, comment la file du jour la suit et quand l’examen peut démarrer.',
    module: 'today',
    anyPermission: ['visit.register', 'agenda.read'],
    intro:
      'Une visite est une venue du patient au cabinet, notée par l’accueil. L’examen est la séance du professionnel. Ce sont deux choses distinctes : une visite peut ne contenir aucun examen, et un patient peut avoir plusieurs visites le même jour.',
    blocks: [
      {
        kind: 'flow',
        title: 'Le trajet d’une visite d’examen',
        stages: [
          {
            label: 'Arrivée',
            text: 'L’accueil clique sur « Enregistrer une arrivée », choisit le patient et le motif. La visite entre dans la file du jour avec le statut « Arrivé ».',
          },
          {
            label: 'Frais d’examen',
            text: 'Seulement si le cabinet contrôle les frais : la visite attend leur encaissement ou une dispense. Sinon, cette étape n’existe pas.',
          },
          {
            label: 'Examen',
            text: 'Le professionnel clique sur « Démarrer l’examen » : la visite passe « En consultation ».',
          },
          {
            label: 'Fin',
            text: 'Quand l’examen est terminé, la visite passe « Terminé » ; « Consulter l’examen » le rouvre en lecture.',
          },
        ],
      },
      {
        kind: 'table',
        title: 'Les statuts de la file du jour',
        head: ['Statut', 'Ce que cela veut dire', 'Ensuite'],
        rows: [
          [
            'Arrivé',
            'La personne est au cabinet.',
            'Examen ou suivi : « Démarrer l’examen ». Achat ou retrait : aucun examen.',
          ],
          [
            'En attente du paiement de l’examen',
            'Contrôle des frais actif : ils ne sont ni encaissés ni dispensés.',
            'Encaisser la facture de frais, ou demander une dispense.',
          ],
          [
            'Prêt pour l’examen',
            'Frais encaissés, ou dispense accordée par la gérante.',
            '« Démarrer l’examen ».',
          ],
          ['En consultation', 'L’examen est commencé.', '« Reprendre l’examen ».'],
          ['Terminé', 'L’examen est terminé et figé.', '« Consulter l’examen ».'],
          [
            'Annulé',
            'La visite a été annulée avant l’examen.',
            'Elle reste dans la file, marquée annulée.',
          ],
        ],
      },
      {
        kind: 'points',
        title: 'Le contrôle des frais d’examen',
        items: [
          'Le cabinet décide, avec le prestataire, si un examen ne démarre qu’une fois ses frais encaissés. L’encadré en haut de « Aujourd’hui » dit lequel des deux cas s’applique.',
          'Contrôle non actif (« Le contrôle du paiement de l’examen n’est pas encore actif ») : chaque visite d’examen affiche « Paiement de l’examen non contrôlé ». Rien n’est vérifié, cela ne dit pas si les frais ont été encaissés, et « Démarrer l’examen » n’est pas bloqué.',
          'Contrôle actif (« Les frais d’examen sont contrôlés ») : une visite d’examen ou de suivi arrive « En attente du paiement de l’examen », avec la puce « Frais d’examen à encaisser », et « Démarrer l’examen » n’est pas proposé.',
          'Première issue : « Créer une facture » sur la ligne de la visite (patient et visite sont repris), puis l’émettre et l’encaisser. La puce devient « Frais d’examen encaissés », avec le numéro du reçu, et la visite « Prêt pour l’examen ».',
          'Seconde issue : « Demander une dispense des frais d’examen » envoie une demande motivée à la gérante. La puce dit « Dispense des frais d’examen demandée : en attente de la gérante », puis « Dispense approuvée par la gérante ».',
          'La gérante décide dans « Approbations » (Paramètres, carte « Autorisations »), qui garde la demande, son motif, les noms et les dates. Une dispense autorise seulement le démarrage de cet examen, une seule fois, avant son échéance.',
        ],
      },
      {
        kind: 'points',
        title: 'Achat, retrait, annulation',
        items: [
          'Un « Achat direct » ou un « Retrait de commande » n’impose aucun examen : aucune consultation n’est créée et la puce dit « Pas d’examen ».',
          '« Annuler la visite » n’est proposé qu’avant l’examen. Le motif est obligatoire et reste administratif. La visite reste dans la file, marquée « Annulé » ; rien n’est supprimé. L’annulation est refusée si l’examen a démarré ou si la visite porte une facture.',
          'Si le patient a déjà une arrivée aujourd’hui, l’écran vous avertit pour éviter un doublon, sans vous bloquer : un achat après l’examen est normal.',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Qui fait quoi : l’accueil, le professionnel, la caissière et la gérante lisent la file ; l’accueil, le professionnel et la gérante enregistrent une arrivée ; le professionnel et la gérante démarrent un examen. L’accueil et la caissière ne voient jamais le contenu d’un examen.',
      },
    ],
    related: [
      { route: 'aujourdhui', label: 'Aujourd’hui' },
      { route: 'arrivee', label: 'Enregistrer une arrivée' },
      { topic: 'parcours-examen', label: 'Mener un examen, pas à pas' },
      { topic: 'notion-approbations', label: 'Les approbations de la gérante' },
      { topic: 'notion-examen-prescription', label: 'L’examen par étapes et la prescription' },
    ],
    keywords: [
      'arrivée',
      'file d’attente',
      'file du jour',
      'statut',
      'visite',
      'frais d’examen',
      'dispense',
      'paiement de l’examen',
      'annuler une visite',
      'achat direct',
      'retrait de commande',
      'contrôle de suivi',
      'consultation',
      'démarrer l’examen',
    ],
  },
  {
    id: 'notion-examen-prescription',
    title: 'L’examen par étapes et la prescription optique',
    summary:
      'Comment un examen se remplit, se termine et se corrige, et pourquoi la prescription reste distincte des mesures.',
    module: 'consultations',
    anyPermission: ['clinical.read'],
    audience: ['CLINICIAN', 'MANAGER'],
    intro:
      'Un examen (écran « Consultation ») se remplit en sept étapes, se termine une fois, puis ne s’efface plus : une erreur se corrige par une révision. La prescription optique est un document à part, rédigé et validé à partir des mesures, jamais calculé à votre place.',
    blocks: [
      {
        kind: 'table',
        title: 'Quatre réponses à ne jamais confondre',
        head: ['Ce que vous voyez', 'Ce que cela veut dire'],
        rows: [
          ['« Non renseigné »', 'La question n’a pas été posée ou notée. Ce n’est pas un « Non ».'],
          ['« Non »', 'La réponse a été donnée : c’est non.'],
          [
            '« Aucun connu »',
            'Dans un groupe d’antécédents : la vérification est faite, rien à signaler. Cette case exclut les autres du groupe. Un groupe sans case cochée reste « non renseigné ».',
          ],
          [
            'Une case de mesure vide',
            '« non mesuré » : la mesure n’a pas été faite. Zéro est une vraie valeur, différente du vide.',
          ],
        ],
      },
      {
        kind: 'points',
        title: 'Règles de saisie',
        items: [
          'OD (œil droit) vient toujours avant OG (œil gauche). OU (les deux yeux) n’existe que pour l’acuité.',
          'Chaque groupe d’acuité (« Acuité de loin », « Acuité de près », « Acuité après correction ») a son « échelle utilisée ». Notez la valeur telle qu’elle est lue, sans conversion : deux échelles dans un même groupe sont signalées, leurs valeurs ne sont pas comparables. Des boutons proposent les valeurs usuelles ; si le cabinet n’a qu’une échelle, elle est retenue d’office.',
          'Tant que le cabinet n’a pas validé son échelle, l’écran peut afficher « Échelles de démonstration » : elles ne sont pas validées cliniquement.',
          'La réfraction garde trois mesures distinctes : « Autoréfracteur », « Réfraction objective » et « Réfraction subjective ». Virgule ou point, deux décimales au plus ; une troisième est refusée, jamais arrondie. Un cylindre positif n’est jamais transposé.',
          'L’« Écart pupillaire total (mm) » du ticket de l’autoréfracteur se saisit sous son tableau, à la « Réfraction », et apparaît au « Centrage ». Au « Centrage », l’écart pupillaire total, OD et OG se saisissent séparément : aucun n’est calculé à votre place. Si leur somme diffère du total, une « Justification de l’écart » est obligatoire.',
          'L’application ne pose aucun diagnostic : les amétropies, la conclusion et l’orientation sont vos choix. Une orientation vers un ophtalmologiste exige un « Niveau d’urgence ».',
        ],
      },
      {
        kind: 'terms',
        title: 'Les mesures en deux mots',
        items: [
          { term: 'Sphère', definition: 'Puissance principale de la correction, en dioptries.' },
          {
            term: 'Cylindre',
            definition: 'Part de la correction qui compense l’astigmatisme, en dioptries.',
          },
          { term: 'Axe', definition: 'Direction du cylindre, en degrés, de 0 à 180.' },
          {
            term: 'Addition',
            definition: 'Puissance ajoutée pour la vision de près, en dioptries.',
          },
          {
            term: 'Écart pupillaire',
            definition: 'Distance entre les deux pupilles, en millimètres.',
          },
        ],
      },
      {
        kind: 'points',
        title: 'Terminer, corriger, travailler à deux',
        items: [
          '« Terminer l’examen » fige la première révision. Les « Rubriques non renseignées » restent telles quelles, jamais transformées en « Aucun connu ». Si le motif ou la conclusion manque, une « Justification d’absence » est obligatoire.',
          'Un examen terminé est en lecture seule. « Corriger l’examen » demande un motif (« Pourquoi corrigez-vous cet examen ? »), puis « Enregistrer la correction » ajoute une révision. Les anciennes restent lisibles dans « Révisions et comparaison », avec auteur, date et motif ; les écarts sont marqués « Modifié », « Ajouté » ou « Retiré ».',
          'Si une autre personne a modifié l’examen pendant votre saisie, l’écran affiche « La consultation a changé entre-temps » : rien n’est écrasé et votre saisie est gardée. « Recharger la consultation » la reporte sur la version actuelle et signale les valeurs modifiées des deux côtés.',
        ],
      },
      {
        kind: 'points',
        title: 'La prescription optique',
        items: [
          'Elle se prépare depuis l’examen (« Prescription optique », puis « Nouvelle prescription »). Copier une mesure est un geste explicite et confirmé ; ensuite elle s’édite sans toucher à l’examen.',
          'Brouillon d’abord (« BROUILLON : ne pas remettre au patient tant qu’elle n’est pas validée »), avec « Enregistrer le brouillon ». « Valider la prescription » exige, pour chaque œil, des valeurs ou « Aucune correction », et un axe si le cylindre n’est pas nul.',
          'Une version « Validée » ne change plus : « Créer une nouvelle version » en ouvre une autre, les précédentes restent sous « Versions précédentes ». Valider ne crée ni vente ni mouvement de stock.',
          'Ordonnance d’un autre prescripteur : onglet « Prescriptions » du dossier du patient, puis « Transcrire une ordonnance externe ». « Prescripteur » et « Date de l’ordonnance » sont obligatoires ; recopiez les valeurs telles qu’écrites. Aucun examen fictif n’est créé.',
          'Ordonnance de médicaments : étape « Médicaments », en saisie libre (« Nom du médicament » et « Forme » obligatoires). L’application ne propose ni ne complète aucune posologie.',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Comparer deux examens différents d’un même patient n’a pas encore de bouton dans cette version. Seule la comparaison des révisions d’un même examen est proposée.',
      },
    ],
    related: [
      { topic: 'parcours-examen', label: 'Mener un examen, pas à pas' },
      { topic: 'parcours-ordonnance', label: 'Prescrire et imprimer une ordonnance' },
      { topic: 'glossaire-optique', label: 'Glossaire de l’optique' },
      { topic: 'notion-documents', label: 'Les documents PDF' },
      { route: 'consultations', label: 'Consultations' },
    ],
    keywords: [
      'consultation',
      'examen',
      'étapes',
      'non renseigné',
      'aucun connu',
      'acuité',
      'échelle',
      'réfraction',
      'sphère',
      'cylindre',
      'axe',
      'addition',
      'centrage',
      'révision',
      'correction',
      'conflit',
      'brouillon',
      'prescription',
      'ordonnance externe',
      'ordonnance',
    ],
  },
  {
    id: 'notion-documents',
    title: 'Les documents PDF : aperçu, impression et mentions',
    summary:
      'Où trouver un document, comment l’imprimer et pourquoi il peut porter « DOCUMENT DE TEST ».',
    module: null,
    anyPermission: [
      'invoice.read',
      'payment.collect',
      'cash.own_session',
      'clinical.read',
      'clinical.export',
    ],
    intro:
      'Factures, reçus, ordonnances et autres pièces sont des PDF préparés sur votre ordinateur, à partir des données figées de la pièce. Vous vérifiez l’aperçu, puis vous imprimez ou téléchargez.',
    blocks: [
      {
        kind: 'steps',
        title: 'Imprimer un document',
        items: [
          'Ouvrez la pièce (facture émise, examen terminé, prescription validée…) puis cliquez sur son bouton d’aperçu, par exemple « Aperçu de la facture (PDF) ».',
          'Lisez l’aperçu et les avertissements affichés au-dessus, s’il y en a.',
          'Cliquez sur « Imprimer » : le PDF s’ouvre dans la visionneuse du navigateur, d’où vous imprimez avec Ctrl+P. « Ouvrir le PDF » l’ouvre sans imprimer, « Télécharger le PDF » l’enregistre.',
          'Si le navigateur bloque l’ouverture, le PDF est téléchargé : rien n’est perdu.',
        ],
      },
      {
        kind: 'table',
        title: 'Quel document, où, pour qui',
        head: ['Document', 'Où le trouver', 'Qui l’ouvre'],
        rows: [
          [
            'Facture, reçu',
            'Fiche d’une facture émise : « Aperçu de la facture (PDF) », puis « Aperçu du reçu (PDF) » sous chaque encaissement.',
            'Caissière, gérante',
          ],
          [
            'Avoir, remboursement',
            'Fiche de la facture : « PDF de l’avoir », « PDF du remboursement ».',
            'Caissière, gérante',
          ],
          [
            'Devis',
            'Fiche du devis, après son émission : « Aperçu du devis (PDF) ».',
            'Caissière, gérante',
          ],
          [
            'Relevé de caisse',
            'Écran Caisse : « Relevé provisoire (PDF) » ou « Relevé de clôture (PDF) ».',
            'Caissière, gérante',
          ],
          [
            'Fiche de consultation, ordonnance de médicaments, lettre d’orientation',
            'Bloc « Documents de l’examen », sur un examen terminé. L’ordonnance suppose des médicaments saisis, la lettre une orientation.',
            'Professionnel, gérante',
          ],
          [
            'Prescription optique',
            'Écran « Prescription optique » : « Aperçu de la prescription », pour la dernière version validée.',
            'Professionnel, gérante',
          ],
        ],
      },
      {
        kind: 'points',
        title: 'Ce que garantit un document',
        items: [
          'Une pièce émise est figée : l’afficher à nouveau donne la même pièce. « Réimprimer le reçu » ou « Réimprimer la facture » ne crée ni nouveau numéro ni nouvel encaissement. Si le PDF d’un reçu échoue, l’écran rappelle « Le reçu existe : ne recommencez pas l’encaissement ».',
          'Un brouillon ne s’imprime pas : un brouillon de facture n’a pas de PDF, un devis s’imprime après son émission, et une prescription en brouillon reste marquée « BROUILLON ». Seule la dernière version validée d’une prescription est proposée à l’impression.',
          'Une facture ou un reçu ne montre aucune donnée médicale ; un document médical ne montre aucun montant.',
          'Le nom du fichier téléchargé ne contient ni nom de patient ni numéro de dossier. L’application n’envoie aucun document au patient : vous le lui remettez vous-même.',
        ],
      },
      {
        kind: 'points',
        title: 'L’identité du cabinet et les mentions',
        items: [
          'Le nom, l’adresse, les contacts, l’identifiant fiscal, les mentions et les lignes d’en-tête et de pied de page viennent de « Cabinet et documents » (Paramètres), saisis par la gérante. Une modification vaut pour les documents produits ensuite ; une facture déjà émise garde l’identité de son émission.',
          'Tant que les mentions réelles ne sont pas validées à la mise en service, chaque document porte « DOCUMENT DE TEST » avec le filigrane « DONNÉES DE TEST », les informations manquantes sont écrites « à renseigner » et les numéros de pièces sont des numéros de test. Un tel document n’a aucune valeur comptable, fiscale, médicale ni légale : ne le remettez pas comme pièce officielle.',
          'L’écran « Cabinet et documents » dit si le cabinet est en « Documents de test » ou en « Documents officiels activés ». La gérante ne bascule pas elle-même : l’activation se décide à la mise en service, avec le prestataire.',
        ],
      },
    ],
    related: [
      { topic: 'parcours-ordonnance', label: 'Prescrire et imprimer une ordonnance' },
      { topic: 'notion-facture', label: 'La facture et ses pièces' },
      { topic: 'notion-encaissement', label: 'Encaisser : acompte, reçu, reste à encaisser' },
      { route: 'parametres-cabinet', label: 'Cabinet et documents', why: 'Réservé à la gérante.' },
      { topic: 'premiere-configuration', label: 'Première configuration du cabinet' },
    ],
    keywords: [
      'PDF',
      'imprimer',
      'impression',
      'aperçu',
      'télécharger',
      'réimprimer',
      'duplicata',
      'document de test',
      'mentions',
      'en-tête',
      'logo',
      'ordonnance',
      'reçu',
      'facture',
      'brouillon',
    ],
  },
  {
    id: 'notion-securite',
    title: 'Sécurité : compte, droits et traçabilité',
    summary:
      'Ce qui protège les dossiers : votre compte, votre session, les droits de chaque profil et la trace des actions.',
    module: null,
    anyPermission: [],
    intro:
      'Les dossiers contiennent des données de santé. L’application les protège par des comptes personnels, des droits par profil et une trace de chaque action importante. Vous n’avez rien à régler : il suffit de connaître les règles.',
    blocks: [
      {
        kind: 'points',
        title: 'Votre compte',
        items: [
          'Un compte par personne, avec son identifiant et son mot de passe. Ne les prêtez jamais : votre nom figure dans le journal et sur les pièces que vous produisez.',
          'La gérante vous remet un mot de passe initial : remplacez-le dès la première connexion avec « Changer mon mot de passe » (sur l’accueil). Il faut 12 caractères au moins, avec des lettres et des chiffres, différent de l’identifiant.',
          'Mot de passe oublié : demandez à la gérante de le réinitialiser, il n’y a pas de réinitialisation par courriel. Celui d’une gérante se réinitialise sur le serveur, par le prestataire.',
          'Après plusieurs essais ratés, la connexion est ralentie : patientez avant de réessayer.',
        ],
      },
      {
        kind: 'points',
        title: 'Votre session',
        items: [
          'Quand vous quittez un poste partagé, cliquez sur « Se déconnecter ». Si l’écran dit « Déconnexion impossible », la session reste ouverte : réessayez quand la connexion revient.',
          'Après une longue inactivité (environ une demi-heure), la session prend fin. L’en-tête affiche « Session expirée : vos saisies sont conservées » et « Se reconnecter ». Seul le compte qui a commencé la saisie peut la reprendre.',
          'Certaines actions demandent de confirmer votre mot de passe (« Confirmer votre mot de passe », puis « Confirmer et reprendre ») : création de comptes, réglages du cabinet, décision sur une autorisation, correction d’un encaissement, export, fusion de fiches. Votre saisie est gardée, l’action reprend sans doublon, et la confirmation vaut environ un quart d’heure.',
        ],
      },
      {
        kind: 'table',
        title: 'Qui peut quoi, en bref',
        head: ['Profil', 'Peut', 'Ne voit pas'],
        rows: [
          [
            'La gérante',
            'Tout le métier, plus les comptes, les réglages du cabinet, les autorisations et les exports.',
            '—',
          ],
          [
            'L’accueil',
            'Créer et modifier les patients, enregistrer les arrivées, gérer l’agenda, demander une autorisation.',
            'Les données médicales, les factures.',
          ],
          [
            'Le professionnel',
            'Lire les patients, mener les examens, prescrire, imprimer ses documents, gérer l’agenda.',
            'Les factures, la caisse.',
          ],
          [
            'La caissière',
            'Lire les patients, facturer, encaisser, remettre les articles, tenir sa caisse.',
            'Les données médicales.',
          ],
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Un compte cumule parfois plusieurs profils. La gérante peut accorder ou retirer un droit à une personne nommée (« Dérogation de droit »), avec un motif. Un compte n’est jamais supprimé : désactivé, il perd aussitôt l’accès mais reste l’auteur de ses actions passées.',
      },
      {
        kind: 'points',
        title: 'Tout est tracé, rien ne s’efface',
        items: [
          'Chaque action importante est consignée : qui, quand, quoi, et le motif quand il est demandé. Sont tracés notamment les fiches modifiées (ancienne et nouvelle valeur), les examens enregistrés, terminés et corrigés, les émissions, encaissements et corrections de pièces, les remises d’articles, les autorisations, les changements de droits, les connexions et les exports.',
          'Ouvrir un dossier médical est aussi tracé, sans recopier son contenu. Dans cette version, le journal n’a pas encore d’écran de lecture.',
          'Il n’existe aucun bouton pour effacer l’historique : une fiche modifiée garde ses anciennes valeurs, un examen terminé se corrige par une révision, une facture émise par une pièce de correction, et un reçu n’est jamais renuméroté.',
        ],
      },
      {
        kind: 'points',
        title: 'Sauvegardes et exports',
        items: [
          'Le prestataire sauvegarde les données chaque jour, de façon chiffrée, et avant chaque mise à jour. Avec une sauvegarde par jour, ce qui a été saisi depuis la dernière peut être à ressaisir après un incident grave.',
          'La gérante demande un export dans Paramètres, « Exports », puis « Demander l’export » ; le dossier d’un patient s’exporte depuis sa fiche avec « Exporter le dossier ». Le mot de passe est demandé, et l’archive reste disponible 48 heures (« Télécharger l’archive »). Elle contient des données de santé : conservez-la de façon sécurisée.',
        ],
      },
    ],
    related: [
      { route: 'mot-de-passe', label: 'Changer mon mot de passe' },
      { topic: 'profils', label: 'Les quatre profils du cabinet' },
      { topic: 'notion-approbations', label: 'Les approbations de la gérante' },
      { topic: 'notion-modules', label: 'Pourquoi un écran apparaît ou non' },
      { topic: 'exploitation', label: 'Exploitation : sauvegardes et restauration' },
    ],
    keywords: [
      'mot de passe',
      'connexion',
      'déconnexion',
      'session expirée',
      'droits',
      'permissions',
      'profil',
      'dérogation',
      'journal',
      'audit',
      'traçabilité',
      'confidentialité',
      'données de santé',
      'sauvegarde',
      'export',
      'confirmation du mot de passe',
    ],
  },
  {
    id: 'notion-modules',
    title: 'Pourquoi un écran apparaît ou non',
    summary:
      'Un écran n’apparaît que s’il est livré, ouvert par le prestataire et autorisé à votre profil.',
    module: null,
    anyPermission: [],
    intro:
      'L’application est découpée en modules (Aujourd’hui, Patients, Consultations, Agenda, Ventes et caisse, Stock, Paramètres…). Le menu n’affiche que ce que vous pouvez réellement utiliser : deux collègues voient donc rarement le même menu.',
    blocks: [
      {
        kind: 'flow',
        title: 'Trois conditions, toutes nécessaires',
        stages: [
          { label: 'Livré', text: 'L’écran existe dans la version installée de l’application.' },
          {
            label: 'Ouvert',
            text: 'Le prestataire a ouvert son module pour le cabinet, au fil de la mise en service. Ni vous ni la gérante ne le faites depuis l’application : l’écran « Paramètres » le rappelle.',
          },
          {
            label: 'Autorisé',
            text: 'Votre profil détient au moins un des droits de l’écran. La gérante règle les droits, compte par compte.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Il suffit qu’une condition manque pour que l’écran disparaisse du menu, de l’accueil et même de l’adresse tapée. Un module fermé reste fermé pour tous, gérante comprise.',
      },
      {
        kind: 'table',
        title: 'Les modules en bref',
        head: ['Module', 'Ce qu’il ouvre', 'Qui le voit en général'],
        rows: [
          [
            'Aujourd’hui',
            'File du jour, enregistrer une arrivée.',
            'Accueil, professionnel, caissière (lecture), gérante',
          ],
          ['Patients', 'Recherche, fiche, nouveau patient.', 'Tous les profils'],
          ['Consultations', 'Examens et prescriptions.', 'Professionnel, gérante'],
          ['Agenda', 'Rendez-vous et patients à rappeler.', 'Tous les profils'],
          [
            'Ventes et caisse',
            'Factures, devis, caisse, catalogue, règles fiscales.',
            'Caissière, gérante (catalogue : gérante)',
          ],
          [
            'Stock',
            'Disponibilités, stock d’ouverture, casse. Pas d’entrée de menu : la carte « Stock » se trouve dans « Ventes et caisse ».',
            'Selon le droit de lire le stock',
          ],
          [
            'Statistiques',
            'Bouton « Statistiques » de l’accueil, sans entrée de menu.',
            'Accueil (activité), professionnel (examens), gérante',
          ],
          ['Paramètres', 'Personnel, Cabinet et documents, Autorisations, Exports.', 'Gérante'],
        ],
      },
      {
        kind: 'faq',
        title: 'Les cas fréquents',
        items: [
          {
            q: 'Ma collègue voit « Consultations », pas moi. Est-ce une panne ?',
            a: 'Non. Vos profils n’ont pas les mêmes droits : « Consultations » demande de lire le dossier médical, ce que ne font ni l’accueil ni la caissière. Si une tâche de votre travail l’exige, demandez à la gérante d’attribuer le droit.',
          },
          {
            q: 'Je lis « Page introuvable ». Que faire ?',
            a: 'Soit l’adresse est fausse, soit le module est fermé : l’application répond de la même façon dans les deux cas. Revenez à l’accueil ; si l’écran devrait exister, demandez au prestataire si son module est ouvert.',
          },
          {
            q: 'Je lis « Accès refusé ». Que faire ?',
            a: 'Le module est ouvert mais votre compte n’a pas le droit de cet écran. Demandez à la gérante d’attribuer le droit nécessaire si cette tâche fait partie de votre travail.',
          },
          {
            q: 'L’accueil affiche « Aucune action d’accueil ouverte à ce compte ». Que faire ?',
            a: 'Aucun des raccourcis d’accueil n’est ouvert à votre compte. Si le menu montre des écrans, ouvrez-les par là ; sinon demandez à la gérante les droits nécessaires.',
          },
          {
            q: 'La gérante peut-elle ouvrir un module depuis « Paramètres » ?',
            a: 'Non. Les modules sont ouverts par le prestataire lors du déploiement, jamais depuis cet écran.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'warning',
        text: 'Pas encore disponibles dans cette version : l’atelier (commandes de verres), la communication (relances et campagnes) et le travail sans connexion Internet. Ne les annoncez pas à un patient.',
      },
    ],
    related: [
      { topic: 'se-reperer', label: 'Se repérer dans l’application' },
      { topic: 'profils', label: 'Les quatre profils du cabinet' },
      { topic: 'notion-securite', label: 'Sécurité : compte, droits et traçabilité' },
      { route: 'accueil', label: 'Accueil' },
    ],
    keywords: [
      'menu',
      'écran manquant',
      'écran absent',
      'page introuvable',
      'accès refusé',
      'module fermé',
      'module',
      'droits',
      'mise en service',
      'exploitant',
      'prestataire',
    ],
  },
]
