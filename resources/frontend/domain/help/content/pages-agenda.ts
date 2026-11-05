import type { PageHelp } from '../model'

/**
 * Aide des écrans du module agenda : l’agenda, la prise de rendez-vous, la configuration de
 * l’agenda (gérante) et la liste des patients à rappeler. Libellés recopiés des écrans.
 */
export const PAGES_AGENDA: readonly PageHelp[] = [
  {
    route: 'agenda',
    title: 'Agenda',
    module: 'agenda',
    anyPermission: ['agenda.read'],
    purpose:
      'Voyez les rendez-vous du cabinet, un jour ou une semaine à la fois, avec leur statut. C’est ici que vous enregistrez l’arrivée d’un patient attendu, déplacez ou annulez un rendez-vous, et notez une absence.',
    actions: [
      {
        label: 'Nouveau rendez-vous',
        effect:
          'Ouvre la prise de rendez-vous : patient, prestation, ressource, jour puis créneau libre.',
        anyPermission: ['agenda.write'],
      },
      {
        label: 'Jour',
        effect:
          'Affiche un seul jour. « Semaine » affiche à la place les sept jours, du lundi au dimanche, qui contiennent le jour choisi.',
      },
      {
        label: 'Jour suivant',
        effect:
          'Avance d’un jour ; « Jour précédent » recule. En vue « Semaine », ils avancent ou reculent de sept jours.',
      },
      {
        label: 'Afficher',
        effect:
          'Relit l’agenda pour le « Jour » saisi et la « Ressource » choisie (« Toutes les ressources » au départ).',
      },
      {
        label: 'Enregistrer l’arrivée',
        effect:
          'Ouvre l’écran d’arrivée avec le patient déjà choisi ; une fois l’arrivée enregistrée, le rendez-vous passe « Arrivé ».',
        anyPermission: ['visit.register'],
      },
      {
        label: 'Déplacer',
        effect:
          'Propose les créneaux libres d’un autre jour, pour la même prestation et la même ressource.',
        anyPermission: ['agenda.write'],
      },
      {
        label: 'Absent',
        effect:
          'Note que le patient ne s’est pas présenté. Possible seulement une fois l’heure du rendez-vous passée.',
        anyPermission: ['agenda.write'],
      },
      {
        label: 'Annuler',
        effect: 'Demande un motif, puis annule le rendez-vous et libère son créneau.',
        anyPermission: ['agenda.write'],
      },
      {
        label: 'Patients à rappeler',
        effect: 'Ouvre la liste de travail des rappels du jour et des contrôles à revoir.',
      },
      {
        label: 'Configuration',
        effect: 'Ouvre le réglage des professionnels, des salles, des horaires et des prestations.',
        anyPermission: ['users.manage'],
      },
    ],
    tasks: [
      {
        id: 'consulter-un-jour-ou-une-semaine',
        title: 'Consulter l’agenda d’un jour ou d’une semaine',
        steps: [
          'Cliquez sur le bouton « Jour » pour voir une seule journée, ou sur « Semaine » pour voir sept jours, du lundi au dimanche.',
          'Avancez avec « Jour suivant », reculez avec « Jour précédent » ; en vue « Semaine », ils s’appellent « Semaine suivante » et « Semaine précédente ».',
          'Cliquez sur « Aujourd’hui » pour revenir au jour en cours.',
          'Pour une date précise, saisissez-la dans le champ « Jour » (JJ/MM/AAAA ou 8 chiffres, par exemple 26102026), puis cliquez sur « Afficher ».',
          'Pour ne voir qu’un professionnel ou une salle, choisissez-le dans « Ressource », puis cliquez sur « Afficher ».',
          'Lisez chaque carte : l’heure, le patient et son numéro de dossier, la prestation, la ressource et le statut écrit en toutes lettres.',
        ],
        result:
          'Les rendez-vous de chaque jour sont classés du plus tôt au plus tard. Un jour vide affiche « Aucun rendez-vous ce jour-là. »',
      },
      {
        id: 'enregistrer-une-arrivee',
        title: 'Enregistrer l’arrivée d’un patient attendu',
        anyPermission: ['visit.register'],
        steps: [
          'Le jour du rendez-vous, repérez la carte du patient dans l’agenda du jour.',
          'Cliquez sur « Enregistrer l’arrivée » : l’écran d’arrivée s’ouvre avec le patient déjà choisi et le message « Arrivée liée au rendez-vous de l’agenda ».',
          'Choisissez le « Motif de la visite ».',
          'Cliquez sur « Enregistrer l’arrivée ».',
        ],
        result:
          'Vous arrivez sur la file du jour. Dans l’agenda, le rendez-vous est maintenant « Arrivé ».',
      },
      {
        id: 'changer-un-rendez-vous',
        title: 'Déplacer, annuler ou noter l’absence d’un rendez-vous',
        anyPermission: ['agenda.write'],
        steps: [
          'Repérez la carte du rendez-vous : « Déplacer », « Annuler » et « Absent » ne sont proposés que pour un rendez-vous « Confirmé ».',
          'Pour déplacer : cliquez sur « Déplacer », choisissez le « Nouveau jour », cochez une heure dans « Créneau libre », puis cliquez sur « Déplacer le rendez-vous ».',
          'Pour renoncer au déplacement, cliquez sur « Garder l’heure ».',
          'Pour annuler : cliquez sur « Annuler », saisissez le « Motif de l’annulation (obligatoire) » (3 caractères au moins), puis cliquez sur « Annuler le rendez-vous ».',
          'Pour changer d’avis, cliquez sur « Garder le rendez-vous » : rien n’est annulé.',
          'Pour une absence, une fois l’heure passée, cliquez sur « Absent » : l’absence est enregistrée tout de suite, sans demande de confirmation.',
          'Attendez le message de confirmation affiché au-dessus de la liste : le changement n’est acquis qu’à la réponse du serveur.',
        ],
        result: 'La carte affiche son nouveau statut ou sa nouvelle heure, et l’agenda a été relu.',
      },
    ],
    rules: [
      'Un rendez-vous n’est « Confirmé » qu’à la réponse du serveur : toute action de l’agenda demande une connexion, et un échec n’est jamais présenté comme une réussite.',
      'Si le serveur ne répond pas, l’écran affiche « Serveur indisponible » et non une liste vide : une journée sans rendez-vous est annoncée par « Aucun rendez-vous ce jour-là. »',
      'Le statut s’écrit en toutes lettres : « Confirmé », « Arrivé », « Terminé », « Annulé » ou « Absent ». Un rendez-vous annulé ou absent libère son créneau.',
      'Tant qu’un rendez-vous est « Confirmé », vous pouvez le déplacer, l’annuler ou, une fois l’heure passée, le noter « Absent ». Ensuite, ces boutons disparaissent.',
      '« Déplacer » garde la même prestation et la même ressource. Pour confier le rendez-vous à un autre professionnel ou une autre salle, annulez-le puis reprenez-en un.',
      'Si une autre personne modifie le rendez-vous avant vous, l’écran le dit, relit l’agenda et ne change rien : refaites votre action si elle est encore utile.',
    ],
    next: [
      {
        route: 'rendez-vous-nouveau',
        label: 'Nouveau rendez-vous',
        why: 'Pour donner un rendez-vous à un patient.',
      },
      {
        route: 'aujourdhui',
        label: 'Aujourd’hui',
        why: 'Pour suivre la file du jour une fois les arrivées enregistrées.',
      },
      {
        route: 'suivis',
        label: 'Patients à rappeler',
        why: 'Pour les rappels du jour et les patients à revoir.',
      },
      {
        topic: 'parcours-rendez-vous',
        label: 'Prendre, déplacer et annuler un rendez-vous',
      },
    ],
    tips: [
      'Le bouton « Enregistrer l’arrivée » n’apparaît que le jour même, pour un rendez-vous « Confirmé » dont l’arrivée n’est pas encore enregistrée.',
      'La caissière consulte l’agenda sans pouvoir le modifier : elle ne voit ni « Nouveau rendez-vous », ni « Déplacer », ni « Annuler », ni « Absent ».',
      'Le chiffre affiché à côté de chaque jour compte aussi les rendez-vous annulés ; la tuile « Rendez-vous » de l’accueil, elle, ne les compte pas.',
      'Sur téléphone ou tablette, les boutons qui reculent et avancent n’affichent qu’une flèche : celle de gauche recule, celle de droite avance.',
      'Depuis l’accueil, le raccourci « Rendez-vous » ouvre « Nouveau rendez-vous » ; la tuile « Rendez-vous » mène à cet écran.',
    ],
    problems: [
      {
        symptom: '« Serveur indisponible »',
        remedy:
          'Le serveur n’a pas répondu : rien n’est conclu sur les rendez-vous. Vérifiez la connexion, puis cliquez sur « Réessayer ».',
      },
      {
        symptom: '« Aucun rendez-vous ce jour-là. »',
        remedy:
          'Ce n’est pas une erreur. Choisissez un autre jour ou une autre ressource : le filtre « Ressource » cache les rendez-vous des autres ressources.',
      },
      {
        symptom: 'Un message se termine par « a changé entre-temps : l’agenda a été relu. »',
        remedy:
          'Une autre personne a modifié ce rendez-vous juste avant vous. Regardez la carte relue, puis refaites votre action si elle est encore utile.',
      },
      {
        symptom: '« Indiquez le motif de l’annulation »',
        remedy:
          'Saisissez un motif d’au moins 3 caractères (1000 au plus), puis cliquez de nouveau sur « Annuler le rendez-vous ».',
      },
      {
        symptom: '« Créneaux indisponibles : la lecture du serveur a échoué. Réessayez. »',
        remedy:
          'Cliquez sur « Garder l’heure », puis de nouveau sur « Déplacer » pour relancer la lecture. Si le message revient, vérifiez la connexion.',
      },
    ],
    terms: ['Visite', 'File du jour', 'Numéro de dossier'],
  },
  {
    route: 'rendez-vous-nouveau',
    title: 'Nouveau rendez-vous',
    module: 'agenda',
    anyPermission: ['agenda.write'],
    purpose:
      'Donnez un rendez-vous à un patient en quatre étapes : le patient, la prestation et la ressource, le jour et un créneau libre, puis la confirmation. Le rendez-vous n’est confirmé que lorsque le serveur a répondu.',
    actions: [
      {
        label: 'Rechercher',
        effect:
          'Cherche un patient par son nom, son téléphone ou son numéro de dossier, à partir de 2 caractères.',
      },
      {
        label: 'Changer de patient',
        effect: 'Retire le patient choisi pour en chercher un autre.',
      },
      {
        label: 'Réessayer',
        effect: 'Relit les créneaux libres après un échec de lecture du serveur.',
      },
      {
        label: 'Confirmer le rendez-vous',
        effect:
          'Envoie la demande au serveur, qui réserve le créneau et confirme le rendez-vous s’il est encore libre.',
      },
      {
        label: 'Annuler',
        effect:
          'Revient à l’agenda sans rien enregistrer, comme « Retour à l’agenda » en haut de l’écran.',
      },
      {
        label: 'Voir l’agenda',
        effect: 'Après la confirmation, ouvre l’agenda.',
      },
      {
        label: 'Autre rendez-vous',
        effect:
          'Après la confirmation, garde le patient, la prestation, la ressource et le jour pour choisir un autre créneau.',
      },
    ],
    tasks: [
      {
        id: 'prendre-un-rendez-vous',
        title: 'Prendre un rendez-vous',
        steps: [
          'Étape « Patient » : saisissez au moins 2 caractères dans « Rechercher un patient » (nom, téléphone ou numéro de dossier), puis cliquez sur « Rechercher ».',
          'Cliquez sur le patient voulu dans la liste : son nom et son numéro de dossier s’affichent. « Changer de patient » permet de corriger.',
          'Étape « Prestation et ressource » : choisissez la « Prestation », puis le « Professionnel ou salle ».',
          'Étape « Jour et créneau » : vérifiez le « Jour » (aujourd’hui au départ). Les créneaux libres apparaissent dès que la prestation et la ressource sont choisies.',
          'Cochez l’heure voulue parmi les créneaux libres proposés ; la durée de la prestation figure dans leur titre.',
          'Étape « Note et confirmation » : ajoutez si besoin une « Note administrative (facultative) ». Aucune information médicale.',
          'Cliquez sur « Confirmer le rendez-vous » et attendez la réponse : le bouton affiche « Confirmation en cours… » pendant l’envoi.',
        ],
        result:
          'L’écran affiche « Rendez-vous confirmé par le serveur » avec le nom du patient et l’heure choisie. Le rendez-vous est dans l’agenda.',
      },
      {
        id: 'creneau-pris-entre-temps',
        title: 'Choisir un autre créneau quand le premier vient d’être pris',
        steps: [
          'Si un message d’erreur dit que le créneau a été pris entre-temps, ne ressaisissez rien : vos autres choix sont conservés.',
          'Les créneaux libres sont relus automatiquement : celui qui vient d’être pris a disparu de la liste.',
          'Cochez un autre créneau parmi ceux qui restent. Si aucun ne convient, changez le « Jour ».',
          'Cliquez de nouveau sur « Confirmer le rendez-vous ».',
        ],
        result:
          'Le rendez-vous est confirmé sur le nouveau créneau ; le rendez-vous déjà pris sur l’autre n’est pas touché.',
      },
      {
        id: 'programmer-un-controle',
        title: 'Donner le rendez-vous d’un contrôle recommandé',
        steps: [
          'Dans « Patients à rappeler », cliquez sur « Programmer un rendez-vous » sur la carte du patient.',
          'Le patient est déjà choisi et l’écran précise « Ce rendez-vous programme un contrôle recommandé ».',
          'Choisissez la prestation, la ressource, le jour et le créneau libre, puis cliquez sur « Confirmer le rendez-vous ».',
        ],
        result:
          'Le contrôle recommandé passe à « Rendez-vous programmé » : sa carte ne propose plus « Programmer un rendez-vous ».',
      },
    ],
    rules: [
      'Le serveur décide : le rendez-vous n’est « Confirmé » qu’à sa réponse. Tant que le bouton affiche « Confirmation en cours… », ne quittez pas l’écran.',
      'Les créneaux libres sont lus sur le serveur à l’instant de votre choix. Quelqu’un d’autre peut prendre le même créneau avant vous : la réservation est revérifiée au clic et un seul rendez-vous est retenu.',
      'Un double clic ou une coupure ne crée jamais deux rendez-vous : la même demande est reconnue par le serveur.',
      'Seules les prestations et les ressources actives sont proposées. Les créneaux dépendent des horaires de la ressource, de ses fermetures exceptionnelles et des rendez-vous déjà pris.',
      'Un rendez-vous se prend pour un patient qui a déjà une fiche : créez-la d’abord si besoin.',
      'La note administrative reste visible sur la carte du rendez-vous dans l’agenda : n’y écrivez aucune information médicale.',
    ],
    next: [
      {
        route: 'agenda',
        label: 'Agenda',
        why: 'Pour retrouver le rendez-vous au jour choisi.',
      },
      {
        route: 'patient-nouveau',
        label: 'Nouveau patient',
        why: 'Si le patient n’a pas encore de fiche.',
      },
      {
        route: 'suivis',
        label: 'Patients à rappeler',
        why: 'Pour donner un rendez-vous aux patients à revoir.',
      },
      {
        topic: 'parcours-rendez-vous',
        label: 'Prendre, déplacer et annuler un rendez-vous',
      },
    ],
    tips: [
      'Depuis l’accueil, le raccourci « Rendez-vous » ouvre directement cet écran.',
      'Depuis « Patients à rappeler » ou depuis le panneau « Contrôle recommandé » d’un examen, le patient est déjà choisi.',
      'Quand une étape est remplie, son numéro se change en coche.',
      'Le champ « Jour » accepte JJ/MM/AAAA ou 8 chiffres, par exemple 26102026.',
      'Le jour du rendez-vous, enregistrez l’arrivée depuis l’agenda : le rendez-vous passe « Arrivé ».',
    ],
    problems: [
      {
        symptom: 'Un message d’erreur refuse la réservation : le créneau a été pris entre-temps.',
        remedy:
          'Choisissez un autre créneau parmi ceux que l’écran vient de relire, puis cliquez de nouveau sur « Confirmer le rendez-vous ».',
      },
      {
        symptom: '« Agenda non configuré »',
        remedy:
          'Aucune prestation ou ressource n’est active. La gérante les crée dans « Agenda », puis « Configuration » : aucun horaire n’est inventé.',
      },
      {
        symptom: '« Aucun créneau libre ce jour-là pour cette ressource. »',
        remedy:
          'Changez de jour ou de ressource. Si cela se répète chaque jour, les horaires de la ressource manquent peut-être : prévenez la gérante.',
      },
      {
        symptom: '« L’enregistrement n’est pas confirmé »',
        remedy:
          'La demande a pu être appliquée. Ne quittez pas l’écran et cliquez de nouveau sur « Confirmer le rendez-vous » : la demande est renvoyée sans doublon. Si vous avez quitté l’écran, cherchez d’abord le rendez-vous dans l’agenda.',
      },
      {
        symptom: '« Aucun patient ne correspond à cette recherche. »',
        remedy:
          'Essayez le téléphone ou le numéro de dossier. Si le patient n’existe pas, créez sa fiche avec « Nouveau patient » avant de revenir.',
      },
    ],
    terms: ['Numéro de dossier', 'Contrôle recommandé'],
  },
  {
    route: 'agenda-configuration',
    title: 'Configuration de l’agenda',
    module: 'agenda',
    anyPermission: ['users.manage'],
    purpose:
      'Réglez ici ce que l’accueil peut réserver : professionnels et salles, horaires de la semaine, fermetures exceptionnelles et prestations avec leur durée. À faire avant d’ouvrir l’agenda au personnel, puis à chaque changement d’horaires.',
    actions: [
      {
        label: 'Nouvelle ressource',
        effect: 'Ouvre le formulaire de création d’un professionnel ou d’une salle.',
      },
      {
        label: 'Modifier',
        effect:
          'Rouvre le formulaire d’une ressource ou d’une prestation pour corriger son nom, son pas ou sa durée, ou la désactiver.',
      },
      {
        label: 'Horaires',
        effect: 'Ouvre les créneaux de la semaine de la ressource, jour par jour.',
      },
      {
        label: 'Fermeture exceptionnelle',
        effect:
          'Ouvre le formulaire d’une période fermée (congés, absence, jour férié) pour cette ressource.',
      },
      {
        label: 'Nouvelle prestation',
        effect: 'Ouvre le formulaire d’une prestation réservable, avec sa durée en minutes.',
      },
      {
        label: 'Ajouter un créneau',
        effect:
          'Ajoute une ligne avec les champs « Jour », « Ouverture » et « Fermeture » à remplir.',
      },
      {
        label: 'Enregistrer les horaires',
        effect: 'Enregistre la liste complète des créneaux : elle remplace entièrement l’ancienne.',
      },
      {
        label: 'Enregistrer la fermeture',
        effect: 'Enregistre la période fermée, sauf si des rendez-vous existent déjà ces jours-là.',
      },
      {
        label: 'Enregistrer la ressource',
        effect: 'Crée ou met à jour la ressource : nom, professionnel, pas de l’agenda et état.',
      },
      {
        label: 'Enregistrer la prestation',
        effect: 'Crée ou met à jour la prestation : nom, durée et état.',
      },
    ],
    tasks: [
      {
        id: 'ressource-et-horaires',
        title: 'Créer un professionnel ou une salle et ses horaires',
        steps: [
          'Cliquez sur « Nouvelle ressource » et saisissez le « Nom » (par exemple Salle d’examen 1, ou le nom du professionnel).',
          'Pour un professionnel, choisissez-le dans « Professionnel rattaché » (comptes actifs du personnel). Pour une salle, laissez « Aucun (salle ou matériel) ».',
          'Réglez le « Pas de l’agenda (minutes) » : l’écart entre deux débuts de créneau, de 5 à 480 minutes (15 au départ).',
          'Laissez cochée « Ressource active (proposée à la prise de rendez-vous) », puis cliquez sur « Enregistrer la ressource ».',
          'Sur la ressource créée, cliquez sur « Horaires », puis sur « Ajouter un créneau » : une ligne apparaît.',
          'Choisissez le « Jour », puis saisissez l’« Ouverture » et la « Fermeture » au format HH:MM, par exemple 08:00 et 12:00.',
          'Ajoutez une ligne par plage : une journée coupée en deux (matin et après-midi) demande deux lignes qui ne se chevauchent pas. « Retirer » supprime une ligne.',
          'Vérifiez tous les jours, puis cliquez sur « Enregistrer les horaires » : la liste enregistrée remplace l’ancienne.',
        ],
        result:
          'Les créneaux de la semaine s’affichent sous le nom de la ressource, qui est alors proposée à la prise de rendez-vous. Sans créneau, « Aucun créneau hebdomadaire. » s’affiche.',
      },
      {
        id: 'fermeture-exceptionnelle',
        title: 'Déclarer une fermeture exceptionnelle',
        steps: [
          'Sur la ressource concernée, cliquez sur « Fermeture exceptionnelle ».',
          'Saisissez le « Premier jour fermé » et le « Dernier jour fermé » (JJ/MM/AAAA). Pour un seul jour, saisissez deux fois la même date.',
          'Renseignez le « Motif (obligatoire) », par exemple congés ou jour férié.',
          'Vérifiez les dates, puis cliquez sur « Enregistrer la fermeture » : elle ne pourra plus être retirée depuis cet écran.',
          'Si l’écran refuse parce que des rendez-vous existent ces jours-là, déplacez-les ou annulez-les dans l’agenda, puis recommencez.',
        ],
        result:
          'Aucun créneau n’est plus proposé ces jours-là pour cette ressource. Si la fermeture tombe dans les 90 prochains jours, elle apparaît dans « Fermetures et ouvertures à venir », avec la mention « Fermeture ».',
      },
      {
        id: 'creer-une-prestation',
        title: 'Créer une prestation réservable',
        steps: [
          'Cliquez sur « Nouvelle prestation ».',
          'Saisissez le « Nom de la prestation » et la « Durée (minutes) » : un nombre entier de 5 à 480.',
          'Laissez cochée « Prestation proposée à la prise de rendez-vous » pour l’offrir à l’accueil.',
          'Cliquez sur « Enregistrer la prestation ».',
        ],
        result:
          'La prestation apparaît dans la liste avec sa durée, puis dans le choix « Prestation » de « Nouveau rendez-vous ».',
      },
    ],
    rules: [
      'Les horaires et les durées sont ceux du cabinet : rien n’est proposé par défaut. Une ressource sans créneau n’est proposée à aucun rendez-vous.',
      'Les horaires enregistrés remplacent entièrement les anciens : une liste vide ferme la ressource. Vérifiez tous les jours avant d’enregistrer.',
      'Deux créneaux d’un même jour ne se chevauchent pas, et la fermeture suit l’ouverture. Les heures s’écrivent HH:MM.',
      'Une ressource ou une prestation désactivée reste dans la liste, marquée « (désactivée) », mais n’est plus proposée à l’accueil. Cet écran ne supprime ni l’une ni l’autre.',
      'Une fermeture couvre des journées entières, du premier au dernier jour inclus. Elle est refusée si des rendez-vous existent déjà ces jours-là, et cet écran ne permet pas de la retirer ensuite.',
      'Seule la gérante règle l’agenda. Les autres comptes lisent l’agenda et, selon leur profil, prennent des rendez-vous, mais ne voient pas le bouton « Configuration ».',
    ],
    next: [
      {
        route: 'agenda',
        label: 'Agenda',
        why: 'Pour vérifier les horaires et les rendez-vous obtenus.',
      },
      {
        route: 'rendez-vous-nouveau',
        label: 'Nouveau rendez-vous',
        why: 'Pour vérifier que les créneaux attendus sont proposés.',
      },
      {
        route: 'parametres-personnel',
        label: 'Personnel',
        why: 'Pour créer le compte d’un professionnel avant de le rattacher.',
      },
      {
        topic: 'premiere-configuration',
        label: 'Configurer le cabinet avant l’ouverture',
      },
    ],
    tips: [
      'Ordre conseillé : les ressources, leurs horaires, puis les prestations. Vérifiez ensuite que les créneaux attendus s’affichent dans « Nouveau rendez-vous ».',
      'L’application ne connaît pas les jours fériés : saisissez-les comme « Fermeture exceptionnelle » sur chaque ressource avant d’ouvrir l’agenda au personnel.',
      'Le pas est l’écart entre deux débuts de créneau (par exemple toutes les 15 minutes) ; la durée d’un rendez-vous vient de la prestation choisie.',
      'Un professionnel rattaché doit avoir un compte actif dans « Personnel » (Paramètres) : créez le compte d’abord, ou vérifiez qu’il est actif.',
      'Une prestation n’a pas de prix ici : les prix se règlent dans le catalogue des ventes.',
    ],
    problems: [
      {
        symptom:
          '« Heures au format HH:MM. », « L’heure de fermeture doit suivre l’heure d’ouverture. » ou « Ce créneau chevauche un autre créneau du même jour. »',
        remedy:
          'Corrigez la ligne signalée : deux chiffres, deux-points, deux chiffres (08:00), fermeture après ouverture, aucun recouvrement avec un autre créneau du même jour. Rien n’est enregistré tant qu’une ligne est en erreur.',
      },
      {
        symptom: '« La durée est un nombre entier de minutes, de 5 à 480. »',
        remedy:
          'Saisissez un nombre entier de minutes entre 5 et 480. Le champ « Pas de l’agenda (minutes) » suit la même règle.',
      },
      {
        symptom: 'Le serveur refuse la fermeture parce que des rendez-vous existent ces jours-là.',
        remedy:
          'Ouvrez l’agenda sur ces jours, déplacez ou annulez les rendez-vous concernés, puis enregistrez de nouveau la fermeture.',
      },
      {
        symptom: '« Indiquez le premier et le dernier jour de la fermeture. »',
        remedy:
          'Remplissez les deux dates : le dernier jour ne peut pas précéder le premier. Une date s’écrit JJ/MM/AAAA.',
      },
      {
        symptom:
          '« La configuration a changé entre-temps : elle a été relue, recommencez la modification. »',
        remedy:
          'Une autre personne a modifié l’agenda en même temps que vous. L’écran s’est mis à jour : refaites votre modification.',
      },
    ],
  },
  {
    route: 'suivis',
    title: 'Patients à rappeler',
    module: 'agenda',
    anyPermission: ['agenda.read'],
    purpose:
      'Voyez qui rappeler aujourd’hui (ou le jour choisi) et quels patients doivent revenir dans les 30 jours. L’application n’envoie aucun SMS ni WhatsApp : vous appelez ou écrivez vous-même, puis vous notez le résultat.',
    actions: [
      {
        label: 'Afficher',
        effect:
          'Relit les deux listes pour le « Jour » saisi : les rappels de ce jour et les contrôles des 30 jours suivants.',
      },
      {
        label: 'Noter un contact',
        effect:
          'Ouvre le formulaire pour enregistrer le résultat de votre appel ou de votre message.',
        anyPermission: ['agenda.write'],
      },
      {
        label: 'Enregistrer la tentative',
        effect: 'Enregistre le résultat, la suite et la note sur la carte du patient.',
        anyPermission: ['agenda.write'],
      },
      {
        label: 'Programmer un rendez-vous',
        effect:
          'Ouvre « Nouveau rendez-vous » avec le patient déjà choisi (et son contrôle recommandé, s’il y en a un).',
        anyPermission: ['agenda.write'],
      },
      {
        label: 'Annuler',
        effect: 'Ferme le formulaire de contact sans rien enregistrer.',
        anyPermission: ['agenda.write'],
      },
      {
        label: 'Annuler le contrôle',
        effect:
          'Annule un contrôle actif avec un motif obligatoire ; il reste lisible dans la consultation. S’il est programmé par un rendez-vous, annulez d’abord celui-ci.',
        anyPermission: ['follow_up.write'],
      },
      {
        label: 'Retour à l’agenda',
        effect: 'Revient à l’agenda.',
      },
      {
        label: 'Réessayer',
        effect: 'Relit une liste qui n’a pas pu être lue (serveur indisponible, session expirée).',
      },
    ],
    tasks: [
      {
        id: 'lire-les-listes',
        title: 'Lire les rappels du jour et les patients à revoir',
        steps: [
          'Le jour d’aujourd’hui s’affiche d’abord. Pour un autre jour, saisissez-le dans « Jour », puis cliquez sur « Afficher ».',
          'Dans « À contacter le … », chaque carte est un patient à rappeler, avec son « Échéance » et son « Canal souhaité ».',
          'Les pastilles du titre comptent les rappels « à traiter » et « en retard ». Une carte « En retard » est due depuis un jour passé.',
          'Dans « À revoir dans les 30 jours », chaque carte indique la date du « Contrôle recommandé le », dans les 30 jours après le jour affiché.',
          'Le « Canal souhaité » est la préférence du patient pour être joint : l’application n’envoie rien, c’est à vous de le contacter.',
        ],
        result:
          'Vous savez qui contacter, avant quelle échéance, et par quel moyen le patient préfère être joint.',
      },
      {
        id: 'noter-un-contact',
        title: 'Noter le résultat d’un rappel',
        anyPermission: ['agenda.write'],
        steps: [
          'Contactez le patient vous-même, par le moyen indiqué dans « Canal souhaité » : l’application n’envoie rien.',
          'Sur sa carte, cliquez sur « Noter un contact ».',
          'Choisissez le « Résultat » : « Contacté », « RDV pris », « Sans réponse », « Refus », « Reporté » ou « Échec (numéro injoignable…) ».',
          'Le champ « Suite » n’apparaît que lorsque plusieurs suites sont possibles (après « Sans réponse » ou un échec) : choisissez celle qui convient.',
          'Pour « RDV pris », choisissez le rendez-vous dans « Rendez-vous pris » ; s’il n’existe pas encore, programmez-le d’abord.',
          'Si la suite est « Reporté », « Rappeler le (obligatoire) » est exigé ; pour « Sans réponse » ou « À contacter », cette date est facultative.',
          'Saisissez si besoin l’« Heure » du rappel (HH:MM) ; elle vaut 09:00 si vous la laissez vide.',
          'Ajoutez si besoin une « Note administrative (facultative) », sans information médicale, puis cliquez sur « Enregistrer la tentative ».',
        ],
        result:
          'Un message confirme l’enregistrement sur le serveur et la liste est relue. La tentative s’ajoute sous « Tentatives précédentes » sur la carte.',
      },
      {
        id: 'proposer-un-rendez-vous',
        title: 'Proposer un rendez-vous à un patient à revoir',
        anyPermission: ['agenda.write'],
        steps: [
          'Sur la carte du patient, cliquez sur « Programmer un rendez-vous » : dans « À revoir dans les 30 jours », ou sur son rappel à contacter.',
          'L’écran « Nouveau rendez-vous » s’ouvre avec le patient déjà choisi : choisissez la prestation, la ressource, le jour et le créneau libre.',
          'Cliquez sur « Confirmer le rendez-vous ».',
          'Rouvrez « Patients à rappeler » : le contrôle affiche « Rendez-vous programmé » et ne propose plus « Programmer un rendez-vous ».',
        ],
        result:
          'Le patient a son rendez-vous dans l’agenda. Pour un contrôle recommandé, ses rappels ouverts passent à « RDV pris ».',
      },
    ],
    rules: [
      'L’application n’envoie aucun SMS ni WhatsApp. Le « Canal souhaité » n’est que la préférence du patient : c’est vous qui l’appelez ou lui écrivez.',
      'La liste du jour réunit les rappels à traiter dus ce jour-là ou avant (les retards) et ceux traités ce jour-là. Un report à une date plus tardive n’apparaît qu’à son jour.',
      'Un rappel reste ouvert tant qu’il est « À contacter », « Sans réponse » ou « Reporté ». Avec « Contacté », « RDV pris » ou « Refus », il est clos.',
      'Un patient apparaît dans « À contacter le … » à la date de rappel choisie par le professionnel. Sans rappel interne, il n’est que dans « À revoir dans les 30 jours ».',
      'Un contrôle recommandé est une date souhaitée, pas une heure réservée : « À programmer » jusqu’au rendez-vous, puis « Rendez-vous programmé ». Annulé ou manqué, ce rendez-vous le remet « À programmer ».',
      'Un même événement à une même échéance ne produit qu’un rappel. Quand un rendez-vous est déplacé ou annulé, l’ancien rappel devient « Sans objet (programmation remplacée ou annulée) ».',
    ],
    next: [
      {
        route: 'agenda',
        label: 'Agenda',
        why: 'Pour voir les rendez-vous déjà pris.',
      },
      {
        route: 'rendez-vous-nouveau',
        label: 'Nouveau rendez-vous',
        why: 'Pour donner un rendez-vous à un patient de la liste.',
      },
      {
        route: 'consultations',
        label: 'Consultations',
        why: 'Le professionnel y programme les contrôles recommandés.',
      },
      {
        topic: 'parcours-suivi',
        label: 'Suivre un patient : contrôle recommandé et rappels',
      },
    ],
    tips: [
      'Le professionnel programme un contrôle depuis l’examen, dans le panneau « Contrôle recommandé » (bouton « Programmer un contrôle »).',
      'La caissière voit les listes mais ne peut pas noter de contact ni programmer de rendez-vous : ces boutons demandent le droit de programmer les rendez-vous.',
      'Chaque carte garde l’historique de ses tentatives, avec la date, le résultat, l’auteur et la note : relisez-le avant de rappeler.',
      'Pour regarder plus loin que 30 jours, changez le « Jour » : les contrôles affichés sont ceux des 30 jours qui suivent le jour choisi.',
      'Le motif d’un contrôle (par exemple « Contrôle de routine ») n’apparaît que pour les comptes qui lisent le dossier médical. Les autres voient la date, le patient et le canal.',
    ],
    problems: [
      {
        symptom: '« Aucun patient à rappeler ce jour-là. »',
        remedy:
          'Aucun rappel n’est dû ce jour-là : ils apparaissent à leur échéance. Changez le « Jour » pour regarder un autre jour.',
      },
      {
        symptom: '« Aucun contrôle recommandé sur cette période. »',
        remedy:
          'Aucun contrôle ne tombe dans les 30 jours après le « Jour » affiché. Changez le « Jour » : le professionnel programme les contrôles depuis l’examen.',
      },
      {
        symptom: '« Choisissez le rendez-vous pris (ou programmez-le d’abord dans l’agenda). »',
        remedy:
          'Le rendez-vous doit exister avant de noter « RDV pris ». Programmez-le avec « Programmer un rendez-vous », puis revenez noter le contact.',
      },
      {
        symptom: '« Indiquez quand rappeler. »',
        remedy:
          'Un report exige une date : remplissez « Rappeler le (obligatoire) », puis cliquez de nouveau sur « Enregistrer la tentative ».',
      },
      {
        symptom: 'Un message se termine par « a changé entre-temps : la liste a été relue. »',
        remedy:
          'Quelqu’un a traité ce rappel avant vous. Lisez la carte relue : si elle est close, ne la notez pas une seconde fois.',
      },
    ],
    terms: ['Contrôle recommandé'],
  },
]
