import type { HandbookTopic } from '../model'

/**
 * Documentation globale, partie « Guides par profil » : une rubrique par profil du cabinet (accueil,
 * professionnel, caissière, gérante), « Votre journée avec l’application ». Chaque guide dit ce que le
 * profil voit dans le menu et sur l’accueil, sa routine, ses gestes les plus fréquents, ce qu’il ne peut
 * pas faire (et à qui s’adresser), ses erreurs classiques et ce qu’il vérifie avant de partir. Les droits
 * décrits sont ceux du semis (domain/help/profiles.ts) ; les libellés sont recopiés des écrans.
 */
export const TOPICS_GUIDES_PROFILS: readonly HandbookTopic[] = [
  {
    id: 'guide-accueil',
    title: 'Guide de l’accueil : votre journée',
    summary:
      'Ce que l’accueil voit dans l’application, sa routine du matin au soir, ses gestes les plus fréquents et ce qui relève d’une autre personne.',
    module: null,
    anyPermission: [],
    audience: ['RECEPTION'],
    intro:
      'Vous êtes la première personne que le patient rencontre. Ce que vous saisissez (une fiche juste, une arrivée, un rendez-vous) sert ensuite au professionnel et à la caissière.',
    blocks: [
      {
        kind: 'points',
        title: 'Ce que vous voyez',
        items: [
          'Menu, selon les écrans ouverts au cabinet : « Accueil », « Aujourd’hui », « Patients » et « Agenda ». « Consultations », « Ventes et caisse » et « Paramètres » n’y figurent pas : ils ne relèvent pas de l’accueil.',
          'Sur la page d’accueil, le bandeau « Aujourd’hui » donne les chiffres du jour. Vos raccourcis, notamment : « Nouveau patient », « Rechercher », « Rendez-vous », « Patients à rappeler » et « Enregistrer une arrivée ».',
        ],
      },
      {
        kind: 'flow',
        title: 'Votre journée',
        stages: [
          {
            label: 'Le matin',
            text: 'Lisez l’agenda du jour dans « Agenda », puis ouvrez « Patients à rappeler » : ce sont vos premiers appels.',
          },
          {
            label: 'À chaque arrivée',
            text: 'Cherchez la fiche, créez-la seulement si elle n’existe pas, puis enregistrez l’arrivée.',
          },
          {
            label: 'Dans la journée',
            text: 'Suivez la file dans « Aujourd’hui », prenez les rendez-vous, rappelez les patients et notez chaque contact.',
          },
          {
            label: 'En fin de journée',
            text: 'Relisez la file, préparez demain, puis déconnectez-vous (liste plus bas).',
          },
        ],
      },
      {
        kind: 'points',
        title: 'Vos gestes les plus fréquents',
        items: [
          'Retrouver une fiche : « Patients », puis « Rechercher un patient » (nom, téléphone ou numéro de dossier) et « Rechercher ». Pour corriger une fiche : « Modifier ».',
          'Créer une fiche, seulement si personne ne correspond : « Nouveau patient », puis « Enregistrer le patient ». Devant « Des fiches ressemblent à ce patient », comparez avant de choisir « Créer quand même ».',
          'Enregistrer une arrivée : « Enregistrer une arrivée », « Motif de la visite », puis « Enregistrer l’arrivée ». Pour un patient attendu, partez de son rendez-vous dans « Agenda ».',
          'Donner un rendez-vous : « Rendez-vous », puis « Confirmer le rendez-vous ». « Déplacer » change l’heure ; « Annuler » demande un motif.',
          'Rappeler un patient : « Patients à rappeler », « Noter un contact », puis « Enregistrer la tentative ». Vous appelez vous-même : l’application n’envoie aucun message.',
        ],
      },
      {
        kind: 'table',
        title: 'Ce que vous ne pouvez pas faire, et à qui vous adresser',
        head: ['Vous voulez…', 'Ce qui se passe, et à qui vous adresser'],
        rows: [
          [
            'Lire ou saisir un examen, une ordonnance',
            'Réservé au professionnel : ces écrans ne s’ouvrent pas à l’accueil.',
          ],
          [
            'Facturer, encaisser, voir la caisse',
            'Réservé à la caissière et à la gérante : adressez le patient à la caisse.',
          ],
          [
            'Réunir deux fiches du même patient',
            'La gérante seule fusionne. Ne créez pas une troisième fiche : donnez-lui les deux numéros de dossier.',
          ],
          [
            'Régler l’agenda (horaires, salles, prestations)',
            'La gérante, avec « Configuration ».',
          ],
          [
            'Un bouton absent, ou « Accès refusé »',
            'La gérante attribue le droit manquant, si ce geste fait partie de votre travail.',
          ],
        ],
      },
      {
        kind: 'points',
        title: 'Les erreurs classiques',
        items: [
          'Créer une fiche sans chercher : un doublon coupe l’historique du patient en deux. Cherchez par le nom, puis par le téléphone.',
          'Choisir « Achat direct » pour un patient qui vient se faire examiner : aucun examen n’est créé. Cliquez sur « Annuler la visite », puis enregistrez une nouvelle arrivée avec « Examen de vue ».',
          'Lire une file périmée : « Aujourd’hui » ne se met pas à jour seul. Cliquez sur « Actualiser la file ».',
          'Écrire une information médicale dans la « Note administrative (facultative) » : toute l’équipe la lit dans la file du jour.',
        ],
      },
      {
        kind: 'steps',
        title: 'Avant de partir',
        items: [
          'Cliquez sur « Actualiser la file ». Pour un patient reparti avant l’examen, cliquez sur « Annuler la visite ».',
          'Dans « Patients à rappeler », vérifiez que chaque appel du jour est noté.',
          'Dans « Agenda », cliquez sur « Jour suivant » pour lire les rendez-vous de demain.',
          'Cliquez sur « Se déconnecter ».',
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Un doute sur un écran ? Cliquez sur « Aide » dans l’en-tête.',
      },
    ],
    related: [
      {
        topic: 'parcours-accueillir',
        label: 'Accueillir un patient, de la recherche à la file du jour',
      },
      { topic: 'parcours-rendez-vous', label: 'Prendre, déplacer et annuler un rendez-vous' },
      {
        topic: 'parcours-suivi',
        label: 'Suivre le patient : contrôle recommandé et patients à rappeler',
      },
      { topic: 'notion-visite-examen', label: 'La visite, la file du jour et l’examen' },
      { topic: 'notion-patient', label: 'Le dossier patient et l’identité' },
      { topic: 'profils', label: 'Les profils : qui peut faire quoi' },
    ],
    keywords: [
      'accueil',
      'réception',
      'réceptionniste',
      'secrétaire',
      'secrétariat',
      'comptoir',
      'ma journée',
      'routine',
      'matin',
      'fin de journée',
      'avant de partir',
      'liste de contrôle',
      'mes droits',
      'ce que je peux faire',
      'guide',
    ],
  },
  {
    id: 'guide-professionnel',
    title: 'Guide du professionnel : votre journée',
    summary:
      'Ce que le professionnel voit dans l’application, sa routine d’examen, ses gestes les plus fréquents et ce qui relève d’une autre personne.',
    module: null,
    anyPermission: [],
    audience: ['CLINICIAN'],
    intro:
      'Votre travail est l’examen de vue et la prescription. L’application enregistre ce que vous saisissez : elle ne pose aucun diagnostic et ne convertit ni ne transpose aucune mesure.',
    blocks: [
      {
        kind: 'points',
        title: 'Ce que vous voyez',
        items: [
          'Menu, selon les écrans ouverts au cabinet : « Accueil », « Aujourd’hui », « Patients », « Consultations » et « Agenda ». Ni « Ventes et caisse », ni « Paramètres ».',
          'Sur la page d’accueil, sous « Examens » : « Nouvelle consultation », « Mes examens en cours » et « Examens du jour ». Dans un dossier patient, vous lisez les onglets « Identité », « Activité » et « Prescriptions » sans pouvoir modifier la fiche.',
        ],
      },
      {
        kind: 'flow',
        title: 'Votre journée',
        stages: [
          {
            label: 'Le matin',
            text: 'Ouvrez « Aujourd’hui » : la file liste les patients arrivés, du plus ancien au plus récent.',
          },
          {
            label: 'À chaque patient',
            text: 'Vérifiez son nom, remplissez les sept étapes de l’examen, puis terminez l’examen.',
          },
          {
            label: 'Prescription et documents',
            text: 'Rédigez et validez la prescription optique, puis imprimez les documents.',
          },
          {
            label: 'Pour le suivi',
            text: 'Si le patient doit revenir, programmez un contrôle recommandé.',
          },
        ],
      },
      {
        kind: 'points',
        title: 'Vos gestes les plus fréquents',
        items: [
          'Démarrer : « Nouvelle consultation » (accueil) ou « Démarrer l’examen » dans « Aujourd’hui ». Ensuite « Reprendre l’examen » (examen commencé) ou « Consulter l’examen » (examen terminé).',
          'Saisir et terminer : « Suivant » enregistre l’étape et avance, « Enregistrer » la garde sans avancer. À la fin : « Terminer l’examen ».',
          'Prescrire : « Prescription optique », « Nouvelle prescription », « Enregistrer le brouillon », puis « Valider la prescription ». Une version validée ne change plus : « Créer une nouvelle version ».',
          'Imprimer : « Aperçu de la prescription » (version validée), « Aperçu de l’ordonnance de médicaments » ou « Aperçu de la lettre d’orientation », puis « Imprimer ».',
          'Corriger un examen terminé : « Corriger l’examen », avec son motif. Prévoir le retour du patient : « Programmer un contrôle ».',
        ],
      },
      {
        kind: 'table',
        title: 'Ce que vous ne pouvez pas faire, et à qui vous adresser',
        head: ['Vous voulez…', 'Ce qui se passe, et à qui vous adresser'],
        rows: [
          [
            'Créer ou corriger une fiche patient',
            'Vous lisez la fiche sans la modifier : prévenez l’accueil, ou la gérante.',
          ],
          ['Facturer, encaisser, voir la caisse', 'Réservé à la caissière et à la gérante.'],
          [
            'Réunir deux fiches du même patient',
            'La gérante seule fusionne : donnez-lui les deux numéros de dossier.',
          ],
          [
            'Un bouton absent, ou « Accès refusé »',
            'La gérante attribue le droit manquant, si ce geste fait partie de votre travail.',
          ],
        ],
      },
      {
        kind: 'points',
        title: 'Les erreurs classiques',
        items: [
          'Oublier « Terminer l’examen » : la visite reste « En consultation » et les documents de l’examen ne s’impriment pas.',
          'Quitter une étape sans l’enregistrer : elle porte la mention « non enregistrée » tant que vous n’avez pas cliqué sur « Suivant » ou « Enregistrer ».',
          'Confondre « Non renseigné », « Non » et « Aucun connu » : une rubrique laissée vide reste non renseignée, ce n’est ni un « Non » ni un zéro.',
          'Convertir une mesure avant de la saisir : notez la valeur telle qu’elle est lue. L’application ne convertit rien.',
        ],
      },
      {
        kind: 'steps',
        title: 'Avant de partir',
        items: [
          'Depuis l’accueil, ouvrez « Mes examens en cours » : terminez ceux dont la saisie est achevée.',
          'Vérifiez que chaque prescription validée est imprimée, signée et cachetée.',
          'Cliquez sur « Se déconnecter » : un dossier médical ne reste pas ouvert sur un poste partagé.',
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Un doute sur un écran ? Cliquez sur « Aide » dans l’en-tête.',
      },
    ],
    related: [
      {
        topic: 'parcours-examen',
        label: 'Examen de vue : démarrer, saisir, terminer, corriger, comparer',
      },
      {
        topic: 'parcours-ordonnance',
        label: 'Prescription optique et ordonnances : rédiger, valider, imprimer',
      },
      {
        topic: 'parcours-suivi',
        label: 'Suivre le patient : contrôle recommandé et patients à rappeler',
      },
      {
        topic: 'notion-examen-prescription',
        label: 'L’examen par étapes et la prescription optique',
      },
      {
        topic: 'glossaire-optique',
        label: 'Glossaire de l’optique',
        why: 'Sphère, cylindre, axe, addition, OD, OG.',
      },
      { topic: 'profils', label: 'Les profils : qui peut faire quoi' },
    ],
    keywords: [
      'professionnel',
      'opticien',
      'optométriste',
      'examinateur',
      'consultation',
      'examen de vue',
      'ordonnance',
      'ma journée',
      'routine',
      'avant de partir',
      'liste de contrôle',
      'mes droits',
      'ce que je peux faire',
      'guide',
    ],
  },
  {
    id: 'guide-caisse',
    title: 'Guide de la caissière : votre journée',
    summary:
      'Ce que la caissière voit dans l’application, sa routine de caisse, ses gestes les plus fréquents et ce qui demande l’accord de la gérante.',
    module: null,
    anyPermission: [],
    audience: ['CASHIER'],
    intro:
      'Vous vendez et vous encaissez : une facture, un reçu par encaissement, une caisse qui tombe juste le soir. Tout ce qui sort de l’ordinaire passe par la gérante.',
    blocks: [
      {
        kind: 'points',
        title: 'Ce que vous voyez',
        items: [
          'Menu, selon les écrans ouverts au cabinet : « Accueil », « Aujourd’hui » et « Agenda » (en lecture), « Patients » (identité seulement) et « Ventes et caisse ». Ni « Consultations », ni « Paramètres ».',
          'Dans « Ventes et caisse » : « Caisse », « Caisse du jour », « Nouvelle facture », « Factures », « Devis » et, si le cabinet l’a ouvert, « Stock ». « Catalogue » et « Règles fiscales » sont réservés à la gérante.',
          'Sur la page d’accueil, « Caisse », « Nouvelle facture » et « Factures » sont à un clic.',
        ],
      },
      {
        kind: 'flow',
        title: 'Votre journée',
        stages: [
          {
            label: 'À l’ouverture',
            text: 'Comptez le tiroir, puis ouvrez votre caisse avec son fond.',
          },
          {
            label: 'À chaque vente',
            text: 'Créez la facture depuis la fiche ou la visite du patient, puis émettez-la.',
          },
          {
            label: 'À l’encaissement',
            text: 'Encaissez l’acompte ou le reste, puis imprimez le reçu.',
          },
          {
            label: 'À la remise',
            text: 'Remettez l’article depuis la facture quand il est prêt.',
          },
          {
            label: 'Pour l’exception',
            text: 'Remise, correction, dépense : demandez l’accord de la gérante.',
          },
          {
            label: 'À la fermeture',
            text: 'Comptez le tiroir, clôturez la caisse, imprimez le relevé.',
          },
        ],
      },
      {
        kind: 'points',
        title: 'Vos gestes les plus fréquents',
        items: [
          'Ouvrir la caisse : « Ventes et caisse », « Caisse », « Fond de caisse », puis « Ouvrir la caisse ». Sans session ouverte, aucun encaissement en espèces.',
          'Facturer : « Créer une facture » depuis la fiche ou la visite du patient. Puis « Ajouter un article du catalogue », « Enregistrer le brouillon » et « Émettre la facture ».',
          'Encaisser : « Montant encaissé », « Mode de règlement », puis « Encaisser ». « Encaisser le reste » saisit le montant restant. Un mobile money ou un virement demande la « Référence de l’opération ».',
          'Imprimer : « Aperçu du reçu (PDF) » après chaque encaissement, « Aperçu de la facture (PDF) » pour la facture, puis « Imprimer ».',
          'Remettre : sur la facture, « Remettre au patient », « Quantité remise », puis « Confirmer la remise ».',
        ],
      },
      {
        kind: 'table',
        title: 'Ce que vous ne pouvez pas faire, et à qui vous adresser',
        head: ['Vous voulez…', 'Ce qui se passe, et à qui vous adresser'],
        rows: [
          [
            'Une remise au-delà de votre plafond, une remise d’article avant le règlement complet, un mouvement d’espèces (dépense, retrait, dépôt)',
            'L’écran propose « Demander une autorisation », « Demander l’autorisation de remise » ou « Demander l’autorisation ». Après l’accord de la gérante, refaites exactement la même opération.',
          ],
          [
            'Corriger un encaissement, rembourser, enregistrer un retour',
            'Rien ne se supprime. Le bouton devient « Demander l’autorisation » : envoyez la demande avec son motif, la gérante fait la correction depuis la facture. Elle seule enregistre un retour.',
          ],
          [
            'Créer une fiche, enregistrer une arrivée, modifier un prix, une taxe ou le stock',
            'L’accueil gère les fiches et les arrivées ; la gérante seule modifie le catalogue, les taxes et le stock.',
          ],
        ],
      },
      {
        kind: 'points',
        title: 'Les erreurs classiques',
        items: [
          'Encaisser en espèces sans caisse ouverte : l’écran affiche « Caisse non ouverte » et le lien « Ouvrir la caisse ».',
          'Ressaisir un encaissement après une coupure : l’écran affiche « Enregistrement non confirmé ». Cliquez sur « Réessayer l’encaissement » : la même demande repart, sans second encaissement.',
          'Saisir plus que le reste : l’écran répond « Le montant dépasse le reste à encaisser » et donne le reste exact.',
          'Remettre un PDF « DOCUMENT DE TEST » comme pièce officielle : il n’a aucune valeur tant que les mentions du cabinet ne sont pas validées.',
        ],
      },
      {
        kind: 'steps',
        title: 'Avant de partir',
        items: [
          'Émettez ou abandonnez vos brouillons du jour (« Abandonner le brouillon »).',
          'Prévenez la gérante de chaque demande restée sans réponse : aucun compteur ne l’avertit.',
          'Comptez le tiroir, saisissez le « Montant compté dans le tiroir », puis cliquez sur « Clôturer la caisse ». Un écart demande son « Motif de l’écart ».',
          'Imprimez le « Relevé de clôture (PDF) », puis cliquez sur « Se déconnecter ».',
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Un doute sur un écran ? Cliquez sur « Aide » dans l’en-tête.',
      },
    ],
    related: [
      { topic: 'parcours-vente', label: 'Vendre : de la facture au reçu' },
      { topic: 'parcours-caisse', label: 'Tenir la caisse' },
      { topic: 'parcours-remise-article', label: 'Remettre les articles au patient' },
      { topic: 'parcours-correction', label: 'Corriger une erreur' },
      { topic: 'notion-encaissement', label: 'Encaissements, reçus et corrections' },
      { topic: 'notion-approbations', label: 'Approbations : l’accord de la gérante' },
    ],
    keywords: [
      'caissière',
      'caissier',
      'caisse',
      'vendeuse',
      'vente',
      'encaisser',
      'facture',
      'ouverture de caisse',
      'clôture',
      'ma journée',
      'routine',
      'avant de partir',
      'liste de contrôle',
      'mes droits',
      'ce que je peux faire',
      'guide',
    ],
  },
  {
    id: 'guide-gerante',
    title: 'Guide de la gérante : votre journée',
    summary:
      'Ce que la gérante voit dans l’application, son rythme du matin au soir, ses gestes les plus fréquents et ce qui relève du prestataire.',
    module: null,
    anyPermission: ['users.manage'],
    audience: ['MANAGER'],
    intro:
      'Vous pouvez tout faire dans l’application, mais votre rôle propre est de décider, de corriger et de contrôler. La page d’accueil n’affiche aucun compteur de demandes : c’est à vous d’ouvrir « Autorisations ».',
    blocks: [
      {
        kind: 'points',
        title: 'Ce que vous voyez',
        items: [
          'Menu : tous les écrans ouverts au cabinet, dont « Paramètres ». Le stock s’ouvre depuis « Ventes et caisse », carte « Stock ».',
          'Sur la page d’accueil : le bandeau « Aujourd’hui » (avec « Encaissé net »), « Statistiques » et, sous « Administration », « Personnel », « Cabinet et documents » et « Catalogue ».',
          'Dans « Paramètres » : « Personnel », « Cabinet et documents », « Autorisations » et « Exports ».',
        ],
      },
      {
        kind: 'flow',
        title: 'Votre journée',
        stages: [
          {
            label: 'Le matin',
            text: 'Lisez le bandeau de l’accueil, puis ouvrez « Paramètres » et « Autorisations » : les demandes « En attente ».',
          },
          {
            label: 'Dans la journée',
            text: 'Décidez les demandes, exécutez les corrections de pièces, rouvrez « Autorisations » régulièrement.',
          },
          {
            label: 'Le soir',
            text: 'Vérifiez que les sessions de caisse sont clôturées, revoyez les écarts, lisez « Caisse du jour ».',
          },
          {
            label: 'Chaque semaine',
            text: 'Repérez les factures encore ouvertes, contrôlez « Stock », lisez « Statistiques », rangez un export.',
          },
        ],
      },
      {
        kind: 'points',
        title: 'Vos gestes les plus fréquents',
        items: [
          'Décider : « Paramètres », « Autorisations », puis « Accorder » ou « Refuser » (motif obligatoire pour un refus) et « Confirmer et reprendre ». Un accord vaut pour une seule opération, une seule fois, avant son « Échéance ».',
          'Corriger, sur la facture : « Contre-passer le paiement », « Émettre un avoir », « Rembourser » ou « Enregistrer un retour ». Sur une fiche en double : « Fusionner avec une autre fiche ».',
          'Suivre les caisses : « Caisse », puis « Sessions de toutes les caisses ». « Clôturer cette session » ferme une session oubliée ; « Revoir l’écart » accepte ou conteste un écart.',
          'Tenir le personnel : « Paramètres », « Personnel », « Créer un compte », puis remettez le mot de passe initial en personne. Pour un départ, décochez « Compte actif » : un compte n’est jamais supprimé.',
        ],
      },
      {
        kind: 'table',
        title: 'Ce que vous ne pouvez pas faire, et à qui vous adresser',
        head: ['Vous voulez…', 'Ce qui se passe, et à qui vous adresser'],
        rows: [
          [
            'Décider votre propre demande',
            'L’écran répond « Vous avez fait cette demande ». Exécutez directement l’opération : la trace dit « Autorisation directe de la gérante ».',
          ],
          [
            'Modifier ou supprimer une facture émise, un paiement, un reçu',
            'Personne ne le peut. L’original reste, la correction s’ajoute à côté.',
          ],
          [
            'Choisir le taux d’une taxe',
            'Le comptable. Saisissez dans « Règles fiscales » ce qu’il confirme.',
          ],
          [
            'Ouvrir un écran absent du menu, activer les documents officiels, choisir les séries de numéros',
            'Le prestataire, à la mise en service.',
          ],
          [
            'Réinitialiser le mot de passe d’une gérante, restaurer une sauvegarde',
            'Le prestataire : la procédure se fait sur le serveur, pas dans l’application.',
          ],
        ],
      },
      {
        kind: 'points',
        title: 'Les erreurs classiques',
        items: [
          'Oublier « Autorisations » : aucun compteur ne vous prévient, et la caissière attend votre décision pour remettre un article ou noter une dépense.',
          'Accorder, puis voir la demande changer : un accord vaut pour une opération précise. Si un montant, une ligne ou un mode change, il faut une nouvelle demande.',
          'Perdre le mot de passe initial d’un nouveau compte : il n’est affiché qu’une fois (« J’ai noté, ouvrir le compte »). Pour en obtenir un autre : « Réinitialiser le mot de passe ».',
          'Garder un export sans protection : l’archive contient des données de santé et reste disponible 48 heures. Rangez-la sur un support protégé, jamais par message.',
        ],
      },
      {
        kind: 'steps',
        title: 'Avant de partir',
        items: [
          'Ouvrez « Paramètres », puis « Autorisations » : plus aucune demande « En attente ».',
          'Dans « Caisse », « Sessions de toutes les caisses » : chaque session est clôturée, chaque écart revu.',
          'Lisez le « Total net encaissé » dans « Caisse du jour ».',
          'Cliquez sur « Se déconnecter ».',
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Un doute sur un écran ? Cliquez sur « Aide » dans l’en-tête.',
      },
    ],
    related: [
      { topic: 'parcours-gestion', label: 'Gérer le cabinet' },
      { topic: 'notion-approbations', label: 'Approbations : l’accord de la gérante' },
      { topic: 'parcours-correction', label: 'Corriger une erreur' },
      { topic: 'parcours-caisse', label: 'Tenir la caisse' },
      { topic: 'exploitation', label: 'Exploitation : au quotidien et en cas de problème' },
      { topic: 'depannage-limites', label: 'Ce que cette version ne fait pas encore' },
    ],
    keywords: [
      'gérante',
      'gérant',
      'responsable',
      'direction',
      'directrice',
      'patronne',
      'superviser',
      'autorisations',
      'créer un compte',
      'mot de passe initial',
      'ma journée',
      'routine',
      'rythme',
      'avant de partir',
      'liste de contrôle',
      'mes droits',
      'ce que je peux faire',
      'guide',
    ],
  },
]
