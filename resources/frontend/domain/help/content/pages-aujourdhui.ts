import type { PageHelp } from '../model'

/**
 * Aide des écrans « Aujourd’hui » (la file du jour) et « Enregistrer une arrivée » (module today).
 * Sources : pages/today, domain/patients/visits.ts, patients.md, scénarios de recette AT05 et AT06.
 */
export const PAGES_AUJOURDHUI: readonly PageHelp[] = [
  {
    route: 'aujourdhui',
    title: 'Aujourd’hui',
    module: 'today',
    anyPermission: ['visit.register', 'agenda.read'],
    purpose:
      'Voici la file du jour : les patients arrivés au cabinet, avec l’état de chaque visite et la suite à donner. L’accueil y suit les arrivées, le professionnel démarre l’examen et la caissière crée la facture.',
    actions: [
      {
        label: 'Enregistrer une arrivée',
        effect: 'Ouvre l’écran d’arrivée pour inscrire dans la file un patient qui se présente.',
        anyPermission: ['visit.register'],
      },
      {
        label: 'Jour précédent',
        effect:
          'Affiche la file de la veille du jour affiché ; « Jour suivant » affiche celle du lendemain.',
      },
      {
        label: 'Aujourd’hui',
        effect: 'Revient à la file d’aujourd’hui (jour du cabinet) et la relit sur le serveur.',
      },
      {
        label: 'Jour affiché',
        effect:
          'Champ de date : saisissez JJ/MM/AAAA ou 8 chiffres (15102026), puis appuyez sur Entrée pour afficher la file de ce jour.',
      },
      {
        label: 'Actualiser la file',
        effect:
          'Relit la file sur le serveur : nouvelles arrivées, statuts changés, visites annulées.',
      },
      {
        label: 'Démarrer l’examen',
        effect:
          'Crée l’examen de la visite et ouvre l’écran « Consultation ». Proposé aux visites d’examen ou de suivi pas encore examinées.',
        anyPermission: ['clinical.write'],
      },
      {
        label: 'Reprendre l’examen',
        effect:
          'Rouvre l’examen commencé. Une fois l’examen terminé, le bouton s’appelle « Consulter l’examen ».',
        anyPermission: ['clinical.read'],
      },
      {
        label: 'Créer une facture',
        effect:
          'Ouvre « Nouvelle facture » avec le patient et la visite déjà choisis. Absent d’une visite annulée.',
        anyPermission: ['invoice.create', 'exam_fee.collect'],
      },
      {
        label: 'Annuler la visite',
        effect:
          'Demande un motif, puis annule la visite avant l’examen : elle reste dans la file, marquée « Annulé ».',
        anyPermission: ['visit.register'],
      },
      {
        label: 'Demander une dispense des frais d’examen',
        effect:
          'Envoie à la gérante une demande de dispense pour cette visite. Proposé seulement quand le marqueur indique « Frais d’examen à encaisser ».',
        anyPermission: ['approval.request'],
      },
    ],
    tasks: [
      {
        id: 'suivre-la-file',
        title: 'Suivre les arrivées du jour',
        steps: [
          'Ouvrez « Aujourd’hui » dans le menu : la file s’affiche, de l’arrivée la plus ancienne à la plus récente.',
          'Lisez chaque visite : heure d’arrivée, motif, statut, état du paiement de l’examen et, s’il y en a une, note d’accueil.',
          'Cliquez sur « Actualiser la file » pour voir les nouvelles arrivées : l’écran ne se met pas à jour tout seul.',
          'Pour un autre jour, cliquez sur « Jour précédent » ou « Jour suivant », ou saisissez une date dans « Jour affiché ».',
          'Le bouton « Aujourd’hui », entre « Jour précédent » et « Jour suivant », ramène au jour en cours.',
          'Si la file compte plusieurs pages, utilisez « Page précédente » et « Page suivante » sous la liste.',
          'Si votre compte peut lire les fiches, cliquez sur le nom d’un patient pour ouvrir son dossier.',
        ],
        result:
          'Vous voyez qui attend, qui est en consultation, qui a terminé et quelles visites sont annulées.',
      },
      {
        id: 'demarrer-un-examen',
        title: 'Démarrer l’examen d’un patient arrivé',
        anyPermission: ['clinical.read'],
        steps: [
          'Repérez la visite : motif « Examen de vue » ou « Contrôle de suivi », statut « Arrivé » ou « Prêt pour l’examen ».',
          'Cliquez sur « Démarrer l’examen », dans la colonne « Examen » du tableau ou en bas de la carte.',
          'Patientez pendant « Démarrage en cours… » : l’écran « Consultation » s’ouvre sur ce patient.',
          'Si le serveur n’a pas confirmé, le bouton devient « Réessayer de démarrer l’examen » : cliquez dessus, l’examen n’est jamais créé en double.',
          'Plus tard, « Reprendre l’examen » rouvre un examen commencé et « Consulter l’examen » relit un examen terminé.',
        ],
        result:
          'L’écran « Consultation » est ouvert sur le patient ; dans la file, sa visite est « En consultation ».',
      },
      {
        id: 'annuler-une-visite',
        title: 'Annuler une visite avant l’examen',
        anyPermission: ['visit.register'],
        steps: [
          'Repérez la visite à annuler : le bouton « Annuler la visite » n’existe que tant que l’examen n’a pas démarré.',
          'Cliquez sur « Annuler la visite » : une boîte de confirmation s’ouvre et rappelle le nom du patient.',
          'Saisissez le « Motif de l’annulation (obligatoire) » : 3 caractères au moins, une information d’accueil, jamais d’information médicale.',
          'Cliquez sur « Annuler la visite » dans la boîte pour confirmer, ou sur « Garder la visite » pour renoncer.',
        ],
        result:
          'Le message « Visite annulée » s’affiche au-dessus de la liste. La visite reste dans la file, marquée « Annulé » : rien n’est supprimé.',
      },
    ],
    rules: [
      'La file liste les arrivées d’un jour du cabinet, de la plus ancienne à la plus récente. Elle ne se met pas à jour seule : « Actualiser la file » relit le serveur.',
      'Le statut suit le travail réel : « En consultation » dès que l’examen démarre, « Terminé » quand le professionnel termine l’examen. Rien ne se change à la main dans cette file, sauf l’annulation.',
      'Tant que l’encadré du haut dit « Le contrôle du paiement de l’examen n’est pas encore actif », « Paiement de l’examen non contrôlé » signifie que rien n’est vérifié et l’examen peut démarrer.',
      'Si l’encadré dit « Les frais d’examen sont contrôlés », une visite d’examen arrive « En attente du paiement de l’examen », puis « Prêt pour l’examen » après encaissement des frais ou dispense.',
      'L’examen ne démarre alors qu’avec les frais encaissés ou une dispense de la gérante. Une dispense autorise seulement le démarrage de l’examen de cette visite, une seule fois ; elle ne vaut pas encaissement.',
      'On n’annule qu’avant l’examen. Une visite dont l’examen a démarré, ou qui porte une facture (brouillon compris), ne s’annule pas. Si le patient revient, enregistrez une nouvelle arrivée.',
    ],
    next: [
      {
        route: 'arrivee',
        label: 'Enregistrer une arrivée',
        why: 'Quand un patient se présente au cabinet.',
      },
      {
        route: 'facture-nouvelle',
        label: 'Nouvelle facture',
        why: 'Le bouton « Créer une facture » de la file y mène avec le patient et la visite déjà choisis.',
      },
      {
        route: 'approbations',
        label: 'Approbations',
        why: 'Pour suivre une demande de dispense, ou la décider (gérante).',
      },
      {
        topic: 'parcours-examen',
        label: 'Mener un examen, de la file du jour à la fin de la consultation',
      },
    ],
    tips: [
      '« Visites enregistrées » compte toute la file, annulées comprises (« Dont 1 annulée »). « En attente », « En consultation » et « Terminées » ne comptent que la page affichée, ce que rappelle « Sur cette page » quand la file compte plusieurs pages.',
      '« En attente » regroupe les visites « Arrivé », « En attente du paiement de l’examen » et « Prêt pour l’examen ».',
      'Les boutons dépendent du profil : l’accueil ne voit aucune action d’examen, la caissière ne peut ni enregistrer une arrivée ni annuler une visite.',
      'Un « Achat direct » ou un « Retrait de commande » n’impose aucun examen : le marqueur indique « Pas d’examen ». « Créer une facture » ouvre une nouvelle facture pour le patient et la visite.',
      'Sous la liste, « Données du serveur au » suivi d’une date et d’une heure dit quand la file a été lue. Sur un petit écran, chaque visite est une carte ; le tableau complet s’affiche sur un grand écran.',
    ],
    problems: [
      {
        symptom: '« File du jour indisponible »',
        remedy:
          'Le serveur n’a pas répondu. Cela ne prouve pas qu’aucun patient ne soit arrivé : cliquez sur « Réessayer » avant de conclure que la file est vide.',
      },
      {
        symptom: '« Session expirée »',
        remedy:
          'Cliquez sur « Se reconnecter » dans l’en-tête, saisissez votre « Mot de passe », puis cliquez sur « Réessayer ».',
      },
      {
        symptom: 'Le bouton « Démarrer l’examen » n’apparaît pas',
        remedy:
          'Vérifiez trois choses : votre compte peut saisir les examens ; le motif est « Examen de vue » ou « Contrôle de suivi » ; le statut est « Arrivé » ou « Prêt pour l’examen ». Avec « En attente du paiement de l’examen », il faut d’abord encaisser les frais ou obtenir une dispense.',
      },
      {
        symptom: '« La visite a changé depuis l’affichage de la file »',
        remedy:
          'Quelqu’un d’autre a modifié la visite, par exemple en démarrant son examen. La file a été relue : lisez le nouveau statut avant de recommencer. Un message « ne s’annule pas » en donne la raison, par exemple une facture rattachée.',
      },
      {
        symptom: '« Aucune visite ce jour » alors qu’un patient vient d’arriver',
        remedy:
          'Cliquez sur « Actualiser la file » : une arrivée enregistrée sur un autre poste n’apparaît qu’après relecture. Vérifiez aussi le jour affiché dans le titre « File du jour ».',
      },
    ],
    terms: ['File du jour', 'Visite', 'Examen', 'Approbation'],
  },
  {
    route: 'arrivee',
    title: 'Enregistrer une arrivée',
    module: 'today',
    anyPermission: ['visit.register'],
    purpose:
      'Inscrivez dans la file du jour un patient qui se présente au cabinet, pour un examen, un achat ou un retrait. L’heure d’arrivée est celle de l’enregistrement ; la note d’accueil ne contient aucune information médicale.',
    actions: [
      {
        label: 'Patient',
        effect:
          'Cherche dans les fiches du cabinet dès 2 caractères. Choisissez vous-même le patient dans la liste : taper son nom ne suffit pas.',
      },
      {
        label: 'Créer une fiche patient',
        effect: 'Ouvre le formulaire « Nouveau patient » quand le patient n’est pas dans la liste.',
        anyPermission: ['patient.create'],
      },
      {
        label: 'Motif de la visite',
        effect:
          'Obligatoire. Choisissez la raison de la venue ; une phrase d’aide dessous dit si un examen est attendu.',
      },
      {
        label: 'Note administrative (facultative)',
        effect:
          'Information d’accueil seulement, 4000 caractères au plus. Elle s’affiche dans la file du jour : aucune information médicale.',
      },
      {
        label: 'Enregistrer l’arrivée',
        effect:
          'Enregistre l’arrivée sur le serveur, puis ouvre la file du jour avec le message « Arrivée enregistrée ».',
      },
      {
        label: 'Annuler',
        effect: 'Revient à la file du jour sans rien enregistrer.',
      },
      {
        label: 'Réessayer l’enregistrement',
        effect:
          'Renvoie la même saisie quand le serveur n’a pas confirmé, sans créer de seconde arrivée.',
      },
      {
        label: 'Ouvrir la file du jour',
        effect:
          'Proposé avec « Cette arrivée est peut-être déjà enregistrée » : ouvre la file pour vérifier avant de recommencer.',
      },
    ],
    tasks: [
      {
        id: 'enregistrer-une-arrivee',
        title: 'Enregistrer l’arrivée d’un patient',
        steps: [
          'Dans « Patient », saisissez au moins 2 caractères : un nom, un prénom, un téléphone ou un numéro de dossier comme EE-2026-0001.',
          'Choisissez le patient dans la liste qui s’ouvre (flèches haut et bas puis Entrée, ou un clic) : son identité s’affiche dessous.',
          'Vérifiez le nom, le numéro de dossier et l’âge : en cas d’homonyme, comparez le numéro de dossier.',
          'Choisissez le « Motif de la visite » : « Examen de vue », « Achat direct », « Retrait de commande » ou « Contrôle de suivi ».',
          'Au besoin, saisissez une « Note administrative (facultative) » : une information d’accueil, jamais d’information médicale.',
          'Cliquez sur « Enregistrer l’arrivée ».',
        ],
        result:
          'La file du jour s’ouvre avec « Arrivée enregistrée » et le nom du patient. Sa visite y figure, avec l’heure et le statut décidé par le serveur.',
      },
      {
        id: 'arrivee-depuis-un-rendez-vous',
        title: 'Enregistrer l’arrivée d’un patient qui a un rendez-vous',
        anyPermission: ['agenda.read'],
        steps: [
          'Ouvrez « Agenda » et repérez le rendez-vous du patient : le jour même, sa carte porte le bouton « Enregistrer l’arrivée ».',
          'Cliquez sur « Enregistrer l’arrivée » : cet écran s’ouvre avec le patient déjà choisi et le message « Arrivée liée au rendez-vous de l’agenda ».',
          'Choisissez le « Motif de la visite », puis cliquez sur « Enregistrer l’arrivée ».',
        ],
        result:
          'La visite entre dans la file du jour et le rendez-vous passe « Arrivé » dans l’agenda.',
      },
      {
        id: 'arrivee-patient-sans-fiche',
        title: 'Enregistrer l’arrivée d’un patient sans fiche',
        anyPermission: ['patient.create'],
        steps: [
          'Cherchez d’abord le patient dans « Patient », par le nom puis par le téléphone : sa fiche existe peut-être déjà.',
          'Si rien ne correspond, cliquez sur « Créer une fiche patient », sous le champ.',
          'Remplissez le formulaire « Nouveau patient », puis cliquez sur « Enregistrer le patient » (voir l’aide de cet écran).',
          'Sur le dossier qui s’ouvre, cliquez sur « Enregistrer une arrivée » : le patient est déjà choisi sur cet écran.',
          'Choisissez le « Motif de la visite », puis cliquez sur « Enregistrer l’arrivée ».',
        ],
        result: 'La fiche est créée et l’arrivée figure dans la file du jour.',
      },
    ],
    rules: [
      'L’arrivée n’est enregistrée qu’à la réponse du serveur. Sans réponse, la saisie reste à l’écran et « Réessayer l’enregistrement » la renvoie sans créer de seconde arrivée.',
      'Le serveur décide du statut : « Arrivé » en général, « En attente du paiement de l’examen » si le cabinet contrôle les frais d’un examen de vue ou d’un contrôle de suivi.',
      'Seuls « Examen de vue » et « Contrôle de suivi » appellent un examen. Un « Achat direct » ou un « Retrait de commande » ne crée ni examen ni consultation.',
      'Un patient peut avoir plusieurs arrivées le même jour, par exemple un achat après l’examen : l’écran signale l’arrivée déjà enregistrée, sans jamais bloquer.',
      'La note est une information d’accueil de 4000 caractères au plus. Elle s’affiche dans la file du jour : n’y écrivez aucune information médicale.',
      'Depuis un rendez-vous de l’agenda, l’arrivée lui est rattachée. Si vous choisissez un autre patient, ce lien disparaît et le rendez-vous reste inchangé.',
    ],
    next: [
      {
        route: 'aujourdhui',
        label: 'Aujourd’hui',
        why: 'Pour retrouver l’arrivée dans la file du jour.',
      },
      {
        route: 'patient-nouveau',
        label: 'Nouveau patient',
        why: 'Quand le patient n’a pas encore de fiche.',
      },
      {
        route: 'agenda',
        label: 'Agenda',
        why: 'Pour enregistrer l’arrivée depuis la carte d’un rendez-vous du jour.',
      },
      {
        topic: 'parcours-accueillir',
        label: 'Accueillir un patient, de la recherche à la file du jour',
      },
    ],
    tips: [
      'Cherchez toujours le patient avant de créer une fiche : un patient déjà venu se retrouve par son nom, son téléphone ou son numéro de dossier.',
      'Le dossier d’un patient, la page d’accueil de l’application et l’en-tête de « Aujourd’hui » proposent aussi « Enregistrer une arrivée ».',
      'L’heure d’arrivée vient de l’horloge de l’appareil : gardez-la à l’heure. Si elle est fausse, le serveur peut refuser l’arrivée et l’écran demande « Vérifiez la date et l’heure de cet appareil. »',
      'Si vous quittez l’écran avec une saisie en cours, le navigateur demande « Des saisies ne sont pas encore enregistrées. Quitter cet écran sans les enregistrer ? »',
      'La caissière n’a pas cet écran : elle lit la file dans « Aujourd’hui » sans pouvoir enregistrer d’arrivée.',
    ],
    problems: [
      {
        symptom: '« Certaines informations sont à corriger »',
        remedy:
          'Lisez la liste : par exemple « Choisissez le patient dans la liste des résultats. » ou « Choisissez le motif de la visite. » Cliquez sur un message pour aller au champ ; le reste de la saisie est conservé.',
      },
      {
        symptom: '« Recherche serveur indisponible »',
        remedy:
          'Le serveur n’a pas répondu : cela ne prouve pas que le patient n’existe pas. Réessayez la recherche avant de cliquer sur « Créer une fiche patient ».',
      },
      {
        symptom: '« Cette fiche est archivée : une arrivée ne peut pas lui être enregistrée. »',
        remedy:
          'Cette fiche n’accepte plus d’arrivée : cherchez une autre fiche active du même patient, ou prévenez la gérante. Le message « Cette fiche a été fusionnée dans une autre » demande de chercher la fiche conservée.',
      },
      {
        symptom: '« Enregistrement non confirmé »',
        remedy:
          'L’arrivée a pu être enregistrée. Cliquez sur « Réessayer l’enregistrement » : la même saisie est renvoyée sans doublon, avec l’heure de la première tentative.',
      },
      {
        symptom: '« Cette arrivée est peut-être déjà enregistrée »',
        remedy:
          'Cliquez sur « Ouvrir la file du jour » et vérifiez que le patient y figure avant de recommencer, pour ne pas créer une seconde arrivée.',
      },
    ],
    terms: ['Visite', 'File du jour', 'Numéro de dossier', 'Examen'],
  },
]
