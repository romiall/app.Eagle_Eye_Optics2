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
      'C’est ici que vous voyez ce qui reste de chaque article, emplacement par emplacement. La gérante y saisit aussi le stock d’ouverture. L’écran n’a pas d’entrée dans le menu : ouvrez « Ventes et caisse », puis « Stock ».',
    actions: [
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
      'Cette version ne propose ni réception de marchandise, ni inventaire complet, ni alerte de stock bas ou de péremption proche, ni valeur du stock. L’écran montre des quantités seulement.',
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
      'Il n’existe pas encore d’écran de réception de marchandise ni d’inventaire complet. Une entrée par « Ajustement après comptage » enregistre seulement des articles trouvés en plus, sans fournisseur ni coût.',
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
]
