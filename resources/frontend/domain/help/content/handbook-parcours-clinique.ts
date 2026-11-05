import type { HandbookTopic } from '../model'

/**
 * Parcours pas à pas, accueil et clinique : accueillir, rendez-vous, examen, ordonnance, suivi.
 * Chaque rubrique suit le travail réel, écran par écran, avec les libellés exacts de l’application.
 */
export const TOPICS_PARCOURS_CLINIQUE: readonly HandbookTopic[] = [
  {
    id: 'parcours-accueillir',
    title: 'Accueillir un patient, de la recherche à la file du jour',
    summary:
      'Retrouver ou créer la fiche, vérifier les doublons, enregistrer l’arrivée, puis suivre le patient dans la file du jour.',
    module: 'patients',
    anyPermission: ['patient.create', 'visit.register'],
    audience: ['RECEPTION', 'MANAGER'],
    intro:
      'Quand un patient se présente, vous cherchez sa fiche, vous la créez seulement si elle n’existe pas, puis vous enregistrez son arrivée.',
    blocks: [
      {
        kind: 'flow',
        title: 'Les quatre temps',
        stages: [
          {
            label: '1. Chercher',
            text: 'Nom, téléphone ou numéro de dossier, avant toute création.',
          },
          {
            label: '2. Créer si besoin',
            text: 'Une fiche neuve seulement si personne ne correspond.',
          },
          {
            label: '3. Enregistrer l’arrivée',
            text: 'Le motif de la visite place le patient dans la file du jour.',
          },
          {
            label: '4. Suivre la file',
            text: 'Le statut de la visite change au fil de l’examen.',
          },
        ],
      },
      {
        kind: 'steps',
        title: 'Retrouver la fiche',
        items: [
          'Cliquez sur « Rechercher » sur l’accueil, ou ouvrez « Patients » dans le menu.',
          'Saisissez au moins 2 caractères dans « Rechercher un patient » : un nom, un téléphone ou un numéro comme EE-2026-0001.',
          'Cliquez sur « Rechercher ». Les accents, les majuscules et l’ordre des mots n’ont pas d’importance ; un téléphone se retrouve avec ou sans indicatif.',
          'Comparez le dossier, l’âge et le téléphone sous chaque nom, puis cliquez sur le bon patient.',
        ],
      },
      {
        kind: 'steps',
        title: 'Créer la fiche si elle n’existe pas',
        items: [
          'Cliquez sur « Nouveau patient » en haut de l’écran, ou sur « Créer un nouveau patient » sous les résultats.',
          'Remplissez « Nom » (obligatoire), « Prénom(s) », « Sexe », « Date de naissance » (JJ/MM/AAAA) et « Téléphone principal ».',
          'Date ou téléphone inconnus ? Laissez le champ vide, puis remplissez « Raison de l’absence de date de naissance » ou « Raison de l’absence de téléphone ».',
          'Cliquez sur « Enregistrer le patient ». La fiche s’ouvre avec son numéro de dossier, du type EE-2026-0001.',
          'Si « Des fiches ressemblent à ce patient » s’affiche à la place, comparez avec les fiches proposées. « Ouvrir la fiche » les ouvre dans un nouvel onglet.',
          'Même personne : « Revenir au formulaire », puis « Annuler ». Autre personne : « Créer quand même ».',
        ],
      },
      {
        kind: 'steps',
        title: 'Enregistrer l’arrivée',
        items: [
          'Cliquez sur « Enregistrer une arrivée », sur la fiche du patient ou dans « Aujourd’hui » (cherchez alors le patient dans « Patient »).',
          'Choisissez le « Motif de la visite » : « Examen de vue », « Achat direct », « Retrait de commande » ou « Contrôle de suivi ». Un achat ou un retrait ne crée aucun examen.',
          'Au besoin, ajoutez une « Note administrative (facultative) » : jamais d’information médicale.',
          'Cliquez sur « Enregistrer l’arrivée ». La file du jour s’ouvre avec le message « Arrivée enregistrée ».',
        ],
      },
      {
        kind: 'steps',
        title: 'Suivre la file du jour',
        items: [
          'Ouvrez « Aujourd’hui ». Chaque visite montre l’heure, le motif et un statut : « Arrivé », « En consultation », « Terminé » ou « Annulé ».',
          'Pour un autre jour, cliquez sur « Jour précédent » ou « Jour suivant ». « Actualiser la file » relit la liste.',
          'Le patient repart avant l’examen ? Cliquez sur « Annuler la visite », écrivez le « Motif de l’annulation (obligatoire) », puis confirmez. La visite reste dans la file, marquée « Annulé ».',
        ],
      },
      {
        kind: 'note',
        tone: 'warning',
        text: 'Ne créez pas une deuxième fiche pour aller plus vite : un doublon coupe l’historique du patient en deux. Seule la gérante peut réunir deux fiches, avec « Fusionner avec une autre fiche ».',
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Un même téléphone peut servir à plusieurs patients, par exemple une famille : ce n’est pas une erreur. Seul le nom est toujours obligatoire, et aucune date de naissance n’est inventée.',
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Le marqueur « Paiement de l’examen non contrôlé » veut dire que le cabinet n’a pas activé ce contrôle : l’examen n’est pas bloqué et rien n’est dit du règlement. Contrôle actif : l’examen attend la facture de frais encaissée ou une dispense accordée par la gérante, que « Demander une dispense des frais d’examen » sollicite.',
      },
      {
        kind: 'faq',
        title: 'Si ça ne marche pas',
        items: [
          {
            q: 'Le bouton « Enregistrer une arrivée » n’apparaît pas sur la fiche.',
            a: 'Votre compte n’a pas ce droit, l’écran « Aujourd’hui » n’est pas ouvert dans votre cabinet, ou la fiche est archivée ou fusionnée. Demandez à la gérante.',
          },
          {
            q: 'L’écran dit « Recherche serveur indisponible ».',
            a: 'Cela ne prouve pas que le patient n’existe pas. Réessayez avant de créer une fiche.',
          },
        ],
      },
    ],
    related: [
      { route: 'patients', label: 'Patients', why: 'Rechercher une fiche avant de la créer.' },
      {
        route: 'patient-nouveau',
        label: 'Nouveau patient',
        why: 'Le formulaire de création, champ par champ.',
      },
      {
        route: 'arrivee',
        label: 'Enregistrer une arrivée',
        why: 'Le motif de la visite et la note d’accueil.',
      },
      { route: 'aujourdhui', label: 'Aujourd’hui', why: 'La file du jour et ses statuts.' },
      { topic: 'notion-patient', label: 'Le dossier patient et l’identité' },
      {
        topic: 'parcours-examen',
        label: 'Faire l’examen de vue',
        why: 'La suite quand le patient passe en consultation.',
      },
    ],
    keywords: [
      'accueil',
      'arrivée',
      'arrivée du patient',
      'nouveau patient',
      'créer une fiche',
      'inscrire un patient',
      'doublon',
      'recherche',
      'file du jour',
      'file d’attente',
      'visite',
      'annuler une visite',
      'motif de la visite',
    ],
  },
  {
    id: 'parcours-rendez-vous',
    title: 'Prendre, déplacer et annuler un rendez-vous',
    summary:
      'Prendre un rendez-vous dans l’agenda, le déplacer ou l’annuler, enregistrer l’arrivée du patient et noter une absence.',
    module: 'agenda',
    anyPermission: ['agenda.write'],
    audience: ['RECEPTION', 'MANAGER'],
    intro:
      'Le rendez-vous se prend dans l’agenda, pour un patient qui a une fiche, et il n’est confirmé que lorsque le serveur a répondu.',
    blocks: [
      {
        kind: 'flow',
        title: 'Le cycle d’un rendez-vous',
        stages: [
          {
            label: '1. Préparer',
            text: 'La gérante règle professionnels, salles, horaires et prestations dans « Configuration ».',
          },
          {
            label: '2. Prendre',
            text: 'Patient, prestation, ressource, jour, créneau libre, puis confirmation.',
          },
          {
            label: '3. Changer',
            text: 'Déplacer ou annuler avant l’heure, noter l’absence après.',
          },
          {
            label: '4. Accueillir',
            text: 'Le jour même, « Enregistrer l’arrivée » ouvre l’arrivée avec le patient déjà choisi.',
          },
        ],
      },
      {
        kind: 'steps',
        title: 'Prendre un rendez-vous',
        items: [
          'Cliquez sur « Rendez-vous » sur l’accueil, ou sur « Nouveau rendez-vous » dans l’agenda.',
          'Étape « Patient » : cherchez le patient dans « Rechercher un patient », cliquez sur « Rechercher », puis sur sa ligne.',
          'Étape « Prestation et ressource » : choisissez la « Prestation », puis le « Professionnel ou salle ».',
          'Étape « Jour et créneau » : saisissez le « Jour », puis cochez un créneau libre. Le jour proposé au départ est aujourd’hui : vérifiez-le.',
          'Étape « Note et confirmation » : écrivez au besoin une « Note administrative (facultative) », puis cliquez sur « Confirmer le rendez-vous ».',
          'Attendez « Rendez-vous confirmé par le serveur ». « Autre rendez-vous » en prend un second pour le même patient.',
        ],
      },
      {
        kind: 'steps',
        title: 'Retrouver, déplacer, annuler',
        items: [
          'Ouvrez « Agenda ». Choisissez « Jour » ou « Semaine », puis avancez avec « Jour suivant » ou « Semaine suivante ».',
          'Pour une date précise, saisissez-la dans « Jour » et cliquez sur « Afficher ». « Ressource » limite la vue à un professionnel ou une salle.',
          'Pour changer l’heure : « Déplacer », un « Nouveau jour » et un créneau, puis « Déplacer le rendez-vous ».',
          'Pour annuler : « Annuler », le « Motif de l’annulation (obligatoire) », puis « Annuler le rendez-vous ». Le créneau est libéré.',
          'Le patient ne vient pas : une fois l’heure passée, cliquez sur « Absent ».',
        ],
      },
      {
        kind: 'steps',
        title: 'Le jour du rendez-vous',
        items: [
          'Quand le patient arrive, cliquez sur « Enregistrer l’arrivée » sur la carte de son rendez-vous. Ce bouton n’existe que le jour même.',
          'L’écran « Enregistrer une arrivée » s’ouvre avec le patient choisi et le message « Arrivée liée au rendez-vous de l’agenda ». Choisissez le motif, puis « Enregistrer l’arrivée » : le rendez-vous passe « Arrivé ».',
        ],
      },
      {
        kind: 'note',
        tone: 'warning',
        text: 'Un créneau pris entre-temps par une autre personne est refusé : l’écran le dit et relit les créneaux libres. Choisissez-en un autre.',
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Si l’écran affiche « Agenda non configuré », la gérante doit d’abord créer une prestation et une ressource avec leurs créneaux hebdomadaires dans « Configuration » : aucun horaire n’est proposé par défaut.',
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Un rendez-vous est toujours pris pour un patient qui a une fiche : créez la fiche d’abord si besoin. La note du rendez-vous reste administrative, jamais médicale.',
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'L’application n’envoie aucun SMS ni aucun message WhatsApp dans cette version. Pour rappeler un rendez-vous, appelez ou écrivez vous-même au patient.',
      },
    ],
    related: [
      { route: 'agenda', label: 'Agenda', why: 'Voir, déplacer et annuler les rendez-vous.' },
      {
        route: 'rendez-vous-nouveau',
        label: 'Nouveau rendez-vous',
        why: 'Le formulaire en quatre étapes.',
      },
      {
        route: 'agenda-configuration',
        label: 'Configuration de l’agenda',
        why: 'Pour la gérante : professionnels, salles, horaires, prestations.',
      },
      { route: 'arrivee', label: 'Enregistrer une arrivée' },
      { topic: 'parcours-accueillir', label: 'Accueillir un patient' },
      { topic: 'parcours-suivi', label: 'Suivre le patient : contrôle recommandé' },
    ],
    keywords: [
      'agenda',
      'rdv',
      'rendez-vous',
      'créneau',
      'reporter',
      'décaler',
      'absent',
      'absence',
      'annulation',
      'prestation',
      'planning',
    ],
  },
  {
    id: 'parcours-examen',
    title: 'Examen de vue : démarrer, saisir, terminer, corriger, comparer',
    summary:
      'Démarrer l’examen (« Nouvelle consultation » ou file du jour), remplir les sept étapes, le terminer, le corriger par une révision et comparer des révisions.',
    module: 'consultations',
    anyPermission: ['clinical.read'],
    audience: ['CLINICIAN', 'MANAGER'],
    intro:
      'L’examen se fait en sept étapes enregistrées une à une sur le serveur, et un examen terminé ne s’efface plus : il se corrige par une nouvelle révision.',
    blocks: [
      {
        kind: 'flow',
        title: 'Du démarrage à la correction',
        stages: [
          {
            label: '1. Démarrer',
            text: '« Nouvelle consultation », ou « Démarrer l’examen » dans « Aujourd’hui ».',
          },
          { label: '2. Saisir', text: 'Sept étapes ; « Suivant » enregistre.' },
          {
            label: '3. Terminer',
            text: 'La révision 1 est figée, l’examen passe en lecture seule.',
          },
          { label: '4. Corriger', text: 'Une nouvelle révision, avec un motif.' },
          { label: '5. Comparer', text: 'Deux révisions côte à côte.' },
        ],
      },
      {
        kind: 'steps',
        title: 'Démarrer l’examen',
        items: [
          'Cliquez sur « Nouvelle consultation » (accueil ou écran « Consultations ») : choisissez le patient qui attend dans « Dans la file du jour », ou cherchez-le dans « Un autre patient », puis cliquez sur « Démarrer l’examen ».',
          'Un patient qui n’est pas encore dans la file : « Enregistrer l’arrivée et démarrer l’examen » enregistre son arrivée (motif « Examen de vue »), puis démarre l’examen.',
          'Autre chemin : ouvrez « Aujourd’hui » et, sur la carte du patient arrivé, cliquez sur « Démarrer l’examen ».',
          'Vérifiez le nom du patient dans l’en-tête de la consultation avant de saisir.',
          'Examen commencé : « Reprendre l’examen ». Examen terminé : « Consulter l’examen ». L’écran « Consultations » liste tous les examens.',
        ],
      },
      {
        kind: 'table',
        title: 'Les sept étapes',
        head: ['Étape', 'Ce que vous notez, ce qu’il faut savoir'],
        rows: [
          [
            '« Motif et lunettes »',
            'Motifs cochés, « Plaintes et symptômes », lunettes portées. « Autre » demande une précision.',
          ],
          [
            '« Antécédents »',
            'Trois groupes. « Aucun connu » est un vrai choix ; un groupe sans case cochée reste « non renseigné ».',
          ],
          [
            '« Acuité visuelle »',
            'Valeur lue pour OD (œil droit), OG (œil gauche) et OU (les deux yeux), avec l’échelle de chaque groupe ; des boutons proposent les valeurs usuelles. Case vide : « non mesuré ».',
          ],
          [
            '« Réfraction »',
            '« Autoréfracteur », « Réfraction objective » et « Réfraction subjective » : trois mesures séparées (sphère, cylindre, axe). L’« Écart pupillaire total (mm) » du ticket se saisit sous l’autoréfracteur.',
          ],
          [
            '« Centrage »',
            'Écarts pupillaires en millimètres : l’écart total saisi à la réfraction y apparaît déjà. La somme OD + OG est proposée, vous la reportez vous-même.',
          ],
          [
            '« Médicaments »',
            'Jusqu’à 20 médicaments en texte libre ; « Nom du médicament » et « Forme » obligatoires. Aucune vente ni sortie de stock n’est créée.',
          ],
          [
            '« Conclusion et orientation »',
            '« Conclusion » et « Orientation vers un ophtalmologiste ». Avec Oui, le « Niveau d’urgence » est obligatoire.',
          ],
        ],
      },
      {
        kind: 'steps',
        title: 'Saisir une étape',
        items: [
          'Remplissez l’étape, puis cliquez sur « Suivant » : elle s’enregistre, avec l’heure et « Enregistré sur le serveur ».',
          '« Enregistrer » garde l’étape sans avancer ; « Précédent » revient en arrière. Une étape modifiée porte « non enregistrée » jusqu’à son enregistrement.',
          'Une rubrique laissée vide reste « non renseignée » : ce n’est ni « Non », ni « Aucun connu », ni zéro.',
          '« Enregistrement non confirmé » ? Cliquez sur « Réessayer l’enregistrement » : la même saisie repart, sans doublon.',
        ],
      },
      {
        kind: 'steps',
        title: 'Terminer l’examen',
        items: [
          'Une fois les étapes enregistrées, cliquez sur « Terminer l’examen ». La fenêtre liste les « Rubriques non renseignées ».',
          'S’il manque le motif ou les plaintes, ou la conclusion, la « Justification d’absence » devient obligatoire.',
          'Confirmez : « Examen terminé » s’affiche, la révision 1 est figée et la visite passe « Terminé ».',
          'Pour le règlement, cliquez sur « Transmettre à la caisse » (comptes qui facturent) : la facture s’ouvre avec le patient et la visite déjà choisis. Sinon, la caissière clique sur « Créer une facture » depuis « Aujourd’hui ».',
        ],
      },
      {
        kind: 'steps',
        title: 'Corriger un examen terminé',
        items: [
          'Cliquez sur « Corriger l’examen » : « Correction en cours » s’affiche.',
          'Modifiez les étapes. « Suivant » change d’étape sans rien enregistrer.',
          'Écrivez le motif dans « Pourquoi corrigez-vous cet examen ? » (3 caractères au moins), puis cliquez sur « Enregistrer la correction ».',
          'Les étapes modifiées partent ensemble dans une nouvelle révision. « Abandonner la correction » annule tout.',
        ],
      },
      {
        kind: 'steps',
        title: 'Comparer deux révisions',
        items: [
          'Sur un examen terminé, cliquez sur « Révisions et comparaison ». « Actuelle » marque la dernière révision.',
          'Choisissez « Révision de référence » et « Révision à comparer ». Chaque ligne indique « Identique », « Modifié », « Ajouté » ou « Retiré ».',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Pour relire un ancien examen, ouvrez l’onglet « Activité » du dossier, puis « Examen de vue ». L’écran « Comparer deux examens » existe, mais aucun bouton ne l’ouvre encore : ouvrez les deux examens l’un après l’autre.',
      },
      {
        kind: 'note',
        tone: 'warning',
        text: 'L’application enregistre ce que vous saisissez et ne pose aucun diagnostic : aucune acuité n’est convertie d’une échelle à l’autre, aucun cylindre positif n’est transposé.',
      },
      {
        kind: 'faq',
        title: 'Si ça ne marche pas',
        items: [
          {
            q: 'Le bouton « Démarrer l’examen » n’apparaît pas.',
            a: 'Il faut un compte autorisé à saisir un examen et une visite « Examen de vue » ou « Contrôle de suivi » au statut « Arrivé » ou « Prêt pour l’examen ». Un « Achat direct » ou un « Retrait de commande » n’a pas d’examen.',
          },
          {
            q: 'L’écran affiche « Aucune échelle d’acuité n’est configurée pour ce cabinet ».',
            a: 'Les acuités ne peuvent pas être saisies tant que l’échelle du cabinet n’est pas créée. Prévenez la personne qui a installé l’application ; les autres étapes restent utilisables.',
          },
        ],
      },
    ],
    related: [
      { route: 'aujourdhui', label: 'Aujourd’hui', why: 'Démarrer ou reprendre un examen.' },
      { route: 'consultations', label: 'Consultations', why: 'Retrouver les examens du cabinet.' },
      { topic: 'parcours-ordonnance', label: 'Prescription optique et ordonnances' },
      {
        topic: 'notion-examen-prescription',
        label: 'Examen et prescription : ce qui est définitif',
      },
      { topic: 'notion-visite-examen', label: 'Visite et examen' },
      {
        topic: 'glossaire-optique',
        label: 'Glossaire de l’optique',
        why: 'Sphère, cylindre, axe, addition, OD, OG.',
      },
    ],
    keywords: [
      'consultation',
      'examen de vue',
      'saisir un examen',
      'étapes',
      'terminer',
      'finaliser',
      'corriger',
      'révision',
      'comparer',
      'acuité',
      'réfraction',
      'antécédents',
      'orientation',
      'dossier clinique',
    ],
  },
  {
    id: 'parcours-ordonnance',
    title: 'Prescription optique et ordonnances : rédiger, valider, imprimer',
    summary:
      'Rédiger et valider la prescription optique, créer une nouvelle version, transcrire une ordonnance externe et imprimer les documents.',
    module: 'consultations',
    anyPermission: ['clinical.read'],
    audience: ['CLINICIAN', 'MANAGER'],
    intro:
      'Un brouillon se modifie, une version validée ne change plus : pour la corriger, on crée une nouvelle version.',
    blocks: [
      {
        kind: 'flow',
        title: 'Le cycle d’une prescription optique',
        stages: [
          { label: '1. Rédiger', text: 'Le brouillon se modifie autant que nécessaire.' },
          {
            label: '2. Valider',
            text: 'La version devient définitive. Aucune vente ni sortie de stock n’est créée.',
          },
          { label: '3. Imprimer', text: 'Aperçu du PDF, puis impression ou téléchargement.' },
          { label: '4. Corriger', text: 'Une nouvelle version prend le relais.' },
        ],
      },
      {
        kind: 'table',
        title: 'Quel document, où, quand l’imprimer',
        head: ['Document', 'Où le rédiger', 'Quand il s’imprime'],
        rows: [
          [
            'Prescription optique',
            'Examen terminé, puis « Prescription optique »',
            'À partir de la version validée. Jamais en brouillon.',
          ],
          [
            'Ordonnance de médicaments',
            'Étape « Médicaments » de l’examen',
            'Examen terminé, avec au moins un médicament saisi.',
          ],
          [
            'Lettre d’orientation',
            'Étape « Conclusion et orientation », orientation « Oui »',
            'Examen terminé.',
          ],
          [
            'Ordonnance externe',
            'Dossier du patient, onglet « Prescriptions »',
            'Aucune impression : le papier d’origine existe déjà.',
          ],
        ],
      },
      {
        kind: 'steps',
        title: 'Rédiger et valider la prescription optique',
        items: [
          'Ouvrez l’examen terminé, puis cliquez sur « Prescription optique ».',
          'Cliquez sur « Nouvelle prescription ». Le formulaire porte la mention « BROUILLON : ne pas remettre au patient tant qu’elle n’est pas validée ».',
          'Dans « Correction », saisissez sphère, cylindre, axe et addition pour OD puis OG, ou cochez « aucune correction » pour l’œil concerné.',
          'Pour recopier l’examen : « Copier une mesure de réfraction… », puis la « Mesure à copier » et « Copier dans la prescription ». L’examen n’est pas modifié.',
          'Écarts pupillaires : « Reporter les écarts du centrage », ou saisie à la main. Complétez au besoin « Usage », « Type de verre », « Indice », « Traitements » et « Observations ».',
          'Cliquez sur « Enregistrer le brouillon », puis sur « Valider la prescription ». La version est « Validée » et ne change plus.',
        ],
      },
      {
        kind: 'steps',
        title: 'Corriger une prescription validée',
        items: [
          'Sur la dernière version, cliquez sur « Créer une nouvelle version » : ses valeurs sont reprises dans un nouveau brouillon.',
          'Modifiez, « Enregistrer le brouillon », puis « Valider la prescription ». L’ancienne version reste lisible sous « Versions précédentes ».',
        ],
      },
      {
        kind: 'steps',
        title: 'Ordonnance de médicaments et lettre d’orientation',
        items: [
          'Saisissez les médicaments à l’étape « Médicaments » et l’orientation à l’étape « Conclusion et orientation ».',
          'Terminez l’examen. Sous « Documents de l’examen », cliquez sur « Aperçu de l’ordonnance de médicaments » ou « Aperçu de la lettre d’orientation ».',
          'Après une correction de l’examen, imprimez-les de nouveau : ils suivent la nouvelle révision.',
        ],
      },
      {
        kind: 'steps',
        title: 'Transcrire une ordonnance externe',
        items: [
          'Dossier du patient, onglet « Prescriptions », puis « Transcrire une ordonnance externe ».',
          'Renseignez « Prescripteur » et « Date de l’ordonnance », puis recopiez les valeurs telles qu’elles sont écrites sur le papier.',
          '« Enregistrer le brouillon », puis « Valider la prescription ». Aucun examen n’est créé.',
        ],
      },
      {
        kind: 'steps',
        title: 'Imprimer',
        items: [
          'Sur l’écran « Prescription optique », section « Imprimer la prescription », cliquez sur « Aperçu de la prescription ».',
          'Vérifiez patient, OD puis OG et version. Cliquez sur « Imprimer » (le PDF s’ouvre dans le navigateur : Ctrl+P) ou sur « Télécharger le PDF ».',
          'Le PDF laisse un cadre « Signature et cachet du professionnel » : signez et apposez le cachet sur le papier.',
        ],
      },
      {
        kind: 'note',
        tone: 'warning',
        text: 'Un brouillon ne s’imprime jamais : le bouton d’aperçu n’apparaît qu’à partir d’une version validée.',
      },
      {
        kind: 'note',
        tone: 'warning',
        text: 'Tant que les mentions officielles du cabinet ne sont pas validées à la mise en service, chaque PDF porte « DOCUMENT DE TEST ». Ne le remettez pas comme pièce officielle.',
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Rien n’est calculé, transposé ni complété : « 0,00 » est une valeur, une valeur non saisie reste un tiret. Un cylindre non nul exige un axe.',
      },
      {
        kind: 'faq',
        title: 'Si ça ne marche pas',
        items: [
          {
            q: 'Le bouton « Valider la prescription » est absent ou grisé.',
            a: 'Absent : le brouillon n’est pas encore enregistré, ou votre compte n’a pas le droit de valider. Grisé : des modifications ne sont pas enregistrées. Cliquez sur « Enregistrer le brouillon ».',
          },
          {
            q: 'Je ne vois pas « Aperçu de la lettre d’orientation ».',
            a: 'L’examen doit être terminé et l’orientation doit être « Oui ». L’ordonnance de médicaments demande au moins un médicament saisi.',
          },
        ],
      },
    ],
    related: [
      { route: 'consultations', label: 'Consultations', why: 'Retrouver l’examen concerné.' },
      { topic: 'parcours-examen', label: 'Faire l’examen de vue' },
      { topic: 'notion-documents', label: 'Les documents PDF' },
      {
        topic: 'notion-examen-prescription',
        label: 'Examen et prescription : ce qui est définitif',
      },
      { topic: 'parcours-suivi', label: 'Suivre le patient : contrôle recommandé' },
      {
        topic: 'glossaire-optique',
        label: 'Glossaire de l’optique',
        why: 'Prescription optique, ordonnance externe, orientation.',
      },
    ],
    keywords: [
      'prescription',
      'ordonnance',
      'lunettes',
      'verres',
      'valider',
      'brouillon',
      'imprimer',
      'PDF',
      'lettre d’orientation',
      'ordonnance externe',
      'médicaments',
      'nouvelle version',
    ],
  },
  {
    id: 'parcours-suivi',
    title: 'Suivre le patient : contrôle recommandé et patients à rappeler',
    summary:
      'Programmer un contrôle recommandé, travailler la liste des patients à rappeler et noter chaque contact. L’application n’envoie aucun message.',
    module: 'agenda',
    anyPermission: ['agenda.read'],
    audience: ['CLINICIAN', 'RECEPTION', 'MANAGER'],
    intro:
      'Le professionnel programme un contrôle recommandé pendant l’examen ; l’accueil le retrouve dans la liste, appelle le patient lui-même, puis note le résultat.',
    blocks: [
      {
        kind: 'flow',
        title: 'De l’examen au rendez-vous de contrôle',
        stages: [
          {
            label: '1. Programmer',
            text: 'Le professionnel choisit le délai dans la carte « Contrôle recommandé » de l’examen.',
          },
          {
            label: '2. Attendre',
            text: 'La date est calculée ; le rappel interne apparaît à son échéance.',
          },
          {
            label: '3. Contacter',
            text: 'L’accueil appelle ou écrit lui-même au patient.',
          },
          {
            label: '4. Noter',
            text: '« Noter un contact » garde le résultat de chaque tentative.',
          },
          {
            label: '5. Rendez-vous',
            text: '« Programmer un rendez-vous » réserve une heure dans l’agenda.',
          },
        ],
      },
      {
        kind: 'steps',
        title: 'Programmer un contrôle recommandé (professionnel, gérante)',
        items: [
          'Ouvrez l’examen du patient. Sous le formulaire, la carte « Contrôle recommandé » liste les contrôles déjà programmés.',
          'Cliquez sur « Programmer un contrôle ». Le formulaire s’ouvre avec des valeurs de départ : changez-les, le délai est votre choix.',
          'Choisissez le « Motif du contrôle » : « Contrôle de routine », « Contrôle après collyre » ou « Autre contrôle ».',
          'Choisissez la « Date de départ » : « Date de la consultation », « Début du traitement », « Fin du traitement » ou « Date saisie à la main » (motif obligatoire).',
          'Choisissez le « Délai » : de « 10 jours » à « 2 ans », ou « Autre délai ». Vérifiez la « Date recommandée », calculée au calendrier civil.',
          'Réglez « Rappel interne », « Quand rappeler » et « Canal souhaité par le patient », puis cliquez sur « Enregistrer le contrôle ». Le contrôle apparaît avec le statut « À programmer ».',
        ],
      },
      {
        kind: 'steps',
        title: 'Travailler la liste des patients à rappeler',
        items: [
          'Ouvrez « Patients à rappeler » : raccourci de l’accueil, ou bouton de l’écran « Agenda ».',
          'La section « À contacter le » liste les rappels dus, retards compris. Pour un autre jour, choisissez « Jour » puis « Afficher ».',
          'Appelez ou écrivez au patient vous-même : l’application n’envoie aucun SMS ni WhatsApp dans cette version.',
          'Cliquez sur « Noter un contact ». Choisissez le « Résultat » : « Contacté », « RDV pris », « Sans réponse », « Refus », « Reporté » ou « Échec (numéro injoignable…) », puis « Enregistrer la tentative ».',
          'Après « Sans réponse », la « Suite » est « Sans réponse » ou « Reporté ». Un report demande « Rappeler le (obligatoire) » ; sans « Heure », 09:00 est retenu.',
          'Pour « RDV pris », choisissez le « Rendez-vous pris » parmi les rendez-vous confirmés des 30 prochains jours.',
        ],
      },
      {
        kind: 'steps',
        title: 'Programmer le rendez-vous du contrôle',
        items: [
          'Cliquez sur « Programmer un rendez-vous » sur la carte du contrôle ou de la tâche. Le patient est déjà choisi.',
          'Choisissez prestation, ressource, jour et créneau, puis « Confirmer le rendez-vous ». L’écran annonce « Ce rendez-vous programme un contrôle recommandé ».',
          'Le contrôle passe « Rendez-vous programmé ». Si le rendez-vous est annulé ou manqué, il redevient « À programmer ».',
          'Le jour du contrôle, enregistrez l’arrivée avec le motif « Contrôle de suivi ».',
        ],
      },
      {
        kind: 'note',
        tone: 'warning',
        text: 'Le « Canal souhaité par le patient » est une préférence, pas un envoi : « SMS, à envoyer soi-même » veut dire que vous envoyez le message vous-même.',
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Un contrôle recommandé ne réserve aucune heure : c’est un rappel de travail, pas un rendez-vous.',
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'L’accueil voit la date, le canal et le statut du contrôle, mais pas son motif, réservé aux comptes qui lisent le dossier médical. Un patient n’est jamais relancé deux fois pour la même échéance.',
      },
      {
        kind: 'faq',
        title: 'Si ça ne marche pas',
        items: [
          {
            q: 'La liste « Patients à rappeler » est vide.',
            a: 'Elle montre les rappels dus au jour choisi, retards compris. Changez le « Jour », ou regardez « À revoir dans les 30 jours ». Le « Rappel interne » coché sur le contrôle fait apparaître le patient ici à la date du rappel.',
          },
          {
            q: 'Le bouton « Noter un contact » n’apparaît pas.',
            a: 'Votre compte lit la liste sans pouvoir noter de contact (c’est le cas de la caisse), ou la tâche est déjà traitée.',
          },
        ],
      },
    ],
    related: [
      { route: 'suivis', label: 'Patients à rappeler', why: 'La liste de travail du jour.' },
      { route: 'agenda', label: 'Agenda' },
      { route: 'rendez-vous-nouveau', label: 'Nouveau rendez-vous' },
      { topic: 'parcours-rendez-vous', label: 'Prendre, déplacer et annuler un rendez-vous' },
      { topic: 'parcours-examen', label: 'Faire l’examen de vue' },
      { topic: 'depannage-limites', label: 'Ce que cette version ne fait pas encore' },
    ],
    keywords: [
      'contrôle recommandé',
      'rappel',
      'relance',
      'rappeler un patient',
      'patients à rappeler',
      'revoir',
      'recontrôle',
      'sms',
      'whatsapp',
      'tâche de contact',
      'suivi',
    ],
  },
]
