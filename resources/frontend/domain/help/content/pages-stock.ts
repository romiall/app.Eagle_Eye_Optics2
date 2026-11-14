import type { PageHelp } from '../model'

/**
 * Aide des écrans « Stock » et « Casse ou ajustement » (module stock) : disponibilités, stock
 * d’ouverture (à la main ou par fichier CSV), casse et ajustement. Écrans en ligne, hors menu.
 */
export const PAGES_STOCK: readonly PageHelp[] = [
  {
    route: 'stock',
    title: 'Stock',
    module: 'stock',
    anyPermission: ['stock.read'],
    purpose:
      'C’est ici que vous voyez ce qui reste de chaque article, emplacement par emplacement, et ouvrez « Fournisseurs », « Réceptions fournisseur », « Inventaires » ou « Alertes et seuils ». La gérante y saisit aussi le stock d’ouverture.',
    actions: [
      {
        label: 'Alertes et seuils',
        effect: 'Ouvre les alertes de stock bas et de lots proches de la péremption ou expirés.',
      },
      {
        label: 'Casse ou ajustement',
        effect:
          'Ouvre l’écran où la gérante enregistre un article cassé ou perdu, ou un écart constaté au comptage.',
        anyPermission: ['stock.adjust'],
      },
      {
        label: 'Page suivante',
        effect:
          'Affiche la suite de la liste quand elle compte plusieurs pages ; « Page précédente » revient en arrière.',
      },
      {
        label: 'Réessayer',
        effect:
          'Relit le stock quand le serveur n’a pas répondu. Une liste non lue n’est jamais un stock à zéro.',
      },
      {
        label: 'Ajouter une ligne',
        effect:
          'Ajoute au comptage une ligne vide : un article, un emplacement, une quantité comptée.',
        anyPermission: ['stock.adjust'],
      },
      {
        label: 'Retirer la ligne',
        effect: 'Enlève cette ligne du comptage en cours ; rien n’est encore enregistré.',
        anyPermission: ['stock.adjust'],
      },
      {
        label: 'Télécharger le modèle de stock initial',
        effect:
          'Télécharge un fichier modèle (modele-stock-initial.csv) à remplir dans un tableur, une ligne par article.',
        anyPermission: ['stock.adjust'],
      },
      {
        label: 'Remplir depuis un fichier CSV (facultatif)',
        effect:
          'Lit le fichier choisi et remplace les lignes du formulaire par les siennes. Rien n’est enregistré avant « Enregistrer le stock initial ».',
        anyPermission: ['stock.adjust'],
      },
      {
        label: 'Enregistrer le stock initial',
        effect:
          'Contrôle toutes les lignes puis les enregistre ensemble sur le serveur, avec le motif du comptage.',
        anyPermission: ['stock.adjust'],
      },
      {
        label: 'Confirmer et reprendre',
        effect:
          'Dans la boîte « Confirmer votre mot de passe », valide votre mot de passe puis reprend l’enregistrement, sans doublon.',
        anyPermission: ['stock.adjust'],
      },
    ],
    tasks: [
      {
        id: 'lire-les-disponibilites',
        title: 'Lire ce qui reste d’un article',
        steps: [
          'Ouvrez « Ventes et caisse », puis cliquez sur « Stock ».',
          'Repérez le bloc de l’article : nom, référence et emplacement. Un article sans bloc n’a pas encore de stock enregistré.',
          'Lisez « Physique », « Réservé », « Quotas des postes » et « Disponible ». Le « Disponible » est la quantité que vous pouvez encore vendre.',
          'Pour un article suivi par lots, chaque lot a sa ligne : numéro, date d’expiration, quantité « en stock » et parfois « en quarantaine (jamais réservé) ».',
          'S’il y a plusieurs pages, cliquez sur « Page suivante ». La mention « Données du serveur au » donne la date et l’heure de la lecture.',
        ],
        result:
          'Vous savez, article par article, combien d’unités sont en stock, combien sont réservées et combien restent à vendre.',
      },
      {
        id: 'saisir-le-stock-d-ouverture',
        title: 'Saisir le stock d’ouverture ligne par ligne',
        anyPermission: ['stock.adjust'],
        steps: [
          'Au catalogue, vérifiez que l’article est actif et que son « Mode de stock » est « Article géré en stock ». Sinon, cet écran ne le propose pas.',
          'Dans « Stock initial », cliquez sur « Ajouter une ligne » : il faut une ligne par article et par emplacement.',
          'Choisissez l’article dans « Article géré en stock » et son rangement dans « Emplacement ». Si le cabinet n’a qu’un emplacement, il est déjà choisi.',
          'Saisissez la « Quantité comptée » : un nombre entier pour un article vendu à l’unité, comme une monture.',
          'Pour un article périssable, comme un collyre, remplissez aussi « Numéro de lot » et « Date d’expiration » (JJ/MM/AAAA) : l’écran refuse la ligne sans eux.',
          'Laissez « Coût d’achat unitaire (facultatif) » vide si vous ne le connaissez pas : jamais 0. Ce champ n’est visible que de la gérante.',
          'Écrivez le « Motif du comptage », par exemple comptage d’ouverture du cabinet.',
          'Cliquez sur « Enregistrer le stock initial ». Si la boîte « Confirmer votre mot de passe » s’ouvre, saisissez-le et cliquez sur « Confirmer et reprendre ».',
        ],
        result:
          'Le message « Stock initial enregistré sur le serveur » s’affiche et les articles apparaissent dans « Disponibilités ».',
      },
      {
        id: 'remplir-depuis-un-fichier-csv',
        title: 'Remplir le stock d’ouverture depuis un fichier CSV',
        anyPermission: ['stock.adjust'],
        steps: [
          'Vérifiez que les articles sont au catalogue, actifs et gérés en stock : une référence inconnue est refusée.',
          'Cliquez sur « Télécharger le modèle de stock initial » et ouvrez le fichier dans un tableur. Remplacez ses deux lignes d’exemple.',
          'Écrivez une ligne par article. Les colonnes sont reference, quantite, emplacement, lot, peremption et cout_unitaire ; seules reference et quantite sont toujours obligatoires.',
          'Dans la colonne emplacement, écrivez le code ou le nom de l’emplacement. Elle est obligatoire dès que le cabinet a plusieurs emplacements.',
          'Enregistrez le fichier au format CSV, puis choisissez-le dans « Remplir depuis un fichier CSV (facultatif) ».',
          'Si l’écran affiche « Le fichier est à corriger : le formulaire n’a pas été modifié », corrigez chaque ligne indiquée et choisissez de nouveau le fichier.',
          'Sinon, les lignes du fichier remplacent celles du formulaire. Relisez-les, puis écrivez le « Motif du comptage ».',
          'Cliquez sur « Enregistrer le stock initial ». Les quantités et les lots des articles périssables sont contrôlés à ce moment-là.',
        ],
        result:
          'Rien n’est enregistré avant ce dernier clic : le fichier ne fait que remplir le formulaire.',
      },
    ],
    rules: [
      'Le « Disponible » est « Physique » moins « Réservé » moins « Quotas des postes » (travail sans Internet, pas encore disponible). Exemple : 5 en stock, 2 réservés, 3 disponibles.',
      'Émettre une facture réserve les articles gérés en stock sans les sortir : « Physique » ne change pas. Pour une vente, seule la remise au patient fait sortir l’article.',
      'Une facture qui demande plus que le « Disponible » d’un article géré en stock est refusée à l’émission. Le dernier article ne se réserve qu’une seule fois.',
      'Un lot « en quarantaine (jamais réservé) » ne se vend pas, et un lot expiré ne se remet pas. Les lots qui expirent le plus tôt sont servis d’abord.',
      'Le stock initial d’un article dans un emplacement ne s’enregistre qu’une fois. Sans lui, l’émission d’une facture contenant cet article est refusée.',
      'Un avoir ne remet pas d’article en stock. Seul un retour enregistré avec « Remettre en stock vendable », depuis « Remise au patient » sur la facture, le fait.',
    ],
    next: [
      {
        route: 'stock-movement',
        label: 'Casse ou ajustement',
        why: 'Pour sortir un article cassé ou corriger un écart après un comptage.',
      },
      {
        route: 'catalogue',
        label: 'Catalogue',
        why: 'Pour vérifier qu’un article est « Article géré en stock » avant d’en saisir le stock.',
      },
      {
        topic: 'parcours-stock',
        label: 'Suivre le stock, de l’ouverture à la casse',
      },
      {
        topic: 'notion-stock',
        label: 'Comprendre stock disponible, réservé et physique',
      },
    ],
    tips: [
      'La gérante, la caissière et le professionnel lisent cet écran ; l’accueil n’y a pas accès. Seule la gérante saisit le stock initial et enregistre une casse ou un ajustement.',
      'Sous chaque article géré en stock d’un brouillon de facture ou de devis, l’écran affiche « Disponible en stock (lecture du serveur) ». C’est le total de ses emplacements.',
      'Cette version gère les réceptions fournisseur, l’inventaire complet et les alertes de seuil ou de péremption depuis cet écran ; la valeur globale du stock viendra ensuite.',
      'La liste « Article géré en stock » ne reprend que les 100 premiers articles actifs du catalogue. Au-delà, passez par le fichier CSV, qui lit tout le catalogue.',
      'Si vous quittez l’écran avec un comptage non enregistré, le navigateur demande : « Des saisies ne sont pas encore enregistrées. Quitter cet écran sans les enregistrer ? »',
    ],
    problems: [
      {
        symptom: '« Aucun stock enregistré »',
        remedy:
          'Le serveur ne connaît encore le stock d’aucun article : le stock initial n’a pas été saisi. La gérante le saisit plus bas, dans « Stock initial ».',
      },
      {
        symptom: '« Aucun emplacement de stock »',
        remedy:
          'Le cabinet n’a aucun emplacement actif et la saisie est fermée. L’emplacement se crée à la mise en service, pas dans l’application : prévenez la personne qui l’a installée.',
      },
      {
        symptom: '« Serveur indisponible »',
        remedy:
          'Le serveur n’a pas répondu : ce n’est pas un stock à zéro. Vérifiez la connexion puis cliquez sur « Réessayer ».',
      },
      {
        symptom: '« Le fichier est à corriger : le formulaire n’a pas été modifié »',
        remedy:
          'Lisez la liste sous ce titre : chaque ligne donne la ligne du fichier, la colonne et le problème. Le plus fréquent : « Référence absente du catalogue (importez d’abord le catalogue). » Corrigez le fichier puis choisissez-le de nouveau.',
      },
      {
        symptom: '« Enregistrement non confirmé »',
        remedy:
          'Le stock initial a pu être enregistré. Gardez l’écran ouvert et cliquez sur « Réessayer l’enregistrement » : la même saisie est renvoyée sans doublon.',
      },
    ],
    terms: ['Stock physique', 'Stock réservé', 'Stock disponible', 'Lot', 'Collyre'],
  },
  {
    route: 'stock-movement',
    title: 'Casse ou ajustement',
    module: 'stock',
    anyPermission: ['stock.adjust'],
    purpose:
      'Enregistrez un article cassé ou perdu, ou corrigez un écart constaté au comptage. Ouvrez cet écran depuis « Stock ». Il ne sert pas à vendre : la remise au patient se fait depuis la facture, un retour depuis la remise d’origine.',
    actions: [
      {
        label: 'Enregistrer le mouvement',
        effect:
          'Contrôle la saisie puis enregistre la sortie ou l’entrée sur le serveur. Votre mot de passe peut être demandé.',
      },
      {
        label: 'Demander l’autorisation',
        effect:
          'Pour un compte qui ne peut pas autoriser lui-même : ouvre la demande à la gérante, valable pour ce mouvement exact.',
        anyPermission: ['approval.request'],
      },
      {
        label: 'Envoyer la demande à la gérante',
        effect:
          'Dans la boîte de demande, envoie le « Motif de la demande ». Rien n’est accordé avant la décision de la gérante.',
        anyPermission: ['approval.request'],
      },
      {
        label: 'Confirmer et reprendre',
        effect:
          'Dans la boîte « Confirmer votre mot de passe », valide votre mot de passe puis reprend l’enregistrement, sans doublon.',
      },
      {
        label: 'Retour au stock',
        effect: 'Revient à l’écran « Stock » pour relire les disponibilités.',
      },
    ],
    tasks: [
      {
        id: 'enregistrer-une-casse',
        title: 'Enregistrer un article cassé ou perdu',
        steps: [
          'Dans « Article », choisissez l’article cassé ou perdu : seuls les articles gérés en stock sont proposés.',
          'Dans « Emplacement », choisissez où il se trouve. La liste indique le disponible de chacun ; s’il n’y en a qu’un, il est déjà choisi.',
          'Pour un article suivi par lots, comme un collyre, choisissez le « Lot » : sa date d’expiration et sa quantité en stock sont indiquées.',
          'Laissez « Nature » sur « Casse ou perte (sortie du stock) » : une casse retire toujours des articles.',
          'Saisissez la « Quantité » cassée ou perdue. L’aide sous le champ indique le maximum disponible à retirer.',
          'Écrivez le « Motif (obligatoire) », par exemple monture tombée pendant l’essayage. Trois caractères au moins sont exigés.',
          'Cliquez sur « Enregistrer le mouvement ». Si la boîte « Confirmer votre mot de passe » s’ouvre, saisissez-le et cliquez sur « Confirmer et reprendre ».',
        ],
        result:
          'L’écran annonce que la casse est enregistrée sur le serveur, vide la quantité et le motif, et relit le disponible de l’article.',
      },
      {
        id: 'corriger-un-ecart-de-comptage',
        title: 'Corriger un écart constaté au comptage',
        steps: [
          'Choisissez l’article, son emplacement et, pour un article suivi par lots, le lot concerné, comme pour une casse.',
          'Dans « Nature », choisissez « Ajustement après comptage » : le champ « Sens de l’ajustement » apparaît.',
          'Dans « Sens de l’ajustement », choisissez « Sortie (le comptage trouve moins) » ou « Entrée (le comptage trouve plus) ».',
          'Saisissez dans « Quantité » l’écart constaté, pas le total compté : 2 si le comptage trouve 2 articles de moins ou de plus.',
          'Écrivez le « Motif (obligatoire) », par exemple écart d’inventaire du 22/10, puis cliquez sur « Enregistrer le mouvement ».',
        ],
        result:
          'L’écran annonce l’ajustement enregistré sur le serveur. Relisez « Stock » pour vérifier le nouveau « Disponible ».',
      },
      {
        id: 'demander-l-autorisation',
        title: 'Demander l’autorisation de la gérante',
        anyPermission: ['approval.request'],
        steps: [
          'Remplissez le formulaire comme pour une casse. Si votre compte ne peut pas autoriser lui-même, le bouton de validation s’appelle « Demander l’autorisation ».',
          'Cliquez dessus, écrivez le « Motif de la demande » dans la boîte qui s’ouvre, puis cliquez sur « Envoyer la demande à la gérante ».',
          'L’écran affiche « Autorisation demandée ». Restez sur cet écran sans changer la saisie : la demande porte sur ce contenu exact.',
          'Quand la gérante a accordé la demande dans « Approbations », cliquez sur « Enregistrer le mouvement ».',
        ],
        result:
          'Le mouvement est enregistré sur le serveur. Si la demande est refusée ou échue, l’écran le dit : faites une nouvelle demande.',
      },
    ],
    rules: [
      'Deux natures existent. « Casse ou perte (sortie du stock) » retire toujours des articles. « Ajustement après comptage » en retire ou en ajoute, selon le « Sens de l’ajustement ».',
      'Vous ne retirez jamais ce qui est réservé pour une facture émise, ni ce qui est confié à un poste. La quantité ne dépasse pas le disponible indiqué sous le champ.',
      'Un emplacement qui a des lots, comme les collyres, exige le choix du « Lot » : l’ajustement se fait lot par lot.',
      'Le motif est obligatoire, avec trois caractères au moins. Aucun écran ne supprime un mouvement enregistré : une erreur se corrige par un nouvel ajustement, avec son motif.',
      'La gérante enregistre directement. Un autre compte qui a ce droit demande d’abord l’autorisation de la gérante, valable une seule fois pour ce mouvement exact.',
      'C’est une opération sensible : votre mot de passe peut être demandé. L’enregistrement reprend ensuite avec la même saisie, sans créer deux mouvements.',
    ],
    next: [
      {
        route: 'stock',
        label: 'Stock',
        why: 'Pour relire le disponible après le mouvement.',
      },
      {
        route: 'approbations',
        label: 'Approbations',
        why: 'La gérante y décide des demandes d’autorisation.',
      },
      {
        topic: 'parcours-remise-article',
        label: 'Remettre un article au patient, puis enregistrer un retour',
      },
      {
        topic: 'parcours-stock',
        label: 'Suivre le stock, de l’ouverture à la casse',
      },
    ],
    tips: [
      'Pour un ajustement, saisissez l’écart constaté (2 en plus ou 2 en moins), pas le total compté.',
      'Un article rapporté par un patient ne s’enregistre pas ici : utilisez « Enregistrer un retour », dans « Remise au patient » sur la facture.',
      'Après un enregistrement, l’article, l’emplacement et le lot restent choisis : seules la quantité et le motif sont vidés, pour enchaîner un autre mouvement.',
      'Pour une livraison fournisseur ou un comptage complet d’emplacement, passez plutôt par « Réceptions fournisseur » ou « Inventaires » depuis « Stock ».',
      'Par défaut, seule la gérante ouvre cet écran. Elle peut donner ce droit à un autre compte, qui pourra alors seulement demander l’autorisation.',
    ],
    problems: [
      {
        symptom: '« Aucun stock pour cet article »',
        remedy:
          'Cet article n’a encore aucun stock enregistré. Saisissez d’abord son stock initial dans « Stock ».',
      },
      {
        symptom: '« Stock non lu »',
        remedy:
          'Le stock de cet article n’a pas pu être lu. Vérifiez la connexion puis choisissez de nouveau l’article.',
      },
      {
        symptom:
          '« Aucune quantité disponible à retirer : la marchandise réservée pour une vente ou confiée à un poste ne se retire pas. »',
        remedy:
          'Le disponible de cet emplacement ou de ce lot est à zéro. Choisissez un autre emplacement ou un autre lot. Un article réservé pour une facture sort par la remise au patient, pas ici.',
      },
      {
        symptom: '« L’autorisation demandée n’est pas (ou plus) accordée pour ce contenu exact »',
        remedy:
          'Attendez la décision de la gérante dans « Approbations », puis cliquez de nouveau sur « Enregistrer le mouvement ». Si elle a refusé ou si la demande est échue, faites une nouvelle demande.',
      },
      {
        symptom: '« L’enregistrement n’est pas confirmé »',
        remedy:
          'Le mouvement a pu être enregistré. Gardez l’écran ouvert et cliquez de nouveau sur « Enregistrer le mouvement » : la même saisie est renvoyée sans doublon. Le bouton « Réessayer » cité par le message n’existe pas sur cet écran.',
      },
    ],
    terms: ['Stock disponible', 'Lot', 'Approbation', 'Retour'],
  },
  {
    route: 'suppliers',
    title: 'Fournisseurs',
    module: 'stock',
    anyPermission: ['stock.receive'],
    purpose:
      'Enregistrez ici les fournisseurs et laboratoires d’optique auprès desquels le cabinet s’approvisionne avant de saisir une réception.',
    actions: [
      {
        label: 'Modifier',
        effect: 'Charge les coordonnées du fournisseur dans le formulaire pour les mettre à jour.',
      },
      {
        label: 'Désactiver',
        effect: 'Masque un fournisseur des nouvelles réceptions sans effacer son historique.',
      },
      {
        label: 'Réactiver',
        effect: 'Rend de nouveau un fournisseur sélectionnable lors des prochaines réceptions.',
      },
      {
        label: 'Annuler la modification',
        effect: 'Vide le formulaire en cours pour revenir à l’ajout d’un nouveau fournisseur.',
      },
      {
        label: 'Réceptions fournisseur',
        effect: 'Ouvre la liste des réceptions de marchandises enregistrées pour les fournisseurs.',
      },
      {
        label: 'Retour au stock',
        effect: 'Revient à l’écran « Stock ».',
      },
    ],
    tasks: [
      {
        id: 'creer-fournisseur',
        title: 'Ajouter un fournisseur ou un laboratoire',
        steps: [
          'Saisissez « Nom » et « Code du fournisseur » uniques pour le cabinet.',
          'Renseignez si besoin « Téléphone (facultatif) », « Adresse e-mail (facultatif) » et « Adresse (facultatif) ».',
          'Cochez « C’est un laboratoire d’optique » s’il fabrique ou taille les verres.',
          'Validez l’enregistrement pour l’ajouter immédiatement à la liste.',
        ],
        result: 'Le fournisseur apparaît dans la liste et devient disponible pour les réceptions.',
      },
    ],
    rules: [
      'Un fournisseur désactivé reste visible sur les anciennes réceptions mais ne peut plus être choisi sur un nouveau brouillon.',
      'Le code fournisseur est unique dans le cabinet.',
    ],
    next: [
      {
        route: 'goods-receipts',
        label: 'Réceptions fournisseur',
        why: 'Pour enregistrer une livraison reçue de ce fournisseur.',
      },
      {
        route: 'stock',
        label: 'Stock',
        why: 'Pour consulter les quantités disponibles en stock.',
      },
    ],
    tips: [
      'Décochez « Fournisseur actif (décochez pour le désactiver) » en modification si le partenariat s’arrête.',
    ],
    terms: ['Catalogue'],
  },
  {
    route: 'goods-receipts',
    title: 'Réceptions fournisseur',
    module: 'stock',
    anyPermission: ['stock.receive'],
    purpose:
      'Consultez les livraisons reçues des fournisseurs, retrouvez un brouillon en cours ou créez une nouvelle réception.',
    actions: [
      {
        label: 'Nouvelle réception',
        effect: 'Ouvre un brouillon vide de réception fournisseur.',
      },
      {
        label: 'Fournisseurs',
        effect: 'Ouvre la liste des fournisseurs et laboratoires du cabinet.',
      },
      {
        label: 'Retour au stock',
        effect: 'Revient à l’écran « Stock ».',
      },
    ],
    tasks: [
      {
        id: 'ouvrir-reception',
        title: 'Retrouver ou démarrer une réception',
        steps: [
          'Utilisez « Afficher » pour filtrer entre brouillons, réceptions validées ou toutes les réceptions.',
          'Cliquez sur une ligne pour ouvrir sa fiche, ou cliquez sur « Nouvelle réception ».',
        ],
        result: 'L’écran de la réception s’ouvre pour lecture ou modification du brouillon.',
      },
    ],
    rules: [
      'Un brouillon de réception ne modifie jamais le stock tant qu’il n’est pas validé.',
      'Une fois validée, la réception devient définitive et alimente les quantités disponibles.',
    ],
    next: [
      {
        route: 'goods-receipt-new',
        label: 'Nouvelle réception',
        why: 'Pour saisir le bon de livraison d’un fournisseur.',
      },
      {
        route: 'suppliers',
        label: 'Fournisseurs',
        why: 'Pour créer ou corriger une fiche fournisseur avant réception.',
      },
      {
        route: 'stock',
        label: 'Stock',
        why: 'Pour vérifier l’impact après validation.',
      },
    ],
    tips: ['Vous pouvez supprimer un brouillon tant qu’il n’est pas validé.'],
    terms: ['Brouillon', 'Stock physique', 'Lot'],
  },
  {
    route: 'goods-receipt-new',
    title: 'Nouvelle réception',
    module: 'stock',
    anyPermission: ['stock.receive'],
    purpose:
      'Enregistrez un nouveau brouillon de livraison fournisseur : fournisseur, emplacement, référence, articles et quantités reçues.',
    actions: [
      {
        label: 'Ajouter une ligne',
        effect: 'Ajoute une ligne vide pour saisir un autre article géré en stock.',
      },
      {
        label: 'Retirer la ligne',
        effect: 'Supprime cette ligne du brouillon non encore validé.',
      },
      {
        label: 'Enregistrer le brouillon',
        effect: 'Sauvegarde la réception sur le serveur sans modifier encore le stock.',
      },
      {
        label: 'Passer à la validation',
        effect:
          'Enregistre d’abord le brouillon puis prépare la validation finale avec lots et coûts.',
      },
      {
        label: 'Retour aux réceptions',
        effect: 'Revient à la liste « Réceptions fournisseur ».',
      },
    ],
    tasks: [
      {
        id: 'creer-brouillon-reception',
        title: 'Saisir un brouillon de réception fournisseur',
        steps: [
          'Choisissez « Fournisseur », « Emplacement de réception », « Référence de livraison » et « Date de réception ».',
          'Sur chaque ligne, sélectionnez « Article géré en stock » et indiquez « Quantité reçue ».',
          'Renseignez si besoin « Coût d’achat unitaire (facultatif) » puis cliquez sur « Enregistrer le brouillon ».',
        ],
        result: 'Le brouillon est créé avec un lien permanent et peut être complété plus tard.',
      },
    ],
    rules: [
      'Enregistrer le brouillon laisse les quantités en stock inchangées.',
      'Seuls les articles marqués comme gérés en stock au catalogue peuvent figurer sur une réception.',
    ],
    next: [
      {
        route: 'goods-receipts',
        label: 'Réceptions fournisseur',
        why: 'Pour retrouver tous les brouillons et réceptions validées.',
      },
      {
        route: 'stock',
        label: 'Stock',
        why: 'Pour contrôler le stock de l’emplacement.',
      },
    ],
    tips: ['Ajoutez « Remarques (facultatif) » pour noter un colis incomplet ou une réserve.'],
    terms: ['Brouillon', 'Stock physique', 'Lot'],
  },
  {
    route: 'goods-receipt',
    title: 'Réception fournisseur',
    module: 'stock',
    anyPermission: ['stock.receive'],
    purpose:
      'Relisez une réception validée ou terminez un brouillon en renseignant les lots, dates d’expiration et coûts d’achat avant validation.',
    actions: [
      {
        label: 'Enregistrer le brouillon',
        effect:
          'Sauvegarde les modifications du brouillon sans toucher encore aux quantités en stock.',
      },
      {
        label: 'Passer à la validation',
        effect:
          'Ouvre l’étape finale où chaque article périssable reçoit son numéro de lot et sa date d’expiration.',
      },
      {
        label: 'Supprimer le brouillon',
        effect: 'Efface définitivement ce brouillon avant toute entrée en stock.',
      },
      {
        label: 'Confirmer mon mot de passe',
        effect:
          'Déverrouille la confirmation finale lorsqu’elle demande le mot de passe du compte.',
      },
      {
        label: 'Valider la réception',
        effect: 'Enregistre l’entrée définitive en stock pour chaque ligne reçue.',
      },
      {
        label: 'Retour au brouillon',
        effect: 'Revient à l’édition des lignes avant validation.',
      },
      {
        label: 'Retour aux réceptions',
        effect: 'Revient à la liste des réceptions.',
      },
    ],
    tasks: [
      {
        id: 'valider-reception',
        title: 'Valider définitivement une réception en stock',
        steps: [
          'Relisez les lignes puis cliquez sur « Passer à la validation ».',
          'Complétez « Numéro de lot », « Date d’expiration » si l’article est périssable, et « Coût d’achat unitaire (FCFA) ».',
          'Cliquez sur « Valider la réception » pour créditer le stock.',
        ],
        result:
          'Les quantités entrent en stock, les lots sont créés et la réception passe en lecture seule.',
      },
    ],
    rules: [
      'Un article suivi par lots exige un « Numéro de lot » et une « Date d’expiration » au moment de valider.',
      'Une réception validée ne se modifie ni ne se supprime ; toute correction passe par un mouvement ou un retour.',
    ],
    next: [
      {
        route: 'goods-receipts',
        label: 'Réceptions fournisseur',
        why: 'Pour consulter ou créer une autre réception.',
      },
      {
        route: 'stock',
        label: 'Stock',
        why: 'Pour vérifier les nouveaux disponibles.',
      },
    ],
    tips: [
      'En cas d’incident de saisie après validation, ajustez l’écart depuis « Casse ou ajustement » ou par inventaire.',
    ],
    terms: ['Brouillon', 'Stock physique', 'Lot'],
  },
  {
    route: 'inventories',
    title: 'Inventaires',
    module: 'stock',
    anyPermission: ['stock.inventory'],
    purpose:
      'Ouvrez un nouveau comptage d’inventaire sur un emplacement ou retrouvez les inventaires en cours et terminés.',
    actions: [
      {
        label: 'Ouvrir l’inventaire',
        effect:
          'Crée un nouvel inventaire pour l’emplacement choisi à partir des quantités théoriques actuelles.',
      },
      {
        label: 'Retour au stock',
        effect: 'Revient à l’écran « Stock ».',
      },
    ],
    tasks: [
      {
        id: 'ouvrir-un-inventaire',
        title: 'Démarrer un nouvel inventaire',
        steps: [
          'Choisissez « Emplacement à inventorier » et saisissez « Référence de l’inventaire ».',
          'Cliquez sur « Ouvrir l’inventaire » pour figer la base de comptage.',
        ],
        result: 'L’inventaire s’ouvre avec la liste des articles à compter sur cet emplacement.',
      },
    ],
    rules: [
      'Utilisez « Afficher » pour filtrer les inventaires selon leur état.',
      'Le stock ne change qu’au moment où la gérante valide l’inventaire terminé.',
    ],
    next: [
      {
        route: 'stock',
        label: 'Stock',
        why: 'Pour lire les disponibilités avant ou après comptage.',
      },
    ],
    tips: ['Donnez une référence datée claire à chaque inventaire pour le retrouver facilement.'],
    terms: ['Stock physique', 'Stock disponible'],
  },
  {
    route: 'inventory',
    title: 'Inventaire',
    module: 'stock',
    anyPermission: ['stock.inventory'],
    purpose:
      'Saisissez la « Quantité trouvée » pour chaque article, signalez les écarts puis soumettez le comptage à la validation de la gérante.',
    actions: [
      {
        label: 'Enregistrer les comptages',
        effect: 'Sauvegarde les quantités saisies et les motifs sans modifier le stock.',
      },
      {
        label: 'Terminer le comptage',
        effect: 'Clôture la saisie du comptage et prépare l’écran de validation.',
      },
      {
        label: 'Valider l’inventaire',
        effect: 'Applique les écarts constatés au stock réel (réservé à la gérante).',
        anyPermission: ['stock.adjust'],
      },
      {
        label: 'Rouvrir pour corriger',
        effect: 'Remet l’inventaire en cours de comptage pour corriger une quantité.',
      },
      {
        label: 'Abandonner l’inventaire',
        effect: 'Annule cet inventaire sans appliquer aucun mouvement de stock.',
      },
      {
        label: 'Retour aux inventaires',
        effect: 'Revient à la liste « Inventaires ».',
      },
    ],
    tasks: [
      {
        id: 'compter-et-valider',
        title: 'Compter les articles puis valider les écarts',
        steps: [
          'Pour chaque ligne, saisissez « Quantité trouvée » et expliquez tout écart dans « Motif de l’écart ».',
          'Cliquez sur « Enregistrer les comptages », puis sur « Terminer le comptage ».',
          'La gérante saisit « Motif de l’approbation » et clique sur « Valider l’inventaire ».',
        ],
        result:
          'Chaque écart devient un mouvement d’ajustement tracé et le stock reflète le comptage.',
      },
    ],
    rules: [
      'Un écart constaté exige un « Motif de l’écart » avant de terminer le comptage.',
      'Seule la gérante peut valider un inventaire terminé et mettre le stock à jour.',
      'Abandonner un inventaire n’altère jamais les quantités en stock.',
    ],
    next: [
      {
        route: 'inventories',
        label: 'Inventaires',
        why: 'Pour consulter les autres campagnes d’inventaire.',
      },
      {
        route: 'stock',
        label: 'Stock',
        why: 'Pour vérifier les quantités ajustées.',
      },
    ],
    tips: [
      'Confirmez votre mot de passe si l’écran vous invite à cliquer sur « Confirmer mon mot de passe ».',
    ],
    terms: ['Stock physique', 'Stock réservé', 'Approbation'],
  },
  {
    route: 'stock-alerts',
    title: 'Alertes et seuils',
    module: 'stock',
    anyPermission: ['stock.read'],
    purpose:
      'Consultez les articles passés sous leur seuil de stock bas et les lots proches de la péremption ou expirés, sans modifier aucun solde.',
    actions: [
      {
        label: 'Actualiser les alertes',
        effect:
          'Recalcule immédiatement les seuils et les dates de péremption, sans doublon et sans toucher au stock.',
        anyPermission: ['stock.adjust', 'stock.receive', 'stock.inventory'],
      },
      {
        label: 'Prendre en compte',
        effect: 'Marque une alerte ouverte comme prise en compte par l’équipe.',
        anyPermission: ['stock.adjust', 'stock.receive', 'stock.inventory'],
      },
      {
        label: 'Marquer résolue',
        effect:
          'Clôture manuellement une alerte ; si la cause persiste, un réapprovisionnement ou un écoulement reste nécessaire.',
        anyPermission: ['stock.adjust', 'stock.receive', 'stock.inventory'],
      },
      {
        label: 'Retour au stock',
        effect: 'Revient à l’écran « Stock » pour consulter les positions et lots.',
      },
    ],
    tasks: [
      {
        id: 'traiter-alertes-stock',
        title: 'Filtrer et traiter les alertes de stock',
        steps: [
          'Filtrez la liste avec « Afficher », « Type » et « Emplacement ».',
          'Comparez « Physique », « Réservé », « Quotas des postes » et « Disponible » sur la carte.',
          'Cliquez sur « Prendre en compte » quand une commande ou action est lancée, puis sur « Marquer résolue » une fois traitée.',
        ],
        result:
          'L’équipe suit les ruptures annoncées et les péremptions sans jamais bloquer la caisse.',
      },
    ],
    rules: [
      'Le disponible comparé au seuil est « Physique » moins « Réservé » moins « Quotas des postes ».',
      'Une alerte ne modifie jamais les quantités en stock : elle informe l’équipe et se résout automatiquement au réapprovisionnement.',
      'Un lot expiré reste bloqué à la remise tant qu’il n’est pas retiré du stock.',
    ],
    next: [
      {
        route: 'stock',
        label: 'Stock',
        why: 'Pour consulter le détail des emplacements et des lots.',
      },
      {
        route: 'goods-receipts',
        label: 'Réceptions fournisseur',
        why: 'Pour enregistrer une livraison sur un article en alerte.',
      },
    ],
    tips: [
      'Les seuils de stock bas et les délais d’alerte de péremption se règlent sur chaque fiche article du catalogue.',
    ],
    terms: ['Stock physique', 'Stock réservé', 'Stock disponible', 'Lot'],
  },
]
