import type { PageHelp } from '../model'

/**
 * Aide des écrans de vente (module `sales`) : accueil « Ventes et caisse », liste « Factures »,
 * « Nouvelle facture » (brouillon, remise, émission) et « Aperçu des documents » (PDF de démonstration).
 */
export const PAGES_FACTURES: readonly PageHelp[] = [
  {
    route: 'ventes',
    title: 'Ventes et caisse',
    module: 'sales',
    anyPermission: ['invoice.read', 'payment.collect', 'cash.own_session', 'exam_fee.collect'],
    purpose:
      'Point de départ des ventes : chaque carte ouvre un écran de travail (caisse, factures, devis…). Seules les cartes que votre compte peut utiliser s’affichent. Rien ne s’enregistre ici.',
    actions: [
      {
        label: 'Caisse',
        effect:
          'Ouvre l’écran de la session de caisse : ouverture avec le fond de caisse, clôture avec le montant compté.',
        anyPermission: ['cash.own_session'],
      },
      {
        label: 'Caisse du jour',
        effect:
          'Ouvre le bilan des encaissements du jour par mode : la caissière voit les siens, la gérante ceux de tout le cabinet.',
        anyPermission: ['finance.global.read', 'cash.own_session'],
      },
      {
        label: 'Nouvelle facture',
        effect:
          'Prépare le brouillon d’une facture pour un patient, que vous pourrez ensuite émettre.',
        anyPermission: ['invoice.create', 'exam_fee.collect'],
      },
      {
        label: 'Factures',
        effect:
          'Liste les brouillons et les factures émises ; une facture s’y ouvre pour être poursuivie, encaissée ou imprimée.',
        anyPermission: ['invoice.read'],
      },
      {
        label: 'Devis',
        effect:
          'Ouvre les devis : des propositions remises au client, qui ne sont ni une facture ni un encaissement.',
        anyPermission: ['invoice.read'],
      },
      {
        label: 'Catalogue',
        effect: 'Ouvre les articles, les prestations et leurs prix de vente. Réservé à la gérante.',
        anyPermission: ['catalog.manage'],
      },
      {
        label: 'Règles fiscales',
        effect:
          'Ouvre les taux de taxe saisis et validés par la gérante. Aucune taxe n’est préconfigurée.',
        anyPermission: ['catalog.manage'],
      },
      {
        label: 'Stock',
        effect:
          'Ouvre les disponibilités et le stock initial. Cette carte n’apparaît que si le module stock est ouvert.',
        anyPermission: ['stock.read'],
      },
    ],
    tasks: [
      {
        id: 'ouvrir-la-caisse',
        title: 'Ouvrir la caisse en début de journée',
        anyPermission: ['cash.own_session'],
        steps: [
          'Cliquez sur la carte « Caisse ».',
          'Si l’écran indique « Aucune session de caisse ouverte », saisissez le « Fond de caisse » compté dans le tiroir.',
          'Cliquez sur « Ouvrir la caisse ».',
        ],
        result:
          'La session est ouverte : les encaissements en espèces de la journée s’y inscrivent. Mobile money et virements n’en ont pas besoin.',
      },
      {
        id: 'facturer-un-patient',
        title: 'Facturer un patient',
        anyPermission: ['invoice.create', 'exam_fee.collect'],
        steps: [
          'Le plus simple : ouvrez la fiche du patient et cliquez sur « Créer une facture ». Le patient est alors déjà choisi.',
          'Sinon, cliquez sur la carte « Nouvelle facture » et cherchez le patient dans « Patient ».',
          'Suivez ensuite l’aide de l’écran « Nouvelle facture » : lignes, enregistrement du brouillon, puis émission.',
        ],
        result: 'La facture émise porte son numéro définitif et attend son encaissement.',
      },
      {
        id: 'retrouver-une-facture',
        title: 'Retrouver une facture',
        anyPermission: ['invoice.read'],
        steps: [
          'Cliquez sur la carte « Factures ».',
          'Au besoin, filtrez la liste par « État » ou par « Jour d’émission ».',
          'Cliquez sur le numéro de la facture pour l’ouvrir.',
        ],
        result:
          'La facture s’ouvre : selon vos droits, vous la lisez, enregistrez un encaissement ou imprimez ses PDF.',
      },
    ],
    rules: [
      'Cet écran ne fait que mener ailleurs : il n’enregistre rien et n’affiche aucun montant.',
      'Chaque carte n’apparaît que si votre compte a le droit correspondant. « Catalogue » et « Règles fiscales » sont réservés à la gérante.',
      'Par défaut, l’accueil et le professionnel ne facturent ni n’encaissent : ils ne voient pas « Ventes et caisse » dans le menu. La gérante peut accorder un droit à un compte.',
      'La carte « Stock » n’apparaît que si le cabinet a ouvert le module stock et si votre compte peut lire le stock.',
      'Ces écrans travaillent avec le serveur : un enregistrement n’est annoncé qu’après sa confirmation. Le travail sans Internet n’est pas encore disponible.',
    ],
    next: [
      {
        route: 'factures',
        label: 'Factures',
        why: 'Pour retrouver un brouillon, une facture émise ou son reste à encaisser.',
      },
      {
        route: 'facture-nouvelle',
        label: 'Nouvelle facture',
        why: 'Pour facturer un patient.',
      },
      {
        route: 'caisse',
        label: 'Caisse',
        why: 'Pour ouvrir la session avant un encaissement en espèces.',
      },
      {
        topic: 'parcours-vente',
        label: 'Facturer et encaisser, de bout en bout',
      },
    ],
    tips: [
      'Pour gagner du temps, facturez depuis la fiche du patient ou depuis la file du jour avec « Créer une facture » : le patient est déjà choisi.',
    ],
    problems: [
      {
        symptom: '« Aucun écran de vente n’est ouvert à ce compte. »',
        remedy:
          'Votre compte n’a aucun des droits de vente. Demandez à la gérante de vérifier votre profil.',
      },
      {
        symptom: 'Une carte attendue manque, par exemple « Catalogue » ou « Stock »',
        remedy:
          'C’est normal si votre profil n’y a pas droit ou si le cabinet n’a pas encore ouvert le module concerné. Voyez la gérante.',
      },
      {
        symptom: '« Ce compte n’a pas le droit d’ouvrir cette page »',
        remedy:
          'Votre compte n’a aucun droit sur cet écran. Demandez à la gérante de l’attribuer si cette tâche fait partie de votre travail.',
      },
    ],
    terms: ['Session de caisse', 'Catalogue', 'Règle fiscale', 'Devis', 'Module'],
  },
  {
    route: 'factures',
    title: 'Factures',
    module: 'sales',
    anyPermission: ['invoice.read'],
    purpose:
      'Retrouvez ici les brouillons et les factures émises, avec leur reste à encaisser. Filtrez par état ou par jour d’émission, puis ouvrez une facture pour la poursuivre.',
    actions: [
      {
        label: 'Nouvelle facture',
        effect: 'Ouvre l’écran de création d’une facture, où vous choisissez le patient.',
        anyPermission: ['invoice.create', 'exam_fee.collect'],
      },
      {
        label: 'État',
        effect:
          'Ne garde que les brouillons, les factures émises ou les brouillons abandonnés. « Tous les états » retire le filtre.',
      },
      {
        label: 'Jour d’émission',
        effect: 'Ne garde que les factures émises ce jour-là, d’après le jour du cabinet.',
      },
      {
        label: 'Page précédente',
        effect:
          'Revient à la page précédente de la liste (visible seulement quand la liste compte plusieurs pages).',
      },
      {
        label: 'Page suivante',
        effect:
          'Passe à la page suivante de la liste (visible seulement quand la liste compte plusieurs pages).',
      },
      {
        label: 'Brouillon sans numéro',
        effect:
          'Titre d’un brouillon dans la liste : cliquez dessus pour le rouvrir, le compléter, l’émettre ou l’abandonner.',
      },
      {
        label: 'Réessayer',
        effect: 'Relit la liste quand le serveur n’a pas répondu.',
      },
    ],
    tasks: [
      {
        id: 'retrouver-une-facture-emise',
        title: 'Retrouver une facture émise un jour donné',
        steps: [
          'Saisissez la date dans « Jour d’émission », par exemple 15/10/2026 ou 15102026.',
          'Quittez le champ ou appuyez sur Entrée : la liste ne garde que les factures émises ce jour-là.',
          'Lisez chaque carte : numéro, état, patient et dossier, date d’émission, total et reste à encaisser.',
          'Cliquez sur le numéro de la facture cherchée.',
        ],
        result: 'La facture s’ouvre sur son propre écran.',
      },
      {
        id: 'reprendre-un-brouillon',
        title: 'Reprendre un brouillon',
        steps: [
          'Choisissez « Brouillons » dans « État ».',
          'Repérez le bon brouillon grâce au nom du patient et au numéro de dossier écrits sur la carte : tous s’appellent « Brouillon sans numéro ».',
          'Cliquez sur « Brouillon sans numéro » pour l’ouvrir.',
          'Complétez les lignes, puis cliquez sur « Enregistrer le brouillon ».',
          'Cliquez sur « Émettre la facture », ou sur « Abandonner le brouillon » si la vente n’a pas lieu.',
        ],
        result:
          'Le brouillon devient une facture émise avec son numéro, ou un brouillon abandonné qui reste dans la liste.',
      },
      {
        id: 'reperer-un-reste-a-encaisser',
        title: 'Repérer les factures qui ont encore un reste à encaisser',
        steps: [
          'Choisissez « Émises » dans « État » : le reste à encaisser n’est montré que pour les factures émises.',
          'Parcourez les cartes : « reste à encaisser » donne le montant encore attendu, 0 FCFA quand il ne reste rien.',
          'Cliquez sur « Page suivante » pour voir la suite de la liste.',
          'Cliquez sur le numéro de la facture concernée pour enregistrer un encaissement.',
        ],
        result: 'Vous savez quelles factures attendent encore un encaissement.',
      },
    ],
    rules: [
      'Les filtres sont appliqués par le serveur sur toutes les pages de la liste, pas seulement sur la page affichée.',
      '« Jour d’émission » compte le jour du cabinet et ne retient que les factures émises : un brouillon n’a pas de jour d’émission.',
      'Le reste à encaisser n’est montré que pour une facture émise. Un brouillon n’a ni numéro ni reste à encaisser.',
      'Un brouillon abandonné reste dans la liste, avec l’état « Abandonnée » : il n’a ni numéro ni effet financier.',
      'Une liste qui n’a pas pu être lue est annoncée comme telle (« Serveur indisponible »). L’écran ne dit « Aucune facture » que si le serveur a répondu.',
      'La liste se lit sur le serveur, donc avec une connexion Internet. Le travail sans Internet n’est pas encore disponible.',
    ],
    next: [
      {
        route: 'facture-nouvelle',
        label: 'Nouvelle facture',
        why: 'Quand il faut facturer un patient.',
      },
      {
        route: 'caisse-du-jour',
        label: 'Caisse du jour',
        why: 'Pour voir les encaissements du jour par mode.',
      },
      {
        topic: 'parcours-vente',
        label: 'Facturer et encaisser, de bout en bout',
      },
      {
        topic: 'notion-facture',
        label: 'Comprendre la facture, le brouillon et l’émission',
      },
    ],
    tips: [
      'Pour une facture d’un autre jour, saisissez d’abord la date : la liste entière est filtrée, même si elle compte plusieurs pages.',
      'Les montants sont toujours en FCFA entiers, par exemple 80 000 FCFA.',
      'Tant que les séries de numéros ne sont pas choisies avec le cabinet, les numéros commencent par TEST, par exemple TEST-FAC-2026-000001.',
      'Sous la liste, l’écran indique l’heure des données lues sur le serveur.',
    ],
    problems: [
      {
        symptom: '« Aucune facture »',
        remedy:
          'Le serveur n’a aucune facture pour ces critères. Choisissez « Tous les états » dans « État » et videz « Jour d’émission » pour élargir la recherche.',
      },
      {
        symptom: '« Serveur indisponible »',
        remedy:
          'Le serveur n’a pas répondu, donc rien n’est conclu. Vérifiez la connexion Internet, puis cliquez sur « Réessayer ».',
      },
      {
        symptom: '« Droits insuffisants »',
        remedy: 'Votre compte ne peut pas consulter les factures. Voyez la gérante.',
      },
      {
        symptom: '« Session expirée »',
        remedy: 'Cliquez sur « Se reconnecter » dans l’en-tête, puis sur « Réessayer ».',
      },
      {
        symptom: 'Un message rouge sous « Jour d’émission »',
        remedy:
          'La date est incomplète ou n’existe pas. Écrivez-la au format JJ/MM/AAAA ou en 8 chiffres : tant qu’elle est refusée, aucun filtre de jour n’est appliqué.',
      },
    ],
    terms: ['Brouillon', 'Facture émise', 'Reste à encaisser', 'Reçu'],
  },
  {
    route: 'facture-nouvelle',
    title: 'Nouvelle facture',
    module: 'sales',
    anyPermission: ['invoice.create', 'exam_fee.collect'],
    purpose:
      'Préparez la facture d’un patient : choisissez le patient, ajoutez des articles du catalogue, indiquez les quantités et la remise, puis enregistrez le brouillon et émettez-le. L’identité vient de la fiche, jamais ressaisie.',
    actions: [
      {
        label: 'Patient',
        effect:
          'Cherche le patient par nom, téléphone ou numéro de dossier (2 caractères au moins). Le champ disparaît quand le patient est déjà choisi.',
      },
      {
        label: 'Ajouter un article du catalogue',
        effect:
          'Cherche un article par référence, nom, marque ou modèle ; Entrée l’ajoute en nouvelle ligne, quantité 1, au prix du catalogue.',
      },
      {
        label: 'Ajouter une ligne hors catalogue',
        effect:
          'Ajoute une ligne libre dont vous saisissez la désignation et le prix. Réservé à la gérante.',
        anyPermission: ['catalog.manage'],
      },
      {
        label: 'Retirer la ligne',
        effect:
          'Enlève la ligne de l’écran ; le brouillon enregistré ne change qu’au prochain enregistrement.',
      },
      {
        label: 'Enregistrer le brouillon',
        effect:
          'Contrôle les lignes puis enregistre le brouillon sur le serveur, sans numéro définitif. Un nouveau brouillon ouvre ensuite l’écran de la facture.',
      },
      {
        label: 'Demander une autorisation',
        effect:
          'Apparaît quand un prix ou une remise dépasse vos droits : envoie à la gérante une demande pour exactement ces lignes.',
        anyPermission: ['approval.request'],
      },
      {
        label: 'Émettre la facture',
        effect:
          'Sur l’écran du brouillon enregistré, après confirmation : fige la facture, lui donne son numéro et réserve le stock des articles gérés en stock.',
        anyPermission: ['invoice.issue', 'exam_fee.collect'],
      },
      {
        label: 'Abandonner le brouillon',
        effect:
          'Sur l’écran du brouillon enregistré : le ferme après confirmation, sans numéro ni effet financier. Réservé à son auteur et à la gérante.',
        anyPermission: ['invoice.create', 'exam_fee.collect'],
      },
      {
        label: 'Retour aux factures',
        effect:
          'Revient à la liste des factures. Le navigateur demande confirmation si des lignes ne sont pas enregistrées.',
      },
    ],
    tasks: [
      {
        id: 'creer-le-brouillon',
        title: 'Créer le brouillon d’une facture',
        steps: [
          'Ouvrez l’écran avec « Créer une facture » depuis la fiche du patient ou la file du jour : le patient est alors déjà choisi.',
          'Sinon, tapez son nom, son téléphone ou son numéro de dossier dans « Patient », puis cliquez sur son nom dans la liste.',
          'Vérifiez l’identité affichée en haut : nom, numéro de dossier, sexe et âge. Elle vient de la fiche du patient.',
          'Dans « Ajouter un article du catalogue », tapez 2 caractères au moins, parcourez la liste avec les flèches et appuyez sur Entrée.',
          'Sur chaque ligne, changez « Quantité » si besoin. « Prix unitaire TTC » est celui du catalogue ; seule la gérante peut le modifier.',
          'Laissez « Remise TTC » vide s’il n’y a pas de remise. Sinon, respectez la limite écrite sous le champ.',
          'Ajoutez les autres articles de la même façon. « Retirer la ligne » enlève une ligne ajoutée par erreur.',
          'Lisez « Total TTC » en bas de la liste, puis cliquez sur « Enregistrer le brouillon ».',
        ],
        result:
          'L’écran de la facture s’ouvre avec le message « Brouillon de facture enregistré sur le serveur. » La facture n’a pas encore de numéro.',
      },
      {
        id: 'demander-une-autorisation',
        title: 'Demander l’autorisation d’une remise ou d’un prix',
        anyPermission: ['approval.request'],
        steps: [
          'Saisissez la remise en FCFA dans « Remise TTC », puis cliquez sur « Enregistrer le brouillon ».',
          'Si elle dépasse la limite de votre compte, l’écran affiche « Prix ou remise au-delà de vos droits » et n’enregistre pas le brouillon.',
          'Cliquez sur « Demander une autorisation » et écrivez le « Motif de la demande » (3 caractères au moins).',
          'Cliquez sur « Envoyer la demande à la gérante », puis gardez l’écran ouvert : la demande est liée à ce brouillon précis.',
          'La gérante accorde ou refuse la demande dans l’écran « Approbations » (« Paramètres », puis « Autorisations »). Vous ne décidez pas à sa place.',
          'Quand la gérante a accordé la demande, cliquez de nouveau sur « Enregistrer le brouillon » sans modifier aucune ligne.',
          'Si « Prix ou remise au-delà de vos droits » revient, la gérante n’a pas encore décidé, a refusé, ou l’accord a expiré.',
        ],
        result:
          'Le brouillon s’enregistre avec la remise accordée. L’accord ne sert qu’une fois, pour ces lignes exactes et pendant une durée limitée.',
      },
      {
        id: 'emettre-la-facture',
        title: 'Émettre la facture',
        anyPermission: ['invoice.issue', 'exam_fee.collect'],
        steps: [
          'Après « Enregistrer le brouillon », l’écran de la facture s’ouvre sur le brouillon. Relisez les lignes et « Total TTC ».',
          'Si vous modifiez une ligne, cliquez d’abord sur « Enregistrer le brouillon » : « Émettre la facture » reste inactif tant que des changements ne sont pas enregistrés.',
          'Cliquez sur « Émettre la facture ». Si le bouton reste inactif, la raison est écrite juste dessous.',
          'Dans la fenêtre « Émettre la facture ? », relisez le total puis cliquez sur « Émettre la facture » pour confirmer, ou sur « Annuler ».',
          'Attendez la réponse du serveur sans fermer l’écran : le numéro définitif de la facture s’affiche alors en titre.',
        ],
        result:
          'La facture est émise et ne se modifie plus. Son reste à encaisser s’affiche : elle est prête à être encaissée.',
      },
    ],
    rules: [
      'Le patient est repris de sa fiche : son identité n’est jamais ressaisie et la facture ne porte que son dossier. Une fiche archivée ou fusionnée ne reçoit plus de facture.',
      'Cet écran travaille avec le serveur : le travail sans Internet n’est pas encore disponible. Rien n’est enregistré avant « Enregistrer le brouillon ».',
      'Chaque ligne vaut quantité × prix moins remise, arrondie au FCFA ; le total est la somme des lignes, toutes taxes comprises. Le serveur recalcule ce total et refuse l’émission s’il trouve un écart.',
      'Le prix du catalogue s’impose, sauf à la gérante, qui peut aussi ajouter une ligne hors catalogue. Les autres comptes ont une remise limitée, écrite sous « Remise TTC » (aucune par défaut).',
      'Un brouillon n’a pas de numéro et ne touche ni au stock ni à la caisse. Le numéro n’est attribué qu’à l’émission : abandonner un brouillon ne consomme donc aucun numéro.',
      'Une facture émise ne se modifie plus : numéro, lignes, prix et nom du patient sont figés, même si le catalogue ou la fiche changent ensuite. Une erreur se corrige par un avoir.',
    ],
    next: [
      {
        topic: 'parcours-vente',
        label: 'Facturer et encaisser, de bout en bout',
      },
      {
        route: 'factures',
        label: 'Factures',
        why: 'Pour retrouver un brouillon enregistré ou une facture émise.',
      },
      {
        route: 'caisse',
        label: 'Caisse',
        why: 'Pour ouvrir la session avant un encaissement en espèces.',
      },
      {
        topic: 'notion-approbations',
        label: 'Comprendre les autorisations de la gérante',
      },
    ],
    tips: [
      'Depuis la file du jour, « Créer une facture » rattache la facture à la visite choisie. Depuis la fiche du patient, elle n’est liée à aucune visite.',
      'Une fois le patient choisi, il ne se change plus ici. En cas d’erreur, cliquez sur « Retour aux factures », puis sur « Nouvelle facture », et recommencez.',
      'Quand le module stock est ouvert, l’écran lit sous chaque article géré en stock la disponibilité sur le serveur. C’est une information : la réserve n’est prise qu’à l’émission.',
      'Tant que les séries de numéros ne sont pas choisies avec le cabinet, les numéros commencent par TEST, par exemple TEST-FAC-2026-000001.',
      'Un compte limité aux frais d’examen ne facture que l’article désigné pour ces frais ; le serveur refuse tout autre article.',
    ],
    problems: [
      {
        symptom:
          '« Recherche serveur indisponible : cela ne prouve pas que le patient n’existe pas. »',
        remedy:
          'Ne concluez rien. Vérifiez la connexion, retapez la recherche, ou partez de la fiche du patient avec « Créer une facture ».',
      },
      {
        symptom: '« Certaines informations sont à corriger »',
        remedy:
          'Les erreurs de ligne commencent par le numéro de la ligne : cliquez sur le message pour aller au champ. Un montant s’écrit en FCFA entiers (80 000) ; une quantité à l’unité ou à la paire est entière. Rien n’est enregistré tant que la liste n’est pas vide.',
      },
      {
        symptom: '« Prix ou remise au-delà de vos droits »',
        remedy:
          'Le brouillon n’est pas enregistré. Cliquez sur « Demander une autorisation », ou ramenez la remise dans la limite écrite sous « Remise TTC ».',
      },
      {
        symptom: '« Enregistrement non confirmé »',
        remedy:
          'La réponse du serveur n’est pas arrivée : l’enregistrement a peut-être eu lieu. Cliquez sur « Réessayer l’enregistrement » sans fermer l’écran : la reprise ne crée pas de doublon.',
      },
      {
        symptom: '« Stock insuffisant »',
        remedy:
          'À l’émission, le serveur refuse une ligne dont la quantité dépasse le stock disponible, et la facture reste un brouillon. Baissez la quantité ou voyez la gérante pour le stock.',
      },
    ],
    terms: [
      'Brouillon',
      'Facture émise',
      'Remise commerciale',
      'Approbation',
      'Catalogue',
      'Stock réservé',
    ],
  },
  {
    route: 'documents-apercu',
    title: 'Aperçu des documents',
    module: 'sales',
    anyPermission: [
      'invoice.read',
      'invoice.create',
      'invoice.issue',
      'payment.collect',
      'cash.own_session',
      'credit_note.issue',
      'refund.execute',
      'finance.global.read',
      'cash.manage',
      'clinical.read',
      'clinical.export',
    ],
    purpose:
      'Contrôlez ici l’aspect des documents PDF (factures, reçus, ordonnances…) sur des données fictives. Rien n’est enregistré ni envoyé. Tant que les mentions officielles du cabinet ne sont pas validées, chaque document porte « DOCUMENT DE TEST ».',
    actions: [
      {
        label: 'Document à afficher',
        effect:
          'Choisit le document à générer. La liste ne propose que les documents que votre compte a le droit d’ouvrir.',
      },
      {
        label: 'Ouvrir le PDF',
        effect: 'Ouvre le PDF dans un nouvel onglet du navigateur.',
      },
      {
        label: 'Imprimer',
        effect:
          'Ouvre le PDF dans la visionneuse du navigateur : lancez l’impression avec Ctrl+P. Rien ne s’imprime tout seul.',
      },
      {
        label: 'Télécharger le PDF',
        effect:
          'Télécharge le PDF sur l’ordinateur, sous un nom qui ne contient aucun nom de patient.',
      },
    ],
    tasks: [
      {
        id: 'controler-un-document',
        title: 'Contrôler l’aspect d’un document',
        steps: [
          'Dans « Document à afficher », choisissez par exemple « Facture courte (80 000 FCFA) » ou « Reçu d’acompte (30 000 FCFA) ».',
          'Patientez pendant « Génération du PDF… » : le document s’affiche ensuite page par page.',
          'Repérez le bandeau « DOCUMENT DE TEST » et le filigrane « DONNÉES DE TEST » : ils signalent un document sans valeur officielle.',
          'Vérifiez l’en-tête, les lignes, les montants et le pied de page.',
          'Lisez les « Points à vérifier avant d’imprimer » s’ils apparaissent : chaque ligne signale une anomalie du document.',
        ],
        result:
          'Vous savez si la mise en page convient avant de remettre de vrais documents à des patients.',
      },
      {
        id: 'essayer-l-impression',
        title: 'Essayer l’impression sur le papier du cabinet',
        steps: [
          'Choisissez le document, par exemple « Reçu d’acompte (30 000 FCFA) » pour l’A4 ou « Reçu d’acompte, ticket 80 mm » pour le ticket.',
          'Cliquez sur « Imprimer » : le PDF s’ouvre dans la visionneuse du navigateur.',
          'Dans la visionneuse, lancez l’impression avec Ctrl+P et choisissez l’imprimante du cabinet.',
          'Contrôlez le papier : accents, montants alignés, texte non coupé, marges.',
          'Si l’écran affiche « Le navigateur a bloqué l’ouverture : le PDF a été téléchargé », ouvrez le fichier téléchargé et imprimez-le de là.',
        ],
        result:
          'Vous savez si le document tient correctement sur le papier du cabinet avant d’en remettre un vrai à un patient.',
      },
    ],
    rules: [
      'Les données sont fictives (patient, montants, numéros). Cet écran n’enregistre rien, n’envoie rien et ne conserve aucun document.',
      'Le PDF est fabriqué sur cet appareil, sans passer par le serveur. L’aperçu suit la même mise en page que le PDF, mais les polices peuvent différer légèrement.',
      'Tant que les mentions officielles ne sont pas validées à la mise en service, tout document porte « DOCUMENT DE TEST ». Les informations non saisies restent marquées « à renseigner ».',
      'Chaque type de document n’est proposé qu’aux comptes qui y ont droit : la caissière voit les pièces de vente, le professionnel les documents cliniques, la gérante tous. L’accueil n’a pas cet écran.',
      'Les vrais documents s’ouvrent depuis leurs écrans : la facture et ses reçus depuis la facture, les prescriptions et ordonnances depuis un examen terminé.',
    ],
    next: [
      {
        route: 'factures',
        label: 'Factures',
        why: 'Les vrais PDF de facture et de reçu s’ouvrent depuis la fiche d’une facture.',
      },
      {
        route: 'consultations',
        label: 'Consultations',
        why: 'Les prescriptions et ordonnances s’impriment depuis un examen terminé.',
      },
      {
        route: 'parametres-cabinet',
        label: 'Cabinet et documents',
        why: 'La gérante y saisit l’adresse, les contacts et les mentions imprimées.',
      },
      {
        topic: 'notion-documents',
        label: 'Comprendre les documents et l’impression',
      },
    ],
    tips: [
      'Dans cette version, l’écran n’a pas d’entrée de menu : on l’ouvre en tapant son adresse, /documents/apercu.',
      'Choisir un autre document remplace l’aperçu ; le document précédent n’est pas conservé.',
      'Un lecteur d’écran peut lire chaque page en texte : sous la page, ouvrez « Lire le contenu de la page » suivi de son numéro.',
      'Le premier PDF peut mettre un moment à apparaître : l’outil qui fabrique les PDF se charge à la première demande.',
      'L’activation des documents officiels se décide à la mise en service : elle ne se fait ni depuis cet écran ni depuis « Cabinet et documents ».',
    ],
    problems: [
      {
        symptom: '« Aucun document de démonstration n’est accessible avec ces droits »',
        remedy:
          'Votre compte ne peut ouvrir aucun modèle. Un reçu ou une facture demande un droit de caisse, une prescription le droit clinique : voyez la gérante.',
      },
      {
        symptom: '« Le document n’a pas pu être généré »',
        remedy:
          'Lisez la ligne sous le titre, puis rechargez l’écran et choisissez de nouveau le document. Si le message revient, notez le document choisi et prévenez la gérante.',
      },
      {
        symptom: '« Le navigateur a bloqué l’ouverture : le PDF a été téléchargé »',
        remedy:
          'Le document n’est pas perdu. Autorisez les nouveaux onglets pour ce site, ou ouvrez le fichier téléchargé depuis le dossier des téléchargements.',
      },
      {
        symptom: 'Un encadré « Points à vérifier avant d’imprimer »',
        remedy:
          'Chaque ligne signale une anomalie, par exemple un caractère remplacé parce que le PDF ne sait pas l’écrire. Ne remettez pas le document avant de l’avoir comprise.',
      },
      {
        symptom: 'L’écran reste sur « Choisissez un document pour l’afficher »',
        remedy:
          'Aucun document n’est choisi : ouvrez « Document à afficher » et sélectionnez-en un.',
      },
    ],
    terms: ['Brouillon', 'Facture émise', 'Reçu', 'Avoir', 'Prescription optique'],
  },
]
