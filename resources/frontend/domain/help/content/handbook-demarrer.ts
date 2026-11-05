import type { HandbookTopic } from '../model'

/**
 * Documentation globale, partie « Démarrer » : bienvenue, connexion, repères, profils, principes
 * et journée type. Libellés recopiés de l’application ; voir docs/implementation/help.md.
 */
export const TOPICS_DEMARRER: readonly HandbookTopic[] = [
  {
    id: 'bienvenue',
    title: 'Bienvenue dans l’application',
    summary:
      'Ce que fait l’application pour le cabinet, comment ses écrans sont organisés et ce qui est disponible aujourd’hui.',
    module: null,
    anyPermission: [],
    intro:
      'Eagle’s Eye Optics Medical est l’outil privé du cabinet. Il réunit au même endroit les patients, les examens de vue, les ordonnances, les ventes, la caisse, le stock et l’agenda. Chacun y trouve ce qui concerne son travail.',
    blocks: [
      {
        kind: 'points',
        title: 'Ce que l’application fait pour le cabinet',
        items: [
          '« Patients » : une fiche par patient, créée une seule fois. Son identité est reprise à l’arrivée, à l’examen, sur les ordonnances et sur les factures.',
          '« Aujourd’hui » : les arrivées du jour et la file des patients, de l’arrivée jusqu’à l’examen.',
          '« Consultations » : l’examen de vue en sept étapes, la prescription optique et les ordonnances à imprimer en PDF.',
          '« Agenda » : les rendez-vous et la liste des patients à rappeler.',
          '« Ventes et caisse » : devis, factures, encaissements, reçus, remise des articles, caisse du jour et stock disponible. La gérante y tient aussi le catalogue et les règles fiscales.',
          '« Statistiques » et « Paramètres » : les chiffres d’activité, puis les comptes du personnel, l’identité du cabinet, les approbations et les exports.',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Tous les écrans suivent la même organisation : l’en-tête en haut, le menu, puis le contenu avec son titre, ses boutons et ses messages. Le bouton « Aide » de l’en-tête explique l’écran où vous êtes.',
      },
      {
        kind: 'points',
        title: 'Ce qui est disponible aujourd’hui',
        items: [
          'L’application fonctionne avec une connexion Internet : chaque enregistrement est confirmé par le serveur avant d’être dit enregistré.',
          'Les écrans s’ouvrent progressivement. Vous ne voyez que ceux que le cabinet a ouverts et que votre profil permet.',
          'Les PDF (facture, reçu, ordonnance) portent la mention « DOCUMENT DE TEST » tant que les mentions officielles du cabinet ne sont pas validées.',
        ],
      },
      {
        kind: 'points',
        title: 'Ce que cette version ne fait pas encore',
        items: [
          'Le travail sans connexion Internet : la fonction existe, mais elle est encore en cours de validation et n’est pas ouverte au cabinet.',
          'L’application n’envoie aucun SMS ni message WhatsApp : elle liste les patients à rappeler, c’est vous qui les appelez ou leur écrivez.',
          'L’atelier (suivi des commandes à l’atelier), les campagnes de communication et les exports comptables.',
          'La réception de marchandises fournisseurs, l’inventaire et les alertes de péremption du stock.',
        ],
      },
      {
        kind: 'steps',
        title: 'Pour bien démarrer',
        items: [
          'Connectez-vous et remplacez votre mot de passe initial.',
          'Repérez l’en-tête, le menu et les messages de l’application.',
          'Lisez ce que votre profil vous permet de faire.',
          'Retenez les principes : ils expliquent les refus de l’application.',
          'Suivez la journée type, puis le parcours qui correspond à votre travail.',
        ],
      },
    ],
    related: [
      { topic: 'se-connecter', label: 'Se connecter et se déconnecter' },
      { topic: 'se-reperer', label: 'Se repérer dans l’application' },
      { topic: 'profils', label: 'Les profils : qui peut faire quoi' },
      { topic: 'principes', label: 'Sept principes à connaître' },
      { topic: 'journee-type', label: 'Une journée type au cabinet' },
      { topic: 'depannage-limites', label: 'Ce que cette version ne fait pas encore' },
    ],
    keywords: [
      'présentation',
      'démarrer',
      'commencer',
      'débuter',
      'à quoi sert',
      'découvrir',
      'premiers pas',
      'nouveau',
      'fonctions',
      'disponible',
      'bienvenue',
    ],
  },
  {
    id: 'se-connecter',
    title: 'Se connecter et se déconnecter',
    summary:
      'Ouvrir votre session, remplacer le mot de passe initial, reprendre après « Session expirée » et fermer la session en fin de journée.',
    module: null,
    anyPermission: [],
    intro:
      'Chaque personne a son propre compte, avec un identifiant et un mot de passe personnels. Ce que vous faites est enregistré à votre nom : ne prêtez jamais votre compte.',
    blocks: [
      {
        kind: 'steps',
        title: 'Première connexion',
        items: [
          'La gérante crée votre compte (« Paramètres », « Personnel », « Créer un compte ») et vous remet en personne votre identifiant et un mot de passe initial.',
          'Ouvrez l’adresse de l’application : l’écran « Connexion » s’affiche.',
          'Saisissez votre « Identifiant » et votre « Mot de passe », puis cliquez sur « Se connecter ». La page d’accueil s’ouvre sur « Bonjour » et votre nom.',
          'Sur la page d’accueil, cliquez sur « Changer mon mot de passe ». L’application ne l’impose pas : faites-le dès la première connexion.',
          'Saisissez « Mot de passe actuel » (le mot de passe initial), « Nouveau mot de passe » et « Confirmation du nouveau mot de passe », puis cliquez sur « Changer le mot de passe ».',
          'L’écran affiche « Mot de passe changé sur le serveur » : votre session reste ouverte, vos autres sessions sont fermées.',
        ],
      },
      {
        kind: 'points',
        title: 'Un mot de passe accepté',
        items: [
          'Au moins 12 caractères, avec des lettres et des chiffres, différent de votre identifiant et de votre mot de passe actuel.',
          'La gérante ne peut pas le lire. Si vous l’oubliez, elle en remet un nouveau, que vous changez ensuite.',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Mot de passe oublié : demandez à la gérante de le réinitialiser. Si c’est la gérante qui l’a perdu, la réinitialisation se fait sur le serveur, avec l’exploitant de l’application.',
      },
      {
        kind: 'points',
        title: 'Session de 30 minutes',
        items: [
          'Après 30 minutes sans aucune activité, votre session prend fin. L’écran ne prévient pas à l’avance.',
          'Au retour sur l’onglet ou à votre prochaine action, l’en-tête affiche « Session expirée : vos saisies sont conservées » et le bouton « Se reconnecter ».',
          'Cliquez sur « Se reconnecter » et saisissez votre « Mot de passe » : l’écran et vos saisies sont toujours là, vous pouvez les enregistrer. Seul le compte qui a commencé la saisie peut la reprendre.',
        ],
      },
      {
        kind: 'steps',
        title: 'Se déconnecter',
        items: [
          'En fin de journée, ou dès que vous quittez le poste, cliquez sur « Se déconnecter » dans l’en-tête.',
          'Attendez l’écran « Connexion » : il n’apparaît que lorsque le serveur a confirmé la fermeture de votre session.',
          'Si l’écran affiche « Déconnexion impossible », votre session est restée ouverte : réessayez quand la connexion revient, avant de laisser le poste.',
        ],
      },
      {
        kind: 'faq',
        title: 'Quand la connexion échoue',
        items: [
          {
            q: 'L’écran affiche « Connexion impossible ».',
            a: 'Un message dit ce qui manque ou ce qui est refusé. Le mot de passe est effacé, l’identifiant reste : ressaisissez le mot de passe. Il est le même pour un compte désactivé : si rien n’y fait, demandez à la gérante de vérifier votre compte dans « Personnel ». Après plusieurs essais ratés en une minute, patientez avant de réessayer.',
          },
          {
            q: 'L’écran affiche « Serveur injoignable ».',
            a: 'L’application ne reçoit pas de réponse du serveur. La connexion exige le réseau : réessayez quand l’en-tête affiche « En ligne ».',
          },
        ],
      },
    ],
    related: [
      { topic: 'se-reperer', label: 'Se repérer dans l’application' },
      { topic: 'profils', label: 'Les profils : qui peut faire quoi' },
      { topic: 'principes', label: 'Sept principes à connaître' },
      { topic: 'depannage-messages', label: 'Comprendre les messages de l’application' },
      { topic: 'guide-gerante', label: 'Guide de la gérante : créer les comptes' },
    ],
    keywords: [
      'login',
      'identifiant',
      'mot de passe',
      'mdp',
      'connexion',
      'déconnexion',
      'session expirée',
      'mot de passe oublié',
      'première connexion',
      'changer le mot de passe',
      'reconnecter',
      'compte',
      'se connecter',
    ],
  },
  {
    id: 'se-reperer',
    title: 'Se repérer dans l’application',
    summary:
      'L’en-tête, le menu, la page d’accueil, la structure d’un écran et la lecture des messages, au clavier comme sur téléphone.',
    module: null,
    anyPermission: [],
    intro:
      'Tous les écrans suivent la même organisation. Une fois repérée, elle vous sert partout.',
    blocks: [
      {
        kind: 'table',
        title: 'Les trois zones de l’écran',
        head: ['Zone', 'Ce que vous y trouvez'],
        rows: [
          [
            'En-tête, en haut',
            'Le nom « Eagle’s Eye Optics Medical » (un clic ramène à la page d’accueil), l’état du réseau, votre nom, « Aide » et « Se déconnecter ».',
          ],
          [
            'Menu, à gauche (en bas sur téléphone)',
            'Seulement les écrans ouverts à votre compte : « Accueil », « Aujourd’hui », « Patients », « Consultations », « Agenda », « Ventes et caisse », « Paramètres ». Sur téléphone, « Aujourd’hui », « Patients » et « Agenda » restent visibles, « Plus » ouvre le reste.',
          ],
          [
            'Contenu, au centre',
            'Le titre de l’écran, ses boutons d’action, puis les résultats, les formulaires et les messages.',
          ],
        ],
      },
      {
        kind: 'points',
        title: 'La page d’accueil',
        items: [
          'Elle dit « Bonjour » et votre nom, puis la date du cabinet. Le bandeau « Aujourd’hui » donne les chiffres du jour : « Patients en attente », « En consultation », « Visites terminées », « Rendez-vous », « Encaissé net ». « Actualiser les chiffres » les relit.',
          'Sous « Actions », les gestes courants : « Nouveau patient », « Nouvelle consultation », « Rechercher », « Rendez-vous », « Consultations du jour », « Statistiques », « Paramètres ». Plus bas, des raccourcis par activité : « Accueil des patients », « Examens », « Caisse et ventes », « Administration ».',
          'Tout dépend de votre profil. Une tuile, un bouton ou une entrée de menu absent signifie que votre compte n’y a pas droit, ou que l’exploitant ne l’a pas encore ouvert.',
        ],
      },
      {
        kind: 'points',
        title: 'Un écran, de haut en bas',
        items: [
          'Le titre dit où vous êtes ; l’onglet du navigateur porte le même nom. Au-dessus, un lien de retour (par exemple « Retour aux factures ») ramène à l’écran précédent.',
          'Les boutons d’action sont en haut à droite, sous le titre sur téléphone. Le bouton principal est plein, les autres sont blancs.',
          'Un champ obligatoire porte la mention « (obligatoire) » sur son étiquette ; un champ facultatif le dit aussi. Le bouton « Aide » ouvre la fiche de l’écran où vous êtes, avec un renvoi vers toute la documentation.',
        ],
      },
      {
        kind: 'table',
        title: 'Lire les messages',
        head: ['Message', 'Ce qu’il veut dire, et que faire'],
        rows: [
          [
            'Succès (✓)',
            'Le serveur a confirmé, par exemple « Enregistré sur le serveur » ou « Encaissement enregistré sur le serveur ». Vous pouvez continuer.',
          ],
          [
            'Erreur (⚠)',
            '« Certaines informations sont à corriger » : chaque ligne du résumé mène au champ concerné. Corrigez-les, vos autres saisies sont conservées.',
          ],
          [
            'Conflit (⇄)',
            'Quelqu’un a modifié la même chose entre-temps, par exemple « Le brouillon a changé entre-temps ». Relisez la version actuelle avant de choisir.',
          ],
          [
            '« Hors ligne » ou « Serveur injoignable » (en-tête)',
            'Votre appareil n’a plus de réseau, ou le serveur ne répond pas. Rien n’est enregistré tant que cela dure ; vos saisies restent à l’écran. Reprenez quand l’en-tête redit « En ligne ».',
          ],
          [
            '« Accès refusé » ou « Page introuvable »',
            'Votre compte n’a pas le droit d’ouvrir cet écran, ou l’adresse ne mène à aucun écran ouvert. Revenez à la page d’accueil ; demandez le droit à la gérante si cela fait partie de votre travail.',
          ],
        ],
      },
      {
        kind: 'points',
        title: 'Au clavier et en saisie',
        items: [
          '« Aller au contenu » est le premier arrêt de la touche Tab : il saute l’en-tête et le menu. Après chaque changement d’écran, le curseur se place sur le contenu.',
          'Échap ferme une boîte de confirmation ou le menu « Plus ». Dans une liste de résultats, les flèches choisissent, Entrée valide, Échap ferme la liste.',
          'Les dates se saisissent en JJ/MM/AAAA, les montants en FCFA entiers. Quitter un écran avec une saisie non enregistrée demande confirmation : « Des saisies ne sont pas encore enregistrées. Quitter cet écran sans les enregistrer ? »',
        ],
      },
    ],
    related: [
      { topic: 'profils', label: 'Les profils : qui peut faire quoi' },
      { topic: 'principes', label: 'Sept principes à connaître' },
      { topic: 'journee-type', label: 'Une journée type au cabinet' },
      { topic: 'depannage-messages', label: 'Comprendre les messages de l’application' },
      { topic: 'depannage-questions', label: 'Questions fréquentes' },
    ],
    keywords: [
      'menu',
      'navigation',
      'accueil',
      'en-tête',
      'barre',
      'téléphone',
      'mobile',
      'clavier',
      'message',
      'erreur',
      'réseau',
      'en ligne',
      'hors ligne',
      'aide',
      'raccourcis',
      'où cliquer',
      'tuile',
      'tableau de bord',
    ],
  },
  {
    id: 'profils',
    title: 'Les profils : qui peut faire quoi',
    summary:
      'Ce que voient et font la gérante, l’accueil, le professionnel et la caissière, et comment un compte reçoit ses droits.',
    module: null,
    anyPermission: [],
    intro:
      'Votre compte porte un ou plusieurs profils. Le profil décide des écrans du menu et des boutons que vous voyez ; le serveur revérifie chaque action. Un écran ou un bouton absent veut dire que votre profil n’y donne pas droit.',
    blocks: [
      {
        kind: 'table',
        title: 'Qui peut faire quoi',
        head: ['Je veux…', 'Gérante', 'Accueil', 'Professionnel', 'Caissière'],
        rows: [
          [
            'Retrouver une fiche patient, voir la file du jour, l’agenda et les patients à rappeler',
            'Oui',
            'Oui',
            'Oui',
            'Oui',
          ],
          ['Créer ou modifier une fiche patient', 'Oui', 'Oui', 'Non', 'Non'],
          ['Fusionner deux fiches du même patient', 'Oui', 'Non', 'Non', 'Non'],
          ['Enregistrer ou annuler une arrivée', 'Oui', 'Oui', 'Oui', 'Non'],
          [
            'Prendre, déplacer ou annuler un rendez-vous, noter un contact',
            'Oui',
            'Oui',
            'Oui',
            'Non',
          ],
          [
            'Lire et saisir un examen, la prescription, les ordonnances',
            'Oui',
            'Non',
            'Oui',
            'Non',
          ],
          [
            'Programmer un contrôle recommandé, exporter le dossier d’un patient',
            'Oui',
            'Non',
            'Oui',
            'Non',
          ],
          [
            'Créer et émettre une facture, encaisser, imprimer les reçus',
            'Oui',
            'Non',
            'Non',
            'Oui',
          ],
          [
            'Ouvrir et clôturer sa caisse, remettre un article au patient',
            'Oui',
            'Non',
            'Non',
            'Oui',
          ],
          ['Voir la caisse du jour', 'Tout le cabinet', 'Non', 'Non', 'Ses encaissements'],
          [
            'Accorder une remise commerciale ou un prix libre',
            'Oui',
            'Non',
            'Non',
            'Sur accord de la gérante',
          ],
          [
            'Corriger une pièce : contre-écriture, avoir, remboursement',
            'Oui',
            'Non',
            'Non',
            'Elle demande, la gérante exécute',
          ],
          ['Voir les statistiques', 'Activité et examens', 'Activité', 'Examens', 'Non'],
          ['Demander une autorisation', 'Oui', 'Oui', 'Oui', 'Oui'],
          ['Accorder ou refuser une demande', 'Oui', 'Non', 'Non', 'Non'],
          [
            'Gérer le personnel, le cabinet, le catalogue, les règles fiscales, le stock initial, les exports',
            'Oui',
            'Non',
            'Non',
            'Non',
          ],
        ],
      },
      {
        kind: 'points',
        title: 'Ce que chaque profil voit dans le menu',
        items: [
          'La gérante : tous les écrans ouverts, dont « Paramètres ».',
          'L’accueil : « Aujourd’hui », « Patients » et « Agenda ». Ni examens ni ventes.',
          'Le professionnel : « Aujourd’hui », « Patients », « Consultations » et « Agenda ». Ni caisse ni factures.',
          'La caissière : « Aujourd’hui », « Patients » (identité seulement), « Agenda » (lecture) et « Ventes et caisse ».',
        ],
      },
      {
        kind: 'points',
        title: 'Un compte, des profils, des dérogations',
        items: [
          'Un compte peut cumuler plusieurs profils, par exemple « Accueil » et « Caisse » : il reçoit alors les droits de chacun. Sur l’écran « Personnel », les profils s’appellent « Gérante », « Accueil », « Professionnel (examen) » et « Caisse ».',
          'Pour une personne nommée, la gérante peut ajouter ou retirer un droit précis : c’est une « Dérogation de droit », avec un motif et, si elle le souhaite, une date de fin. Retirer un droit l’emporte sur le profil.',
          'Un changement de profil ou de droit s’applique tout de suite. La gérante ne modifie ni ses propres profils ni ses propres droits, et le cabinet garde toujours une gérante active.',
          'Un compte n’est jamais supprimé : il est désactivé et reste l’auteur de ses actions passées.',
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Si l’écran affiche « Accès refusé », votre compte n’a pas le droit de l’ouvrir. Demandez à la gérante d’attribuer le droit nécessaire si cette tâche fait partie de votre travail.',
      },
    ],
    related: [
      { topic: 'guide-gerante', label: 'Guide de la gérante' },
      { topic: 'guide-accueil', label: 'Guide de l’accueil' },
      { topic: 'guide-professionnel', label: 'Guide du professionnel' },
      { topic: 'guide-caisse', label: 'Guide de la caissière' },
      { topic: 'notion-securite', label: 'Sécurité et confidentialité' },
      { topic: 'notion-approbations', label: 'Les approbations de la gérante' },
    ],
    keywords: [
      'rôle',
      'droits',
      'permissions',
      'accès',
      'qui peut',
      'gérante',
      'accueil',
      'réception',
      'professionnel',
      'opticien',
      'caissière',
      'caisse',
      'accès refusé',
      'dérogation',
      'compte',
      'autorisations',
    ],
  },
  {
    id: 'principes',
    title: 'Sept principes à connaître',
    summary:
      'Sept règles qui valent dans tous les écrans : ce qui est définitif, ce qui laisse une trace et qui autorise l’exceptionnel.',
    module: null,
    anyPermission: [],
    intro:
      'Ces règles protègent les patients, la caisse et votre propre travail. Elles expliquent pourquoi l’application refuse parfois ce que vous attendiez.',
    blocks: [
      {
        kind: 'points',
        title: '1. Rien n’est écrasé',
        items: [
          'Une fiche patient modifiée garde la trace de l’ancienne valeur.',
          'Un examen terminé se corrige par une nouvelle révision avec son motif ; les précédentes restent lisibles.',
          'Une prescription validée ne change plus : vous créez une nouvelle version.',
        ],
      },
      {
        kind: 'points',
        title: '2. Une saisie est enregistrée quand l’écran le dit',
        items: [
          'Fiez-vous aux messages comme « Enregistré sur le serveur » : ils n’apparaissent qu’après la réponse du serveur.',
          'Sans réseau, rien n’est enregistré, mais vos saisies restent à l’écran. Reprenez quand l’en-tête redit « En ligne ».',
          'Après « L’enregistrement n’est pas confirmé », cliquez sur « Réessayer » : la saisie repart sans doublon.',
        ],
      },
      {
        kind: 'points',
        title: '3. Une facture émise ne se modifie plus',
        items: [
          'Un brouillon se modifie, ou s’abandonne avec « Abandonner le brouillon » : il n’a ni numéro ni effet financier.',
          'L’émission est définitive : « La facture émise ne pourra plus être modifiée. » Le serveur attribue le numéro.',
          'Un reçu garde son numéro pour toujours.',
        ],
      },
      {
        kind: 'points',
        title: '4. Les corrections laissent une trace',
        items: [
          'Une erreur d’encaissement se corrige par une contre-écriture, une réduction de la vente par un avoir, l’argent rendu au patient par un remboursement.',
          'L’encaissement, son reçu et la facture restent tels qu’émis : la correction s’ajoute à côté, avec son motif.',
          'Chaque compte est personnel : l’application garde qui a fait quoi, et quand.',
        ],
      },
      {
        kind: 'points',
        title: '5. Certaines actions demandent votre mot de passe',
        items: [
          'Compte, paramètres du cabinet, règle fiscale, stock initial, correction d’une pièce, fusion de deux fiches, export : l’écran ouvre « Confirmer votre mot de passe ».',
          'Saisissez-le, puis cliquez sur « Confirmer et reprendre » : vos saisies sont conservées et l’opération reprend sans doublon. Une fois confirmé, il n’est pas redemandé pendant quelques minutes.',
        ],
      },
      {
        kind: 'points',
        title: '6. DOCUMENT DE TEST tant que les mentions ne sont pas validées',
        items: [
          'Tant que le cabinet n’a pas validé ses mentions officielles, chaque PDF porte « DOCUMENT DE TEST ». Les numéros de facture et de reçu peuvent aussi commencer par TEST tant que les séries du cabinet ne sont pas choisies.',
          'Un document de test n’a aucune valeur comptable, fiscale, médicale ni légale : ne le remettez pas comme pièce officielle.',
          'La gérante saisit l’identité du cabinet dans « Cabinet et documents ». Le passage aux documents officiels se fait à la mise en service, pas depuis cet écran.',
        ],
      },
      {
        kind: 'points',
        title: '7. La gérante autorise ce qui sort de l’ordinaire',
        items: [
          'Remise commerciale, prix libre, dispense des frais d’examen, correction : si votre profil ne le permet pas, l’écran propose « Demander une autorisation » ou « Demander l’autorisation ».',
          'La gérante décide dans « Approbations » avec « Accorder » ou « Refuser », après avoir confirmé son mot de passe.',
          'Une approbation vaut pour une seule opération précise, une seule fois, avant son échéance. Si le contenu change, il faut une nouvelle demande. Après l’accord, renvoyez exactement la même opération.',
        ],
      },
    ],
    related: [
      { topic: 'notion-facture', label: 'La facture, de l’émission aux corrections' },
      { topic: 'notion-securite', label: 'Sécurité et confidentialité' },
      { topic: 'notion-documents', label: 'Les documents PDF et leurs mentions' },
      { topic: 'notion-approbations', label: 'Les approbations de la gérante' },
      { topic: 'parcours-correction', label: 'Parcours : corriger une erreur' },
      { topic: 'depannage-messages', label: 'Comprendre les messages de l’application' },
    ],
    keywords: [
      'règles',
      'principes',
      'définitif',
      'correction',
      'trace',
      'historique',
      'journal',
      'document de test',
      'approbation',
      'autorisation',
      'mot de passe',
      'enregistré',
      'facture émise',
    ],
  },
  {
    id: 'journee-type',
    title: 'Une journée type au cabinet',
    summary:
      'De l’ouverture à la clôture : ce que font l’accueil, le professionnel, la caissière et la gérante, avec le parcours à lire pour chaque temps.',
    module: null,
    anyPermission: [],
    intro:
      'Voici une journée ordinaire, dans l’ordre du travail. Chaque temps nomme qui agit, ce qu’il fait et le parcours à lire pour le détail.',
    blocks: [
      {
        kind: 'flow',
        title: 'De l’ouverture à la clôture',
        stages: [
          {
            label: 'Ouverture',
            text: 'Chacun se connecte. La caissière ouvre sa caisse (« Ventes et caisse », « Caisse », « Ouvrir la caisse »). L’accueil lit l’agenda du jour. Parcours : ouvrir et clôturer la caisse.',
          },
          {
            label: 'Accueil des patients',
            text: 'L’accueil retrouve la fiche dans « Patients » ou la crée, puis clique sur « Enregistrer une arrivée » : le patient entre dans la file du jour. Parcours : accueillir un patient ; prendre un rendez-vous.',
          },
          {
            label: 'Examen et ordonnance',
            text: 'Le professionnel clique sur « Démarrer l’examen », remplit les sept étapes puis clique sur « Terminer l’examen ». Il valide la prescription optique et imprime l’ordonnance. Parcours : faire l’examen ; prescrire et imprimer.',
          },
          {
            label: 'Vente et encaissement',
            text: 'La caissière clique sur « Créer une facture » depuis la fiche, ajoute les articles, émet la facture puis encaisse : chaque encaissement a son reçu. Parcours : facturer et encaisser ; établir un devis.',
          },
          {
            label: 'Remise de l’article',
            text: 'Quand la commande est prête, la caissière remet l’article au patient depuis la facture. Parcours : remettre un article.',
          },
          {
            label: 'Suivi et corrections',
            text: 'L’accueil appelle les patients de « Patients à rappeler » et note chaque contact. Une erreur sur une facture se corrige par une demande à la gérante. Parcours : suivre les patients ; corriger une erreur.',
          },
          {
            label: 'Clôture',
            text: 'La caissière compte le tiroir et clique sur « Clôturer la caisse ». La gérante relit « Caisse du jour » et décide les demandes. Chacun clique sur « Se déconnecter ». Parcours : clôturer la caisse ; gérer le cabinet.',
          },
        ],
      },
      {
        kind: 'points',
        title: 'Votre journée selon votre profil',
        items: [
          'L’accueil : le matin, l’agenda et les patients à rappeler ; toute la journée, la recherche de fiches, les arrivées et les rendez-vous. Ni examens ni ventes.',
          'Le professionnel : la file du jour, puis l’examen et ses ordonnances. Il programme les contrôles recommandés. Il ne voit ni la caisse ni les factures.',
          'La caissière : l’ouverture de sa caisse, les factures et les encaissements, la remise des articles, la clôture. Pour une remise commerciale ou une correction, elle demande l’accord de la gérante.',
          'La gérante : elle peut tout faire, mais son rôle propre est de décider les demandes, relire la caisse du jour et les statistiques, et tenir à jour le personnel, le catalogue et le stock.',
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Ce déroulé est un modèle, pas une obligation : un même compte peut cumuler plusieurs profils, par exemple « Accueil » et « Caisse », et faire alors les deux journées.',
      },
    ],
    related: [
      { topic: 'parcours-accueillir', label: 'Parcours : accueillir un patient' },
      { topic: 'parcours-examen', label: 'Parcours : faire l’examen de vue' },
      { topic: 'parcours-vente', label: 'Parcours : facturer et encaisser' },
      { topic: 'parcours-remise-article', label: 'Parcours : remettre un article au patient' },
      { topic: 'parcours-caisse', label: 'Parcours : ouvrir et clôturer la caisse' },
      { topic: 'parcours-gestion', label: 'Parcours : gérer le cabinet' },
    ],
    keywords: [
      'journée',
      'ouverture',
      'clôture',
      'matin',
      'soir',
      'déroulement',
      'routine',
      'organisation',
      'planning',
      'comment se passe une journée',
    ],
  },
]
