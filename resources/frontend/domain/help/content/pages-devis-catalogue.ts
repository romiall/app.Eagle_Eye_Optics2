import type { PageHelp } from '../model'

/**
 * Aide des écrans de devis (liste, nouveau, devis ouvert) et de catalogue (articles, import CSV,
 * créances papier, règles fiscales), tous du module sales : voir docs/implementation/help.md.
 */
export const PAGES_DEVIS_CATALOGUE: readonly PageHelp[] = [
  {
    route: 'devis',
    title: 'Devis',
    module: 'sales',
    anyPermission: ['invoice.read'],
    purpose:
      'Retrouvez les devis remis aux clients, du plus récent au plus ancien, avec leur numéro, leur destinataire, leur état, leur validité et leur total. Un devis est une proposition : il ne vaut pas facture et n’enregistre aucun règlement.',
    actions: [
      {
        label: 'Nouveau devis',
        effect:
          'Ouvre le formulaire d’un nouveau devis pour un patient du cabinet ou pour un prospect.',
        anyPermission: ['invoice.create'],
      },
      {
        label: 'État',
        effect:
          'Ne montre que les devis d’un état (« Brouillon », « Émis », « Expiré »…) ; « Tous les états » les montre tous.',
      },
      {
        label: 'Brouillon sans numéro',
        effect:
          'Lien d’un brouillon, qui n’a pas encore de numéro : ouvre le devis pour le compléter. Un devis émis s’ouvre par son numéro.',
      },
      {
        label: 'Page suivante',
        effect:
          'Affiche les 25 devis suivants quand la liste a plusieurs pages ; « Page précédente » revient en arrière.',
      },
      {
        label: 'Réessayer',
        effect: 'Relit la liste quand le serveur n’a pas répondu ou que la session a expiré.',
      },
    ],
    tasks: [
      {
        id: 'retrouver-un-devis',
        title: 'Retrouver un devis',
        steps: [
          'Parcourez la liste : chaque devis montre son numéro, son destinataire, son état, sa validité et son « Total proposé ».',
          'Pour ne voir qu’un état, choisissez-le dans « État » (par exemple « Accepté par le client » ou « Expiré »).',
          'Cliquez sur le numéro du devis pour l’ouvrir. Un brouillon s’ouvre par « Brouillon sans numéro ».',
          'Si la liste a plusieurs pages, utilisez « Page suivante » et « Page précédente ».',
        ],
        result:
          'Le devis s’ouvre avec ses lignes, ses révisions et les actions possibles : voir l’aide du devis ouvert.',
      },
      {
        id: 'etablir-un-devis',
        title: 'Établir un nouveau devis',
        anyPermission: ['invoice.create'],
        steps: [
          'Cliquez sur « Nouveau devis » en haut de l’écran.',
          'Choisissez le destinataire, ajoutez les articles et la date de validité, puis enregistrez : voir l’aide de l’écran « Nouveau devis ».',
        ],
        result:
          'Le brouillon enregistré s’ouvre. Il reçoit son numéro seulement quand vous l’émettez.',
      },
    ],
    rules: [
      'Les devis sont classés du plus récent au plus ancien, 25 par page.',
      'L’état affiché est celui d’aujourd’hui : un devis émis ou accepté dont la date de validité est passée apparaît « Expiré », sans que personne l’ait modifié.',
      'Un brouillon n’a pas de numéro : il en reçoit un à l’émission. En attendant, la liste le montre avec « Non émis ».',
      'Un devis n’est ni une facture ni un encaissement : la liste n’affiche aucun reste à encaisser, et aucun article n’est réservé.',
      'Le filtre par état porte sur tous les devis du cabinet, pas seulement sur la page affichée.',
      'Si la liste ne peut pas être lue, l’écran affiche « Serveur indisponible » et « Réessayer » : il ne dit jamais « Aucun devis » à tort.',
    ],
    next: [
      {
        route: 'devis-nouveau',
        label: 'Nouveau devis',
        why: 'Pour établir une proposition à un patient ou à un prospect.',
      },
      {
        route: 'factures',
        label: 'Factures',
        why: 'Pour retrouver la facture née d’un devis converti.',
      },
      {
        topic: 'parcours-devis',
        label: 'Du devis à la facture, pas à pas',
      },
    ],
    tips: [
      'Les six états : « Brouillon », « Émis », « Accepté par le client », « Refusé par le client », « Expiré » et « Converti en facture ».',
      'Dans la configuration d’origine, la gérante et la caissière ont cet écran ; l’accueil et le professionnel ne le voient pas.',
      'Cette version ne permet ni de supprimer un devis ni d’abandonner un brouillon : un brouillon laissé de côté reste dans la liste.',
      'L’application ne transmet pas le devis au client : ouvrez-le, imprimez son PDF, puis remettez-le vous-même.',
      'La fiche d’un patient ne propose pas encore de raccourci vers un devis : passez par « Nouveau devis » et cherchez le patient.',
    ],
    problems: [
      {
        symptom: '« Aucun devis »',
        remedy:
          'Le serveur n’a aucun devis pour ces critères. Choisissez « Tous les états » dans « État », ou établissez un « Nouveau devis ».',
      },
      {
        symptom: '« Serveur indisponible »',
        remedy:
          'Le serveur n’a pas répondu et rien n’est conclu. Vérifiez votre connexion, puis cliquez sur « Réessayer ».',
      },
      {
        symptom: '« Session expirée »',
        remedy:
          'Reconnectez-vous avec « Se reconnecter » dans l’en-tête, puis cliquez sur « Réessayer ».',
      },
      {
        symptom: '« Droits insuffisants »',
        remedy:
          'Ce compte ne peut pas consulter les devis. Demandez à la gérante d’ajuster ses droits.',
      },
    ],
    terms: ['Devis', 'Brouillon', 'Révision', 'Facture émise'],
  },
  {
    route: 'devis-nouveau',
    title: 'Nouveau devis',
    module: 'sales',
    anyPermission: ['invoice.create'],
    purpose:
      'Établissez une proposition de prix pour un patient du cabinet ou pour un prospect sans dossier : destinataire, articles du catalogue, date de validité, puis enregistrement du brouillon. L’émission se fait sur l’écran du devis enregistré.',
    actions: [
      {
        label: 'Destinataire du devis',
        effect:
          'Choisit « Un patient du cabinet » (identité lue sur sa fiche) ou « Un prospect sans dossier » (nom et téléphone seulement).',
      },
      {
        label: 'Patient',
        effect:
          'Cherche le patient par nom, téléphone ou numéro de dossier (2 caractères au moins) ; vous choisissez dans la liste proposée.',
      },
      {
        label: 'Continuer avec ce prospect',
        effect:
          'Valide le nom et le téléphone du prospect et affiche les lignes du devis ; « Modifier » rouvre ces deux champs.',
      },
      {
        label: 'Valable jusqu’au',
        effect:
          'Date de validité du devis (JJ/MM/AAAA), aujourd’hui ou plus tard ; elle est obligatoire pour pouvoir émettre le devis.',
      },
      {
        label: 'Ajouter un article du catalogue',
        effect:
          'Cherche un article actif par référence, nom, marque ou modèle ; flèches pour parcourir, Entrée pour l’ajouter comme ligne.',
      },
      {
        label: 'Ajouter une ligne hors catalogue',
        effect: 'Ajoute une ligne libre dont vous saisissez la désignation et le prix.',
        anyPermission: ['catalog.manage'],
      },
      {
        label: 'Retirer la ligne',
        effect: 'Enlève cette ligne du devis.',
      },
      {
        label: 'Enregistrer le brouillon',
        effect: 'Enregistre le devis en brouillon, sans numéro, puis ouvre sa page, où il s’émet.',
      },
      {
        label: 'Retour aux devis',
        effect: 'Revient à la liste ; l’écran prévient si une saisie n’est pas enregistrée.',
      },
    ],
    tasks: [
      {
        id: 'devis-pour-un-patient',
        title: 'Établir un devis pour un patient du cabinet',
        steps: [
          'Dans « Destinataire du devis », choisissez « Un patient du cabinet ».',
          'Saisissez au moins 2 caractères dans « Patient » (nom, téléphone ou numéro de dossier), puis cliquez sur le bon patient dans la liste.',
          'Vérifiez l’identité affichée : elle est lue sur la fiche du patient, vous ne la ressaisissez pas.',
          'Renseignez « Valable jusqu’au » au format JJ/MM/AAAA : aujourd’hui ou plus tard.',
          'Dans « Ajouter un article du catalogue », saisissez une référence, un nom, une marque ou un modèle, puis choisissez l’article. Répétez pour chaque article.',
          'Sur chaque ligne, vérifiez la quantité et le prix, et ajoutez au besoin une « Remise TTC » dans la limite de votre compte.',
          'Contrôlez « Total TTC du devis », puis cliquez sur « Enregistrer le brouillon ».',
        ],
        result:
          'Le devis s’ouvre en brouillon, sans numéro, avec le message « Brouillon de devis enregistré sur le serveur. » Il reste à l’émettre : voir l’aide du devis ouvert.',
      },
      {
        id: 'devis-pour-un-prospect',
        title: 'Établir un devis pour un prospect sans dossier',
        steps: [
          'Dans « Destinataire du devis », choisissez « Un prospect sans dossier ».',
          'Saisissez le « Nom du prospect ». Le « Téléphone (facultatif) » peut rester vide.',
          'Cliquez sur « Continuer avec ce prospect » : les lignes du devis apparaissent. « Modifier » permet de corriger le nom ou le téléphone.',
          'Renseignez « Valable jusqu’au » et ajoutez les articles, comme pour un patient.',
          'Cliquez sur « Enregistrer le brouillon ».',
        ],
        result:
          'Le devis est établi au nom du prospect, sans fiche patient ni donnée clinique. Le prospect rejoint un dossier patient quand le devis est converti en facture.',
      },
    ],
    rules: [
      'Un devis ne vaut pas facture : il ne crée ni créance, ni encaissement, ni réservation de stock.',
      'Rien n’est enregistré tant que vous n’avez pas cliqué sur « Enregistrer le brouillon ». Quitter l’écran avec une saisie non enregistrée demande confirmation.',
      'Le prix d’un article du catalogue s’impose : seule la gérante le modifie ou ajoute une ligne hors catalogue. Une remise reste dans le plafond fixé pour le compte.',
      'Sur un devis, une remise au-delà du plafond n’ouvre aucune demande d’approbation : la gérante établit alors elle-même le devis.',
      'Les prix sont TTC (taxes comprises), en FCFA entiers. Le serveur recalcule chaque total et refuse un total différent de celui de l’écran.',
      'Un devis compte au plus 200 lignes. La date de validité est obligatoire pour l’émission et ne peut pas être antérieure à aujourd’hui.',
    ],
    next: [
      {
        route: 'devis',
        label: 'Devis',
        why: 'Pour revenir à la liste des devis.',
      },
      {
        route: 'patients',
        label: 'Patients',
        why: 'Pour retrouver ou créer la fiche d’un patient avant son devis.',
      },
      {
        topic: 'parcours-devis',
        label: 'Du devis à la facture, pas à pas',
      },
    ],
    tips: [
      'La date de validité n’est jamais proposée par défaut : demandez à la gérante la durée habituelle du cabinet.',
      'Si le module Stock est ouvert, la disponibilité d’un article géré en stock s’affiche sous sa ligne, pour information : le devis ne réserve rien.',
      'Un prospect n’est pas un patient : aucune donnée clinique n’est saisie. À la conversion en facture, on choisit le dossier patient qui la reçoit.',
      'Le brouillon n’a pas d’aperçu PDF : le PDF se prépare pour un devis émis, révision par révision.',
    ],
    problems: [
      {
        symptom: '« Fiche archivée ou fusionnée »',
        remedy:
          'Cette fiche ne reçoit plus de nouveau devis. Cherchez la fiche conservée dans « Patients » et recommencez avec elle.',
      },
      {
        symptom: '« Fiche du patient non lue »',
        remedy:
          'Le serveur n’a pas pu lire la fiche : aucun devis ne se prépare sans son dossier. Vérifiez la connexion, puis choisissez de nouveau le patient.',
      },
      {
        symptom: '« Choix du patient impossible »',
        remedy:
          'Ce compte ne peut pas rechercher les patients. Demandez à la gérante d’ajuster ses droits, ou établissez le devis pour un prospect.',
      },
      {
        symptom: '« Certaines informations sont à corriger »',
        remedy:
          'Le résumé liste chaque erreur, par exemple « La désignation est obligatoire. » : cliquez sur un message pour aller au champ concerné.',
      },
      {
        symptom: '« Le nom du prospect est obligatoire. »',
        remedy: 'Saisissez le nom avant de cliquer sur « Continuer avec ce prospect ».',
      },
    ],
    terms: ['Devis', 'Brouillon', 'Remise commerciale', 'Catalogue', 'Numéro de dossier'],
  },
  {
    route: 'devis-detail',
    title: 'Devis',
    module: 'sales',
    anyPermission: ['invoice.read'],
    purpose:
      'Suivez un devis : lignes de la révision actuelle, révisions figées et réimprimables, réponse du client, conversion en brouillon de facture. Un brouillon s’y complète et s’émet ; un devis émis ne vaut jamais facture.',
    actions: [
      {
        label: 'Enregistrer le brouillon',
        effect:
          'Enregistre sur le serveur les lignes et la validité d’un brouillon, qui n’a toujours pas de numéro.',
        anyPermission: ['invoice.create'],
      },
      {
        label: 'Supprimer le brouillon',
        effect:
          'Après confirmation, supprime un devis jamais émis avec ses lignes, par son créateur ou la gérante. Un devis émis se révise.',
        anyPermission: ['invoice.create'],
      },
      {
        label: 'Émettre le devis',
        effect:
          'Après confirmation, attribue le numéro du devis et fige la révision 1. Actif quand le brouillon est enregistré et a une validité.',
        anyPermission: ['invoice.create'],
      },
      {
        label: 'Réviser le devis',
        effect:
          'Ouvre la saisie d’une nouvelle révision : lignes, validité et motif. Disponible sur un devis émis, accepté ou refusé.',
        anyPermission: ['invoice.create'],
      },
      {
        label: 'Accepté par le client',
        effect:
          'Note, après confirmation, que le client accepte. Aucune facture et aucun encaissement n’en résultent.',
        anyPermission: ['invoice.create'],
      },
      {
        label: 'Refusé par le client',
        effect:
          'Note, après confirmation, que le client refuse. Le devis reste consultable, réimprimable et peut être révisé.',
        anyPermission: ['invoice.create'],
      },
      {
        label: 'Convertir en facture',
        effect:
          'Ouvre le panneau de conversion. Disponible sur un devis émis ou accepté dont la validité n’est pas passée.',
        anyPermission: ['invoice.create'],
      },
      {
        label: 'Créer le brouillon de facture',
        effect:
          'Crée un brouillon de facture lié au devis, une fois les prix confirmés. Rien n’est émis ni encaissé.',
        anyPermission: ['invoice.create'],
      },
      {
        label: 'Aperçu du devis (PDF)',
        effect:
          'Prépare le PDF de cette révision, identique à chaque réimpression ; le bouton devient « Réimprimer ».',
      },
      {
        label: 'Télécharger le PDF',
        effect:
          'Enregistre le PDF affiché ; « Ouvrir le PDF » l’ouvre dans un onglet et « Imprimer » l’ouvre pour l’impression.',
      },
      {
        label: 'Retour aux devis',
        effect: 'Revient à la liste des devis.',
      },
    ],
    tasks: [
      {
        id: 'emettre-et-imprimer',
        title: 'Émettre un brouillon de devis et l’imprimer',
        anyPermission: ['invoice.create'],
        steps: [
          'Vérifiez les lignes sous « Lignes du devis » : « Retirer la ligne » en enlève une, « Ajouter un article du catalogue » en ajoute une.',
          'Renseignez « Valable jusqu’au » (JJ/MM/AAAA, aujourd’hui ou plus tard) : sans validité, le devis ne s’émet pas.',
          'Cliquez sur « Enregistrer le brouillon ». Le bouton « Émettre le devis » s’active quand tout est enregistré.',
          'Cliquez sur « Émettre le devis » : la boîte « Émettre le devis ? » rappelle le total TTC proposé.',
          'Confirmez avec « Émettre le devis » dans la boîte.',
          'Dans « Révisions figées », cliquez sur « Aperçu du devis (PDF) » pour la révision 1.',
          'Cliquez sur « Imprimer » : le PDF s’ouvre dans la visionneuse du navigateur, d’où vous imprimez avec Ctrl+P. « Télécharger le PDF » l’enregistre.',
        ],
        result:
          'Le devis porte son numéro et la révision 1 est figée. Vous remettez vous-même le PDF au client : l’application ne le transmet pas.',
      },
      {
        id: 'reviser-un-devis',
        title: 'Réviser un devis émis',
        anyPermission: ['invoice.create'],
        steps: [
          'Cliquez sur « Réviser le devis » : les lignes actuelles deviennent modifiables.',
          'Modifiez les lignes : « Retirer la ligne », « Ajouter un article du catalogue », ou changez la quantité et la remise.',
          'Indiquez la nouvelle date dans « Valable jusqu’au » : elle est obligatoire pour une révision.',
          'Saisissez le « Motif de la révision » (3 caractères au moins) : il est imprimé sur la révision.',
          'Cliquez sur « Enregistrer la révision ». « Annuler la révision » abandonne la saisie.',
        ],
        result:
          'La révision suivante est figée et marquée « (actuelle) ». Les précédentes restent dans « Révisions figées » et se réimpriment à l’identique.',
      },
      {
        id: 'repondre-puis-convertir',
        title: 'Noter la réponse du client, puis convertir en facture',
        anyPermission: ['invoice.create'],
        steps: [
          'Si le client accepte, cliquez sur « Accepté par le client » ; s’il renonce, sur « Refusé par le client ».',
          'Dans la boîte, ajoutez si vous le souhaitez une « Précision (facultative) », puis cliquez sur « Enregistrer l’acceptation » ou « Enregistrer le refus ».',
          'Pour facturer, cliquez sur « Convertir en facture ». Un devis refusé ou expiré ne se convertit pas.',
          'Choisissez la « Révision à convertir ». Pour un prospect, cherchez aussi le « Dossier patient qui recevra la facture ».',
          'Comparez, ligne par ligne, le prix du devis et le « Prix actuel du catalogue » : l’écran signale ce qui est « différent du devis ».',
          'Choisissez la « Base de prix de la facture », puis cochez « J’ai vérifié les prix de chaque ligne ».',
          'Cliquez sur « Créer le brouillon de facture ».',
        ],
        result:
          'Le brouillon de facture s’ouvre, sans numéro et lié au devis. Vérifiez-le puis émettez-le comme toute facture : aucun encaissement n’est enregistré.',
      },
    ],
    rules: [
      'Un devis ne vaut pas facture : il ne crée ni créance, ni encaissement, ni réservation d’article. Seule la conversion explicite crée un brouillon de facture.',
      'Un brouillon n’a pas de numéro. L’émission attribue le numéro de la série des devis et fige la révision 1 : un devis émis ne se modifie plus, il se révise.',
      'Chaque révision reste figée et se réimprime à l’identique, avec ses prix et l’identité d’origine : un changement de catalogue ou de fiche patient n’y touche pas.',
      'Un devis émis ou accepté dont la date de validité est passée est « Expiré » : il ne s’accepte ni ne se convertit. Une révision lui donne une nouvelle validité.',
      'Un devis converti ne se convertit pas une seconde fois : « Factures nées de ce devis » renvoie à la facture existante. Si ce brouillon de facture est abandonné, la conversion redevient possible.',
      'La réponse du client est une simple note : elle n’émet aucune facture et n’enregistre aucun encaissement. La conversion n’exige pas l’acceptation : un devis émis, encore valable, se convertit aussi.',
    ],
    next: [
      {
        route: 'devis',
        label: 'Liste des devis',
        why: 'Pour retrouver un autre devis.',
      },
      {
        route: 'factures',
        label: 'Factures',
        why: 'Pour retrouver le brouillon ou la facture née de la conversion.',
      },
      {
        topic: 'parcours-devis',
        label: 'Du devis à la facture, pas à pas',
      },
      {
        topic: 'notion-facture',
        label: 'Comprendre la facture : brouillon, émission, encaissement',
      },
    ],
    tips: [
      'Un devis accepté peut encore être refusé. Un devis refusé reste consultable et réimprimable, et peut être révisé.',
      'Un devis accepté dont la validité est passée se révise d’abord, avec une nouvelle date, avant de pouvoir être converti.',
      'Le PDF se prépare pour une révision émise seulement : un brouillon n’a pas d’aperçu PDF.',
      'Sous chaque révision, l’état du PDF est dit, par exemple « PDF du serveur en attente : imprimez la révision pour le déposer. » : cela n’oblige jamais à émettre le devis de nouveau.',
      'Tant que les mentions officielles du cabinet ne sont pas validées, chaque révision affiche « Document de test : numéro et mentions de test (données fictives). »',
    ],
    problems: [
      {
        symptom: 'Le bouton « Émettre le devis » est grisé',
        remedy:
          'Lisez le conseil sous les boutons : enregistrez d’abord le brouillon et renseignez « Valable jusqu’au ». Un devis sans ligne ne s’émet pas.',
      },
      {
        symptom: '« Devis expiré »',
        remedy:
          'Sa date de validité est passée. Cliquez sur « Réviser le devis » pour lui donner une nouvelle validité, puis acceptez-le ou convertissez-le.',
      },
      {
        symptom: '« Conversion refusée »',
        remedy:
          'Le message dit pourquoi. Si « Ouvrir la facture existante » apparaît, ce devis a déjà donné une facture : ouvrez-la au lieu d’en créer une seconde.',
      },
      {
        symptom: '« Le devis a changé entre-temps »',
        remedy:
          'Quelqu’un l’a modifié pendant votre saisie. Votre saisie est conservée : cliquez sur « Relire le devis », puis enregistrez de nouveau.',
      },
      {
        symptom: '« PDF non généré »',
        remedy:
          'Le message donne la cause. Cliquez de nouveau sur « Aperçu du devis (PDF) » ; si cela se répète, notez le message et prévenez la gérante.',
      },
    ],
    terms: ['Devis', 'Révision', 'Brouillon', 'Facture émise'],
  },
  {
    route: 'catalogue',
    title: 'Catalogue',
    module: 'sales',
    anyPermission: ['catalog.manage'],
    purpose:
      'Tenez à jour les articles et prestations du cabinet (montures, verres, collyres, examen…) avec leur prix de vente TTC. Les devis et les factures ne proposent que les articles actifs. Écran réservé à la gérante.',
    actions: [
      {
        label: 'Nouvel article',
        effect: 'Ouvre le formulaire de création d’un article.',
      },
      {
        label: 'Importer un fichier CSV',
        effect:
          'Ouvre l’écran qui ajoute plusieurs articles à la fois depuis un fichier de tableur.',
      },
      {
        label: 'Rechercher',
        effect:
          'Affiche les articles qui correspondent à « Rechercher un article » (référence, nom, marque ou modèle) ; zone vide, tout le catalogue.',
      },
      {
        label: 'Modifier',
        effect:
          'Ouvre le formulaire de l’article choisi, sous sa ligne : prix, catégorie, activation…',
      },
      {
        label: 'Créer l’article',
        effect: 'Enregistre un nouvel article après contrôle des champs.',
      },
      {
        label: 'Enregistrer l’article',
        effect:
          'Enregistre les changements d’un article existant. Les factures déjà émises ne changent pas.',
      },
      {
        label: 'Article actif (proposé sur les factures)',
        effect:
          'Case à cocher : décochée, l’article est désactivé et n’est plus proposé sur les factures ni sur les devis.',
      },
      {
        label: 'Annuler',
        effect: 'Ferme le formulaire sans rien enregistrer.',
      },
      {
        label: 'Page suivante',
        effect: 'Affiche la page suivante du catalogue quand il compte plusieurs pages.',
      },
    ],
    tasks: [
      {
        id: 'creer-un-article',
        title: 'Créer un article',
        steps: [
          'Cliquez sur « Nouvel article ».',
          'Remplissez « Référence » (unique), « Nom », « Catégorie » et « Mode de stock » : ces champs sont obligatoires.',
          'Choisissez « Unité », puis saisissez « Prix de vente TTC » en FCFA entiers. Les deux sont obligatoires.',
          'Ajoutez si besoin « Marque » et « Modèle ». Seule la gérante voit « Coût d’achat (facultatif) » : s’il est inconnu, laissez-le vide, jamais 0.',
          'Choisissez une « Règle fiscale » seulement si le cabinet en a une active et validée ; sinon laissez « Aucune règle fiscale ».',
          'Pour un collyre, cochez « Lot et date d’expiration obligatoires (périssable) ». Pour un article géré en stock, vous pouvez fixer un « Seuil de stock bas (facultatif) ».',
          'Laissez la case « Article actif (proposé sur les factures) » cochée pour pouvoir facturer l’article tout de suite.',
          'Cliquez sur « Créer l’article ».',
        ],
        result:
          'Un message confirme l’enregistrement sur le serveur et l’article apparaît dans la liste. Les devis et les factures le proposent à la recherche.',
      },
      {
        id: 'modifier-un-article',
        title: 'Modifier le prix ou les informations d’un article',
        steps: [
          'Saisissez la référence, le nom, la marque ou le modèle dans « Rechercher un article », puis cliquez sur « Rechercher ».',
          'Cliquez sur « Modifier » sous l’article : le formulaire s’ouvre sous sa ligne.',
          'Changez le « Prix de vente TTC » ou le champ voulu.',
          'Cliquez sur « Enregistrer l’article ».',
          'Si « L’article a changé entre-temps » s’affiche, cliquez sur « Garder ma saisie sur la version actuelle », puis enregistrez de nouveau.',
        ],
        result:
          'Le nouveau prix s’applique aux nouveaux devis et aux nouvelles factures. Une facture déjà émise garde son prix d’origine.',
      },
      {
        id: 'desactiver-un-article',
        title: 'Désactiver ou réactiver un article',
        steps: [
          'Retrouvez l’article avec « Rechercher un article », puis cliquez sur « Modifier ».',
          'Décochez la case « Article actif (proposé sur les factures) » pour désactiver l’article, ou cochez-la pour le réactiver.',
          'Cliquez sur « Enregistrer l’article ».',
        ],
        result:
          'La liste affiche « Désactivé » ou « Actif » sous l’article. Un article désactivé reste au catalogue mais n’est plus proposé à la recherche des factures et des devis.',
      },
    ],
    rules: [
      'La référence est unique : deux articles ne peuvent pas la partager.',
      'Le prix est un prix de vente TTC (taxes comprises) en FCFA entiers. Changer un prix ne modifie jamais une facture déjà émise.',
      'Trois modes de stock : « Sans stock (prestation) », « Article géré en stock » et « Sur mesure (commandé) ». Une prestation, comme l’examen, n’a aucun mouvement de stock.',
      'Une paire reste une paire : elle n’est jamais convertie en deux unités. Une unité qui ne se divise pas impose une quantité entière.',
      'Un collyre exige un numéro de lot et une date d’expiration ; seul un article géré en stock peut être périssable.',
      'Il n’existe pas de suppression d’article : on le désactive. La liste montre les articles actifs et désactivés.',
    ],
    next: [
      {
        route: 'import-catalogue',
        label: 'Importer le catalogue',
        why: 'Pour ajouter beaucoup d’articles à partir d’un tableur.',
      },
      {
        route: 'taxes',
        label: 'Règles fiscales',
        why: 'Pour saisir et valider une taxe avant de la rattacher à un article.',
      },
      {
        route: 'stock',
        label: 'Stock',
        why: 'Pour saisir le stock d’ouverture des articles gérés en stock.',
      },
      {
        topic: 'premiere-configuration',
        label: 'Première configuration du cabinet',
      },
    ],
    tips: [
      'L’application ne propose aucun prix : saisissez ceux du cabinet. Les données de démonstration sont fictives.',
      'L’examen de vue se crée comme une prestation : catégorie « Prestation / examen », unité « Prestation » et mode « Sans stock (prestation) ».',
      'La case « Visible sur le site public (lot suivant) » annonce une fonction d’un lot suivant : elle n’a pas d’effet visible aujourd’hui.',
      'Le coût d’achat n’apparaît qu’avec le droit de lire les coûts d’achat, que seule la gérante détient dans la configuration d’origine.',
      'Les devis déjà émis gardent leurs prix : une révision figée ne suit pas le catalogue, et la conversion en facture montre l’écart.',
    ],
    problems: [
      {
        symptom: '« Aucun article »',
        remedy:
          'Le serveur n’a aucun article pour cette recherche. Vérifiez l’orthographe, ou videz « Rechercher un article » puis cliquez sur « Rechercher » pour tout afficher.',
      },
      {
        symptom: '« La recherche demande 2 caractères au moins. »',
        remedy: 'Complétez la saisie, ou laissez la zone vide pour afficher tout le catalogue.',
      },
      {
        symptom: '« L’article a changé entre-temps »',
        remedy:
          'Quelqu’un l’a modifié. Votre saisie est conservée : cliquez sur « Garder ma saisie sur la version actuelle » (ou « Relire l’article »), puis enregistrez.',
      },
      {
        symptom: '« Un collyre exige un numéro de lot et une date d’expiration. »',
        remedy:
          'Cochez « Lot et date d’expiration obligatoires (périssable) » : un collyre est toujours périssable.',
      },
      {
        symptom: '« Une prestation n’a aucun mouvement de stock. »',
        remedy:
          'Choisissez « Sans stock (prestation) » dans « Mode de stock » pour une prestation comme l’examen.',
      },
    ],
    terms: ['Catalogue', 'Règle fiscale', 'Monture', 'Verres', 'Collyre', 'Lot'],
  },
  {
    route: 'import-catalogue',
    title: 'Importer le catalogue',
    module: 'sales',
    anyPermission: ['catalog.manage'],
    purpose:
      'Ajoutez en une fois les articles et prestations du cabinet à partir d’un fichier de tableur enregistré en CSV : vérification sur le serveur, puis import, tout ou rien. La gérante y reprend aussi les créances du carnet papier, plus bas.',
    actions: [
      {
        label: 'Télécharger le modèle',
        effect:
          'Télécharge le fichier modèle, avec toutes les colonnes et deux lignes d’exemple à remplacer.',
      },
      {
        label: 'Colonnes du fichier',
        effect: 'Déplie la liste des colonnes du catalogue, obligatoires ou facultatives.',
      },
      {
        label: 'Fichier CSV du catalogue',
        effect:
          'Choisit le fichier. Il est lu sur votre ordinateur avant tout envoi : l’écran dit combien d’articles il contient et ce qui est à corriger.',
      },
      {
        label: 'Vérifier sur le serveur',
        effect:
          'Fait contrôler chaque ligne par le serveur, sans rien enregistrer. Un bouton du même nom existe dans « Créances papier ».',
      },
      {
        label: 'Importer',
        effect:
          'Enregistre toutes les lignes ou aucune. Le bouton indique le nombre d’articles prêts et reste inactif tant que le serveur n’a pas tout accepté.',
      },
      {
        label: 'Voir le catalogue',
        effect: 'Ouvre le catalogue une fois l’import terminé.',
      },
      {
        label: 'Scan de la pièce ou de la page du carnet (PDF, JPEG ou PNG)',
        effect: 'Dépose le justificatif scanné, obligatoire avant toute vérification de créances.',
        anyPermission: ['finance.global.read'],
      },
      {
        label: 'Une créance',
        effect:
          'Saisit une seule créance à l’écran ; « Un fichier CSV » reprend plusieurs créances depuis un fichier.',
        anyPermission: ['finance.global.read'],
      },
      {
        label: 'Reprendre',
        effect:
          'Enregistre toutes les créances vérifiées ou aucune. Le bouton indique le nombre de créances prêtes.',
        anyPermission: ['finance.global.read'],
      },
    ],
    tasks: [
      {
        id: 'importer-des-articles',
        title: 'Importer des articles depuis un fichier CSV',
        steps: [
          'Dans « 1. Préparer le fichier », cliquez sur « Télécharger le modèle » et ouvrez-le dans un tableur.',
          'Remplacez les deux lignes d’exemple par vos articles : une ligne par article, 500 au plus. « Colonnes du fichier » indique les colonnes obligatoires.',
          'Enregistrez le fichier au format CSV (UTF-8).',
          'Dans « 2. Choisir le fichier », choisissez-le avec « Fichier CSV du catalogue » : l’écran annonce le nombre d’articles lus.',
          'Si « Le fichier est à corriger avant toute vérification » apparaît, corrigez les lignes citées dans le tableur et rechoisissez le fichier.',
          'Dans « 3. Vérifier, puis importer », cliquez sur « Vérifier sur le serveur » : le serveur contrôle chaque ligne sans rien enregistrer.',
          'Quand « Fichier vérifié par le serveur » s’affiche, cliquez sur le bouton « Importer » suivi du nombre d’articles.',
          'Si « Confirmer votre mot de passe » s’ouvre, saisissez-le puis cliquez sur « Confirmer et reprendre » : l’opération reprend sans doublon.',
        ],
        result:
          'Le message « Catalogue importé » indique le nombre d’articles enregistrés ; « Voir le catalogue » les affiche.',
      },
      {
        id: 'corriger-un-fichier-refuse',
        title: 'Corriger un fichier refusé',
        steps: [
          'Lisez « Lignes refusées par le serveur : rien n’a été enregistré » : chaque ligne donne son numéro, sa colonne et le problème.',
          'Le numéro est celui du tableur : la ligne 1 est l’en-tête, le premier article est à la ligne 2.',
          'Corrigez ces lignes dans le tableur, puis enregistrez de nouveau le fichier en CSV.',
          'Rechoisissez-le dans « Fichier CSV du catalogue », puis cliquez de nouveau sur « Vérifier sur le serveur ».',
        ],
        result:
          'Tant qu’une ligne est refusée, aucun article n’est enregistré et l’import reste inactif. Sans refus, vous pouvez importer.',
      },
      {
        id: 'reprendre-les-creances',
        title: 'Reprendre les créances du carnet papier',
        anyPermission: ['finance.global.read'],
        steps: [
          'Descendez jusqu’à la section « Créances papier », réservée à la gérante.',
          'Déposez le scan avec « Scan de la pièce ou de la page du carnet (PDF, JPEG ou PNG) » : il est obligatoire.',
          'Vérifiez que « Justificatif conservé sur le serveur » s’affiche : le scan est bien déposé.',
          'Choisissez « Une créance » pour une seule, ou « Un fichier CSV » pour plusieurs (modèle téléchargeable).',
          'Pour une créance, cherchez le « Patient », puis saisissez la « Référence de la pièce papier ».',
          'Saisissez « Total de la pièce papier (FCFA) » et « Déjà réglé sur papier (FCFA) » : l’écran calcule « Reste dû repris ».',
          'Cliquez sur « Vérifier sur le serveur » : « Créances vérifiées par le serveur » confirme que rien n’est encore enregistré.',
          'Cliquez sur le bouton « Reprendre » suivi du nombre de créances, puis confirmez votre mot de passe si l’écran le demande.',
        ],
        result:
          'Chaque créance devient une pièce émise dont le total est le reste dû. Le lien qui commence par « Ouvrir la pièce » permet de l’encaisser comme une facture, avec un reçu pour chaque encaissement.',
      },
    ],
    rules: [
      'Tout ou rien : si une seule ligne est refusée, rien n’est enregistré, ni article ni créance. Le serveur revérifie tout au moment de l’import ou de la reprise.',
      'Les articles déjà au catalogue ne sont pas modifiés : une référence déjà présente, ou répétée dans le fichier, fait refuser la ligne.',
      'Chaque ligne suit les règles d’un article saisi à la main : catégorie, unité et mode de stock cohérents, collyre périssable, prix en FCFA entiers. Une taxe se désigne par le code d’une règle fiscale.',
      'L’import et la reprise sont des opérations sensibles : le serveur peut demander de confirmer votre mot de passe, puis la même demande reprend sans doublon.',
      'Seul le reste dû d’une créance est repris : la vente et l’acompte d’origine restent dans le carnet papier. Une référence papier ne se reprend qu’une fois.',
      'La reprise n’est pas une vente du jour : elle ne touche ni au stock ni aux factures émises de la caisse du jour, et la pièce porte un numéro d’une série à part.',
    ],
    next: [
      {
        route: 'catalogue',
        label: 'Catalogue',
        why: 'Pour relire les articles importés.',
      },
      {
        route: 'taxes',
        label: 'Règles fiscales',
        why: 'À saisir avant l’import si le fichier désigne une taxe.',
      },
      {
        route: 'stock',
        label: 'Stock',
        why: 'Pour saisir le stock d’ouverture des articles importés.',
      },
      {
        topic: 'premiere-configuration',
        label: 'Première configuration du cabinet',
      },
    ],
    tips: [
      'Essayez d’abord un fichier de deux ou trois lignes pour voir comment l’écran réagit, puis importez tout le catalogue.',
      'Colonnes obligatoires : reference, designation, categorie, unite, prix_vente et mode_stock. Les autres sont facultatives.',
      'Les deux lignes d’exemple du modèle (EX-MONT-001 et EX-EXAM-001) sont fictives : remplacez-les avant d’importer.',
      'Fichier des créances : colonnes reference_papier, dossier (numéro de dossier, EE-2026-0001), total_origine, deja_paye (vide = 0) et date_piece. Les fiches des patients doivent exister.',
      'Le stock d’ouverture se saisit ensuite dans « Stock », si le module est ouvert, avec « Remplir depuis un fichier CSV (facultatif) ».',
    ],
    problems: [
      {
        symptom: '« Fichier illisible »',
        remedy:
          'Le fichier n’a pas pu être lu. Enregistrez-le de nouveau au format CSV (UTF-8) depuis le tableur, puis rechoisissez-le.',
      },
      {
        symptom: '« Le fichier est à corriger avant toute vérification »',
        remedy:
          'Chaque ligne citée donne sa colonne et le problème : montant mal écrit, valeur autre que oui ou non, code de taxe inconnu, « Colonne obligatoire absente ». Corrigez le tableur, puis rechoisissez le fichier.',
      },
      {
        symptom: '« Lignes refusées par le serveur : rien n’a été enregistré »',
        remedy:
          'Corrigez les lignes indiquées, choisissez de nouveau le fichier, puis vérifiez-le. Une référence déjà au catalogue fait refuser la ligne.',
      },
      {
        symptom: '« Justificatif non déposé »',
        remedy:
          'Si la boîte de mot de passe s’ouvre, confirmez-le puis choisissez de nouveau le scan (PDF, JPEG ou PNG, 5 Mo au plus). Sinon, vérifiez la connexion.',
      },
      {
        symptom: '« Montants à corriger »',
        remedy:
          'Le total doit être positif et le montant déjà réglé ne peut pas le dépasser. Une pièce papier entièrement réglée n’a plus rien à reprendre.',
      },
    ],
    terms: [
      'Catalogue',
      'Créance papier',
      'Reste à encaisser',
      'Reçu',
      'Acompte',
      'Numéro de dossier',
    ],
  },
  {
    route: 'taxes',
    title: 'Règles fiscales',
    module: 'sales',
    anyPermission: ['catalog.manage'],
    purpose:
      'Saisissez ici les taxes appliquées par le cabinet, avec le comptable : code, libellé et taux. L’application n’en propose aucune. Une règle ne s’applique aux documents que si elle est active et validée par la gérante.',
    actions: [
      {
        label: 'Nouvelle règle',
        effect: 'Ouvre le formulaire d’une nouvelle règle fiscale.',
      },
      {
        label: 'Modifier',
        effect:
          'Ouvre le formulaire de la règle choisie : code, libellé, taux, validation, activation.',
      },
      {
        label: 'Je valide ce taux (enregistré à mon nom, à l’instant de l’enregistrement)',
        effect:
          'Case à cocher : la gérante valide le taux, et la validation est enregistrée à son nom avec la date.',
      },
      {
        label: 'Règle active (appliquée aux documents si elle est validée)',
        effect:
          'Case à cocher : une règle active et validée est appliquée aux documents ; décochée, elle ne l’est plus.',
      },
      {
        label: 'Enregistrer la règle',
        effect:
          'Contrôle la saisie puis l’enregistre ; le mot de passe de la gérante peut être demandé.',
      },
      {
        label: 'Annuler',
        effect: 'Ferme le formulaire sans rien enregistrer.',
      },
    ],
    tasks: [
      {
        id: 'saisir-une-regle',
        title: 'Saisir et valider une règle fiscale',
        steps: [
          'Obtenez d’abord le régime et le taux auprès du comptable : l’application ne propose aucun taux.',
          'Cliquez sur « Nouvelle règle ».',
          'Remplissez « Code » et « Libellé » (obligatoires), puis « Taux, en % ».',
          'Ajoutez si besoin une « Mention légale (facultative) ».',
          'Cochez « Je valide ce taux (enregistré à mon nom, à l’instant de l’enregistrement) » : c’est la validation de la gérante.',
          'Cochez « Règle active (appliquée aux documents si elle est validée) » pour que la taxe s’applique.',
          'Cliquez sur « Enregistrer la règle ». Si « Confirmer votre mot de passe » s’ouvre, saisissez-le puis cliquez sur « Confirmer et reprendre ».',
        ],
        result:
          'La règle apparaît dans la liste avec l’état « Active et validée ». Elle peut être rattachée à un article du catalogue.',
      },
      {
        id: 'changer-un-taux',
        title: 'Changer le taux d’une règle',
        steps: [
          'Cliquez sur « Modifier » sous la règle.',
          'Changez « Taux, en % ».',
          'Cochez de nouveau la case de validation : changer le taux retire la validation, et une règle active doit être validée.',
          'Cliquez sur « Enregistrer la règle » et confirmez votre mot de passe si l’écran le demande.',
        ],
        result:
          'La règle repasse à « Active et validée », avec sa nouvelle date de validation. Les factures déjà émises gardent leur taxe d’origine.',
      },
      {
        id: 'desactiver-une-regle',
        title: 'Désactiver une règle',
        steps: [
          'Cliquez sur « Modifier » sous la règle.',
          'Décochez la case « Règle active (appliquée aux documents si elle est validée) ».',
          'Cliquez sur « Enregistrer la règle ».',
        ],
        result: 'La règle passe à « Inactive » : elle n’est plus appliquée aux nouveaux documents.',
      },
    ],
    rules: [
      'Aucune taxe n’est préconfigurée : le régime réel se fixe avec la gérante et le comptable. Sans règle active et validée, les factures portent « aucune taxe configurée ».',
      'Une règle n’est appliquée aux documents que si elle est active ET validée : une règle « Active, non validée (non appliquée) » reste sans effet.',
      'Une règle active exige un taux, et ce taux exige la validation de la gérante, enregistrée à son nom avec la date.',
      'Changer le taux d’une règle validée retire sa validation : il faut la redonner dans la même demande pour que la règle reste active.',
      'Une taxe n’est jamais recalculée sur une facture déjà émise : elle garde le régime figé à son émission.',
      'L’enregistrement est une opération sensible : l’application peut demander de confirmer votre mot de passe, puis reprend la saisie sans doublon.',
    ],
    next: [
      {
        route: 'catalogue',
        label: 'Catalogue',
        why: 'Pour rattacher la règle à un article.',
      },
      {
        route: 'import-catalogue',
        label: 'Importer le catalogue',
        why: 'La colonne taxe de l’import désigne le code d’une règle.',
      },
      {
        topic: 'premiere-configuration',
        label: 'Première configuration du cabinet',
      },
      {
        topic: 'notion-facture',
        label: 'Comprendre la facture et ses montants',
      },
    ],
    tips: [
      'Si le comptable n’a pas encore tranché, ne saisissez rien : les factures portent « aucune taxe configurée » et aucun taux n’est inventé.',
      'Les prix du catalogue sont TTC : le taux ventile la taxe comprise dans le total, il ne l’ajoute pas.',
      'Seule la gérante valide un taux ; l’accueil, le professionnel et la caissière n’ont pas cet écran.',
      'Le code d’une règle sert aussi à la désigner dans un fichier d’import du catalogue.',
    ],
    problems: [
      {
        symptom: '« Une règle active doit être validée par la gérante. »',
        remedy:
          'Cochez la case de validation du taux, ou décochez la case d’activation de la règle.',
      },
      {
        symptom: '« Une règle active exige un taux. »',
        remedy: 'Saisissez « Taux, en % » avant d’activer la règle.',
      },
      {
        symptom: '« Le taux a changé : revalidez la règle pour la laisser active. »',
        remedy: 'Cochez de nouveau la case de validation avant d’enregistrer.',
      },
      {
        symptom: '« Confirmation du mot de passe demandée »',
        remedy:
          'Rien n’a été enregistré. Cliquez sur « Confirmer mon mot de passe », saisissez-le puis cliquez sur « Confirmer et reprendre ».',
      },
      {
        symptom: '« La règle a changé entre-temps »',
        remedy:
          'Votre saisie est conservée. Cliquez sur « Relire la règle » : votre saisie partira sur la version actuelle.',
      },
    ],
    terms: ['Règle fiscale', 'Catalogue', 'Facture émise'],
  },
]
