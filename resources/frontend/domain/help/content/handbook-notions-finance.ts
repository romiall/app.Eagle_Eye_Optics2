import type { HandbookTopic } from '../model'

/**
 * Rubriques « Notions et règles », partie finance et stock : facture, encaissement, caisse, stock
 * et approbations de la gérante. Libellés recopiés de l’application ; montants et numéros fictifs.
 */
export const TOPICS_NOTIONS_FINANCE: readonly HandbookTopic[] = [
  {
    id: 'notion-facture',
    title: 'La vie d’une facture',
    summary:
      'Les étapes d’une facture, ce qui devient définitif à l’émission et qui peut accorder une remise.',
    module: 'sales',
    anyPermission: ['invoice.read', 'payment.collect', 'cash.own_session', 'exam_fee.collect'],
    audience: ['MANAGER', 'CASHIER'],
    intro:
      'Une facture raconte une vente. Elle se prépare librement, puis devient définitive quand vous l’émettez : elle ne change plus ensuite.',
    blocks: [
      {
        kind: 'flow',
        title: 'Les étapes d’une facture',
        stages: [
          {
            label: 'Brouillon',
            text: 'Vous choisissez les articles (recherche dès 2 caractères) et les quantités. Pas de numéro, pas de stock réservé. Modifiable, ou à fermer avec « Abandonner le brouillon ».',
          },
          {
            label: 'Émise',
            text: 'Après « Émettre la facture », elle reçoit son numéro définitif et ses articles gérés en stock sont réservés. Elle peut être encaissée.',
          },
          {
            label: 'Partiellement encaissée',
            text: 'Après un acompte, « Total encaissé » monte et « Reste à encaisser » baisse. La facture reste « Émise ».',
          },
          {
            label: 'Encaissée en totalité',
            text: 'Le « Reste à encaisser » est à zéro. Aucun nouveau statut n’apparaît : les reçus en font foi.',
          },
        ],
      },
      {
        kind: 'points',
        title: 'Ce qui est figé à l’émission',
        items: [
          'Le numéro : définitif, jamais réutilisé ni changé. Chaque année a sa propre série.',
          'Les lignes : désignation, quantité, prix, remise et taxe (« Lignes (figées à l’émission) »).',
          'L’identité du patient et celle du cabinet, comme ce jour-là (« Patient (identité figée à l’émission) »).',
          'Un nom corrigé ou un prix modifié plus tard ne change pas une facture émise. Sa réimpression redonne la même pièce.',
        ],
      },
      {
        kind: 'points',
        title: 'Prix, remise et plafond du compte',
        items: [
          'Le prix du catalogue s’impose. Seule la gérante le modifie, ou ajoute une ligne avec « Ajouter une ligne hors catalogue ».',
          'La remise se saisit par ligne, en FCFA, dans « Remise TTC ». La gérante peut aller jusqu’au montant brut de la ligne.',
          'Les autres comptes ont un plafond en pourcentage, réglé à la mise en service. Il vaut 0 % par défaut : aucune remise n’est alors admise. Le texte sous « Remise TTC » donne votre plafond.',
          'Au-delà, l’enregistrement est refusé avec « Prix ou remise au-delà de vos droits ». Cliquez sur « Demander une autorisation », attendez la gérante, puis enregistrez de nouveau sans toucher aux lignes.',
        ],
      },
      {
        kind: 'points',
        title: 'Taxes et mentions',
        items: [
          'Les prix sont toutes taxes comprises (TTC). La taxe est ventilée d’après les « Règles fiscales » saisies et validées par la gérante ; une règle non validée n’est pas appliquée.',
          'Sans règle validée, la facture affiche « Aucune taxe ventilée (régime non configuré) » : aucun taux n’est inventé.',
          'Tant que les mentions officielles ne sont pas validées, chaque document porte « DOCUMENT DE TEST ». Ne le remettez pas comme pièce officielle.',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Les numéros commencent par TEST tant que le cabinet n’a pas choisi ses séries (par exemple TEST-FAC-2026-000001). Le travail sans Internet n’est pas encore disponible.',
      },
      {
        kind: 'faq',
        title: 'Questions fréquentes',
        items: [
          {
            q: 'Puis-je corriger une facture émise ?',
            a: 'Non. Une erreur d’encaissement se corrige par une contre-écriture, une réduction de la vente par un avoir.',
          },
          {
            q: 'Puis-je supprimer une facture ?',
            a: 'Seul un brouillon se ferme, avec « Abandonner le brouillon » : il reste visible, sans numéro ni effet financier. Une facture émise garde son numéro.',
          },
        ],
      },
    ],
    related: [
      {
        route: 'facture-nouvelle',
        label: 'Nouvelle facture',
        why: 'Pour préparer un brouillon.',
      },
      {
        route: 'factures',
        label: 'Factures',
        why: 'Pour retrouver une facture et son reste à encaisser.',
      },
      { topic: 'notion-encaissement', label: 'Encaissements, reçus et corrections' },
      { topic: 'notion-stock', label: 'Le stock : physique, réservé, disponible' },
      { topic: 'notion-approbations', label: 'Approbations : l’accord de la gérante' },
      { topic: 'parcours-vente', label: 'Parcours de la vente, pas à pas' },
    ],
    keywords: [
      'facture',
      'brouillon',
      'émettre',
      'émission',
      'numéro de facture',
      'remise',
      'rabais',
      'réduction',
      'plafond de remise',
      'prix',
      'taxe',
      'TVA',
      'abandonner',
      'annuler une facture',
      'supprimer une facture',
      'modifier une facture',
    ],
  },
  {
    id: 'notion-encaissement',
    title: 'Encaissements, reçus et corrections',
    summary:
      'Comment s’encaissent un acompte puis le reste, ce que prouve un reçu et comment corriger sans rien effacer.',
    module: 'sales',
    anyPermission: ['invoice.read', 'payment.collect', 'cash.own_session', 'exam_fee.collect'],
    audience: ['MANAGER', 'CASHIER'],
    intro:
      'Trois pièces, trois rôles. La facture dit ce qui est dû. L’encaissement dit ce qui a été reçu. Le reçu en est la preuve.',
    blocks: [
      {
        kind: 'table',
        title: 'Exemple : une facture de 80 000 FCFA',
        head: ['Moment', 'Ce que vous faites', 'Ce qui en résulte'],
        rows: [
          [
            'Le jour de la commande',
            'Vous encaissez un acompte de 30 000 FCFA.',
            'Un premier reçu. Reste à encaisser : 50 000 FCFA.',
          ],
          [
            'Quelques jours plus tard',
            'Vous encaissez le reste, 50 000 FCFA.',
            'Un second reçu, sur la même facture. Reste à encaisser : 0 FCFA.',
          ],
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Le second encaissement ne crée pas une nouvelle vente : il encaisse le reste de la première.',
      },
      {
        kind: 'points',
        title: 'Règles de l’encaissement',
        items: [
          'Chaque encaissement a son propre reçu, numéroté automatiquement. Ce numéro ne change jamais.',
          'Le montant ne dépasse pas le « Reste à encaisser » : « Encaisser le reste » le remplit pour vous.',
          'Choisissez le « Mode de règlement » : « Espèces », « Mobile money MTN », « Orange Money », « Virement », « Chèque » ou « Autre mode ». La « Référence de l’opération » est obligatoire pour le mobile money et le virement.',
          'Les espèces exigent une session de caisse ouverte à votre nom, sinon l’écran affiche « Caisse non ouverte ». Rien n’est vérifié auprès de l’opérateur : vous constatez l’encaissement, daté de son enregistrement.',
          'Deux encaissements de 40 000 FCFA sur 50 000 FCFA à encaisser : le premier passe, le second est refusé avec « Le montant dépasse le reste à encaisser » et le reste à jour. Après une coupure, utilisez « Réessayer l’encaissement » : jamais de doublon.',
        ],
      },
      {
        kind: 'points',
        title: 'Le reçu',
        items: [
          'Il indique le « Montant reçu », le « Total encaissé après ce reçu » et le « Reste à encaisser après ce reçu ».',
          '« Voir le reçu », puis « Aperçu du reçu (PDF) » ou « Réimprimer le reçu » redonnent toujours la même pièce, sans nouvel encaissement. Si le PDF échoue, le reçu existe quand même.',
        ],
      },
      {
        kind: 'table',
        title: 'Corriger sans rien effacer',
        head: ['Situation', 'Pièce à utiliser', 'Ce qui se passe'],
        rows: [
          [
            'Un encaissement a été saisi à tort.',
            'Une contre-écriture : « Contre-passer le paiement ».',
            'Le paiement et son reçu restent ; le total encaissé baisse. Ce n’est pas une sortie d’argent. Motif obligatoire.',
          ],
          [
            'La vente doit être réduite.',
            'Un avoir : « Émettre un avoir ».',
            'Le dû baisse, dans la limite de chaque ligne d’origine. La facture et ses reçus ne changent pas.',
          ],
          [
            'De l’argent doit être rendu au patient.',
            'Un remboursement : « Rembourser », sur l’avoir.',
            'Limité à l’avoir et au « Crédit en faveur du patient ». Pièce numérotée ; en espèces, session de caisse ouverte.',
          ],
        ],
      },
      {
        kind: 'note',
        tone: 'warning',
        text: 'Aucun bouton ne supprime un paiement ou un reçu. Exemple : 80 000 FCFA facturés, 50 000 FCFA encaissés ; des avoirs de 80 000 FCFA créent 50 000 FCFA de crédit ; une fois remboursés, tout est à zéro.',
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'La caissière et la gérante encaissent ; l’accueil seulement les frais d’examen, si la gérante lui en donne le droit. La gérante exécute les corrections ; la caissière voit « Demander l’autorisation ».',
      },
    ],
    related: [
      { topic: 'notion-facture', label: 'La vie d’une facture' },
      { topic: 'notion-caisse', label: 'La caisse : session, tiroir et clôture' },
      { topic: 'notion-approbations', label: 'Approbations : l’accord de la gérante' },
      { topic: 'parcours-correction', label: 'Corriger une erreur, pas à pas' },
      { route: 'factures', label: 'Factures', why: 'Pour ouvrir une facture et l’encaisser.' },
    ],
    keywords: [
      'encaisser',
      'encaissement',
      'reçu',
      'acompte',
      'solde',
      'reste à payer',
      'impayé',
      'règlement',
      'paiement',
      'contre-écriture',
      'contre-passer',
      'avoir',
      'remboursement',
      'rembourser',
      'annuler un paiement',
      'supprimer un paiement',
      'erreur de saisie',
      'mobile money',
      'espèces',
      'référence',
    ],
  },
  {
    id: 'notion-caisse',
    title: 'La caisse : session, tiroir et clôture',
    summary:
      'Comment une session de caisse s’ouvre et se ferme, d’où viennent les espèces attendues, et pourquoi ventes et encaissements diffèrent.',
    module: 'sales',
    anyPermission: ['cash.own_session', 'finance.global.read'],
    audience: ['MANAGER', 'CASHIER'],
    intro:
      'La caisse suit les espèces du tiroir. Chaque caissière travaille dans sa propre session : elle s’ouvre avec un fond et se ferme avec un comptage.',
    blocks: [
      {
        kind: 'flow',
        title: 'Une session de caisse',
        stages: [
          {
            label: 'Ouvrir',
            text: 'Saisissez le « Fond de caisse », les espèces déjà dans le tiroir (0 si le tiroir est vide), puis cliquez sur « Ouvrir la caisse ».',
          },
          {
            label: 'Encaisser',
            text: 'Les encaissements en espèces entrent dans votre session. Mobile money, virements et chèques ne passent pas par le tiroir.',
          },
          {
            label: 'Noter les mouvements',
            text: 'Dépense, retrait ou dépôt hors vente : « Enregistrer un mouvement ». Ce n’est pas un paiement de patient. La caissière demande l’accord de la gérante. Une sortie ne dépasse jamais les espèces attendues.',
          },
          {
            label: 'Compter et clôturer',
            text: 'Saisissez le « Montant compté dans le tiroir », puis cliquez sur « Clôturer la caisse » : la session est figée.',
          },
        ],
      },
      {
        kind: 'points',
        title: 'Les espèces attendues',
        items: [
          'Espèces attendues = fond de caisse + espèces encaissées − remboursements en espèces ± mouvements autorisés. Une contre-écriture d’un encaissement en espèces se déduit des encaissements.',
          'Exemple : un fond de 10 000 FCFA et 20 000 FCFA encaissés donnent 30 000 FCFA attendus. Vous comptez 29 500 FCFA : l’écart est de 500 FCFA en moins.',
          'Un écart demande un « Motif de l’écart ». L’application ne juge pas : elle écrit simplement « Le compté est inférieur à l’attendu ».',
        ],
      },
      {
        kind: 'points',
        title: 'Une session clôturée est figée',
        items: [
          'Elle ne reçoit plus rien. Une erreur se corrige dans une session ouverte, avec son motif.',
          'Si un encaissement en espèces arrive pendant votre comptage, l’écran affiche « Les espèces attendues ont changé depuis l’affichage ». Recomptez, puis clôturez de nouveau.',
          'La gérante peut clôturer la session d’une autre caissière (« Clôturer cette session ») et accepter ou contester un écart (« Revoir l’écart »). La clôture n’est jamais réécrite.',
          'Le « Relevé provisoire (PDF) » existe pendant la session, le « Relevé de clôture (PDF) » après.',
        ],
      },
      {
        kind: 'table',
        title: 'Ventes ou encaissements ?',
        head: ['Mot', 'Ce qu’il mesure', 'Où le lire (gérante)'],
        rows: [
          [
            'Ventes du jour',
            'Les factures émises ce jour-là, moins les avoirs émis ce jour-là.',
            '« Factures émises ce jour » et « Avoirs émis ce jour »',
          ],
          [
            'Encaissements du jour',
            'L’argent reçu ce jour-là, moins les contre-écritures et les remboursements.',
            '« Encaissements nets par mode » et « Total net encaissé »',
          ],
          [
            'Reste à encaisser',
            'Ce que les patients doivent encore sur toutes les factures émises, même anciennes.',
            '« Reste à encaisser (factures ouvertes) »',
          ],
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Une facture émise le mois dernier et encaissée aujourd’hui augmente les encaissements d’aujourd’hui, pas les ventes d’aujourd’hui. Dans « Caisse du jour », la caissière ne voit que ses encaissements et ses sessions.',
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'La gérante crée les « Catégories de dépenses » : aucune n’est préconfigurée, et sans catégorie active aucune dépense ne s’enregistre.',
      },
      {
        kind: 'note',
        tone: 'warning',
        text: 'Pas encore disponible : le rapprochement du mobile money et des virements avec les relevés, et les exports comptables. « Caisse du jour » est un outil de gestion, pas une comptabilité officielle.',
      },
    ],
    related: [
      { route: 'caisse', label: 'Caisse', why: 'Pour ouvrir ou clôturer votre session.' },
      {
        route: 'caisse-du-jour',
        label: 'Caisse du jour',
        why: 'Pour lire les encaissements d’un jour.',
      },
      { topic: 'notion-encaissement', label: 'Encaissements, reçus et corrections' },
      { topic: 'notion-approbations', label: 'Approbations : l’accord de la gérante' },
      { topic: 'parcours-caisse', label: 'Parcours de la caisse, pas à pas' },
    ],
    keywords: [
      'caisse',
      'session de caisse',
      'fond de caisse',
      'tiroir',
      'tiroir-caisse',
      'espèces',
      'clôture',
      'clôturer',
      'écart',
      'écart de caisse',
      'comptage',
      'dépense',
      'retrait',
      'dépôt',
      'chiffre d’affaires',
      'encaissements du jour',
      'impayés',
      'relevé de caisse',
    ],
  },
  {
    id: 'notion-stock',
    title: 'Le stock : physique, réservé, disponible',
    summary:
      'Les trois chiffres du stock, la réserve à l’émission, la remise au patient, les lots de collyres et les retours.',
    module: 'stock',
    anyPermission: ['stock.read'],
    audience: ['MANAGER', 'CASHIER'],
    intro:
      'Un article n’est jamais vendu deux fois. Pour cela, l’application distingue ce qui est en place, ce qui est promis et ce qui reste à vendre. L’écran « Stock » s’ouvre depuis « Ventes et caisse ».',
    blocks: [
      {
        kind: 'table',
        title: 'Les trois chiffres',
        head: ['Chiffre', 'Ce que c’est', 'Quand il change'],
        rows: [
          [
            'Physique',
            'Ce qui est réellement en place dans le cabinet.',
            'Il baisse à la remise ou à une casse, remonte avec un retour remis en stock, et varie avec un ajustement après comptage (en plus ou en moins).',
          ],
          [
            'Réservé',
            'Ce qui est mis de côté pour des factures émises.',
            'Il monte à l’émission et retombe à la remise.',
          ],
          [
            'Disponible',
            'Ce qui reste à vendre : le physique moins le réservé.',
            'Il baisse à l’émission, pas à la remise.',
          ],
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Exemple : 5 montures en place. Une facture émise en réserve 1 : physique 5, réservé 1, disponible 4. À la remise : physique 4, réservé 0, disponible 4. Le chiffre « Quotas des postes » concerne le travail sans Internet, pas encore disponible.',
      },
      {
        kind: 'flow',
        title: 'De la vente à la remise',
        stages: [
          {
            label: 'Émission',
            text: 'Chaque article géré en stock est réservé. S’il manque du stock, l’émission est refusée (« Stock insuffisant ») : corrigez la quantité d’après le disponible affiché sous la ligne. Un article sans stock initial est refusé aussi.',
          },
          {
            label: 'Remise',
            text: 'Sur la facture émise, cliquez sur « Remettre au patient », indiquez les quantités, puis « Confirmer la remise ». L’article sort du stock et la réserve est consommée.',
          },
          {
            label: 'Remise partielle',
            text: 'Laissez vide une ligne à remettre plus tard. « Tous les articles sont remis » s’affiche quand tout est sorti.',
          },
        ],
      },
      {
        kind: 'points',
        title: 'Règles de la remise',
        items: [
          'Rien ne se remet sans facture émise, ni au-delà de la quantité facturée ou de la réserve de cette vente.',
          'S’il reste à encaisser, la remise demande l’accord de la gérante (« Remise avant règlement complet ») : la caissière clique sur « Demander l’autorisation de remise ».',
          'Les prestations, « Sans stock (prestation) », et les articles « Sur mesure (commandé) » n’ont pas de mouvement de stock.',
        ],
      },
      {
        kind: 'points',
        title: 'Collyres : lots et dates',
        items: [
          'Un collyre se suit par lot : « Numéro de lot » et « Date d’expiration ». Le lot qui expire le plus tôt part en premier.',
          'Un lot expiré ne peut pas être remis ; un lot qui expire aujourd’hui peut encore l’être aujourd’hui.',
          'Un lot « en quarantaine (jamais réservé) » n’est ni réservé ni remis.',
        ],
      },
      {
        kind: 'points',
        title: 'Avoir, retour et casse : trois choses différentes',
        items: [
          'Un avoir réduit ce que le patient doit. Il ne remet aucun article en stock ni ne libère la réserve d’un article pas encore remis : la gérante décide de la suite.',
          'Un retour est un article rapporté. Par défaut, la gérante l’enregistre (« Enregistrer un retour ») et ne coche « Remettre en stock vendable » que si l’article est intact. Il ne rend pas d’argent.',
          'Une casse ou un écart de comptage se saisit avec le bouton « Casse ou ajustement » de l’écran « Stock », avec un motif. Ce qui est réservé pour une vente ne peut pas être retiré.',
        ],
      },
      {
        kind: 'note',
        tone: 'warning',
        text: 'Pas encore disponible : la réception des commandes fournisseur, l’inventaire, les alertes de stock bas ou de péremption proche, la valeur du stock et le travail sans Internet.',
      },
    ],
    related: [
      { route: 'stock', label: 'Stock', why: 'Pour lire les disponibilités et les lots.' },
      {
        route: 'stock-movement',
        label: 'Casse ou ajustement',
        why: 'Pour sortir une casse du stock.',
      },
      { topic: 'notion-facture', label: 'La vie d’une facture' },
      { topic: 'notion-approbations', label: 'Approbations : l’accord de la gérante' },
      { topic: 'parcours-remise-article', label: 'Remettre un article au patient, pas à pas' },
      { topic: 'parcours-stock', label: 'Parcours du stock, pas à pas' },
    ],
    keywords: [
      'stock',
      'stock physique',
      'stock réservé',
      'stock disponible',
      'réserve',
      'remise au patient',
      'livraison',
      'remettre un article',
      'lot',
      'péremption',
      'date d’expiration',
      'quarantaine',
      'collyre',
      'retour',
      'casse',
      'ajustement',
      'inventaire',
      'monture',
    ],
  },
  {
    id: 'notion-approbations',
    title: 'Approbations : l’accord de la gérante',
    summary:
      'Quand une action demande l’accord de la gérante, comment le demander et le décider, et ce que cet accord permet.',
    module: 'settings',
    anyPermission: ['approval.request', 'approval.decide'],
    intro:
      'Certaines opérations sensibles demandent l’accord de la gérante. Cet accord s’appelle une approbation : il vaut pour une opération précise, une seule fois. Selon l’écran, on parle d’autorisation ou d’approbation : c’est la même chose.',
    blocks: [
      {
        kind: 'table',
        title: 'Quand une approbation est demandée',
        head: ['Opération', 'Où la demander'],
        rows: [
          [
            '« Prix ou remise d’un brouillon de facture »',
            'Brouillon de facture : « Demander une autorisation »',
          ],
          ['« Contre-écriture d’un paiement »', 'Facture émise : « Contre-passer le paiement »'],
          ['« Avoir sur une facture émise »', 'Facture émise : « Émettre un avoir »'],
          ['« Remboursement d’un crédit »', 'Facture émise : « Rembourser »'],
          [
            '« Remise avant règlement complet »',
            'Facture émise : « Remettre au patient », s’il reste à encaisser',
          ],
          ['« Mouvement de caisse hors vente »', 'Écran « Caisse » : « Enregistrer un mouvement »'],
          ['« Casse ou ajustement de stock »', 'Écran « Casse ou ajustement »'],
          [
            '« Dispense des frais d’examen »',
            'File du jour : « Demander une dispense des frais d’examen », si le paiement de l’examen est contrôlé',
          ],
        ],
      },
      {
        kind: 'steps',
        title: 'Demander une approbation',
        items: [
          'Commencez l’opération. Quand elle dépasse vos droits, l’écran propose « Demander l’autorisation », « Demander une autorisation » ou « Demander l’autorisation de remise ».',
          'Saisissez le « Motif de la demande » (3 caractères au moins), puis cliquez sur « Envoyer la demande à la gérante ». Rien n’est accordé avant sa décision.',
          'Prévenez la gérante : la page d’accueil n’affiche aucun compteur de demandes.',
          'Après son accord, refaites exactement la même opération : mêmes lignes, même montant, même mode.',
        ],
      },
      {
        kind: 'steps',
        title: 'Décider une approbation (la gérante)',
        items: [
          'Ouvrez « Paramètres », puis la carte « Autorisations » : l’écran « Approbations » s’ouvre sur « En attente ».',
          'Lisez la carte : l’opération exacte, le « Motif », « Demandée par » et son « Échéance ».',
          'Cliquez sur « Accorder » ou « Refuser ». Un refus exige un « Motif de la décision (obligatoire pour un refus) », rendu à la personne qui a demandé.',
          'Confirmez votre mot de passe : « Confirmer et reprendre ».',
        ],
      },
      {
        kind: 'points',
        title: 'Ce qu’une approbation permet',
        items: [
          'Une seule fois : après usage, la demande passe à « Utilisée ».',
          'Pour ce contenu exact : si le montant, une ligne ou le mode change, une nouvelle demande est nécessaire.',
          'Pour une durée limitée : son « Échéance » est affichée, une heure par défaut après l’accord. Ensuite, la demande est « Échue ».',
          'Pas pour soi-même : la gérante ne décide pas sa propre demande (« Vous avez fait cette demande »). Elle exécute directement l’opération, avec la même trace : « Autorisation directe de la gérante ».',
        ],
      },
      {
        kind: 'faq',
        title: 'Questions fréquentes',
        items: [
          {
            q: 'La gérante a accordé, mais l’écran refuse encore. Pourquoi ?',
            a: 'Vérifiez que vous renvoyez exactement la même opération, avant l’échéance. Sinon, faites une nouvelle demande. Pour une correction, une remise ou un mouvement, l’écran dit « L’autorisation demandée n’est pas (ou plus) accordée ».',
          },
          {
            q: 'Faut-il retaper le mot de passe à chaque fois ?',
            a: 'Non. Une confirmation reste valable environ un quart d’heure. Ensuite, la boîte « Confirmer votre mot de passe » revient.',
          },
        ],
      },
    ],
    related: [
      {
        route: 'approbations',
        label: 'Approbations',
        why: 'Pour la gérante : voir et décider les demandes.',
      },
      { topic: 'notion-encaissement', label: 'Encaissements, reçus et corrections' },
      { topic: 'notion-stock', label: 'Le stock : physique, réservé, disponible' },
      { topic: 'notion-caisse', label: 'La caisse : session, tiroir et clôture' },
      { topic: 'guide-gerante', label: 'Guide de la gérante' },
    ],
    keywords: [
      'approbation',
      'autorisation',
      'autoriser',
      'accord de la gérante',
      'demander l’autorisation',
      'dispense',
      'refus',
      'accorder',
      'mot de passe',
      'confirmer le mot de passe',
      'échéance',
      'validation de la gérante',
    ],
  },
]
