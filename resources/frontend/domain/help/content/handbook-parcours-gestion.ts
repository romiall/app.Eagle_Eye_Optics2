import type { HandbookTopic } from '../model'

/**
 * Documentation globale, partie « Parcours pas à pas » : ventes, caisse, stock et gestion de bout en bout.
 * Sept rubriques : vente, devis, remise des articles, corrections, caisse, stock, travail de la gérante.
 */
export const TOPICS_PARCOURS_GESTION: readonly HandbookTopic[] = [
  {
    id: 'parcours-vente',
    title: 'Vendre : de la facture au reçu',
    summary:
      'Créer une facture, l’émettre, encaisser un acompte puis le reste, et imprimer la facture et chaque reçu.',
    module: 'sales',
    anyPermission: ['invoice.read', 'payment.collect', 'cash.own_session', 'exam_fee.collect'],
    audience: ['CASHIER', 'MANAGER'],
    intro:
      'Pour la caissière, et pour la gérante quand elle encaisse elle-même. L’identité du patient est reprise de sa fiche, jamais ressaisie. Chaque enregistrement est confirmé par le serveur : il faut une connexion Internet.',
    blocks: [
      {
        kind: 'flow',
        title: 'Les étapes d’une vente',
        stages: [
          {
            label: 'Brouillon',
            text: 'Vous choisissez le patient et les articles. Pas encore de numéro.',
          },
          {
            label: 'Émission',
            text: 'La facture reçoit son numéro et ne se modifie plus. Le stock est réservé.',
          },
          {
            label: 'Acompte',
            text: 'Le patient verse une partie : un premier reçu est créé.',
          },
          {
            label: 'Reste',
            text: 'Le patient verse le reste plus tard : un second reçu, sur la même facture.',
          },
          {
            label: 'Remise au patient',
            text: 'Les articles sont remis au patient, en une ou plusieurs fois.',
          },
        ],
      },
      {
        kind: 'steps',
        title: 'Préparer et émettre la facture',
        items: [
          'Ouvrez la fiche du patient et cliquez sur « Créer une facture ». Le même bouton figure sur sa visite, dans « Aujourd’hui ».',
          'Sans fiche ouverte : « Ventes et caisse », puis « Nouvelle facture », puis cherchez le patient dans « Patient ».',
          'Dans « Ajouter un article du catalogue », tapez 2 caractères au moins et choisissez l’article. Il arrive avec le prix du catalogue.',
          'Réglez la « Quantité » de chaque ligne. Le « Prix unitaire TTC » ne se modifie pas : seule la gérante change un prix.',
          'Cliquez sur « Enregistrer le brouillon ». L’écran répond « Brouillon de facture enregistré sur le serveur. » Il n’y a pas encore de numéro.',
          'Vérifiez le « Total TTC », puis cliquez sur « Émettre la facture » et confirmez dans la boîte « Émettre la facture ? ».',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Le numéro définitif apparaît dans le titre de l’écran. À partir de là, la facture ne se modifie plus.',
      },
      {
        kind: 'steps',
        title: 'Accorder une remise commerciale',
        items: [
          'Sous « Remise TTC », l’écran rappelle la règle de votre compte : la remise est réservée à la gérante, ou plafonnée.',
          'Si la remise dépasse vos droits, l’écran affiche « Prix ou remise au-delà de vos droits ». Cliquez sur « Demander une autorisation ».',
          'Écrivez le « Motif de la demande », puis cliquez sur « Envoyer la demande à la gérante ».',
          'La gérante décide dans « Paramètres », « Autorisations » : elle clique sur « Accorder » ou « Refuser ».',
          'Après l’accord, cliquez de nouveau sur « Enregistrer le brouillon », sans rien changer aux lignes.',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'L’autorisation vaut pour ces lignes exactes, une seule fois. Si vous changez un prix, une quantité ou une remise, il faut une nouvelle demande. La gérante saisit une remise directement, sans demande.',
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Exemple suivi ci-dessous : une facture de 80 000 FCFA, un acompte de 30 000 FCFA, puis les 50 000 FCFA restants quelques jours plus tard.',
      },
      {
        kind: 'steps',
        title: 'Encaisser l’acompte, puis le reste',
        items: [
          'Sur la facture émise, repérez « Reste à encaisser » : 80 000 FCFA au départ.',
          'Dans « Montant encaissé », saisissez 30 000. Le bouton « Encaisser le reste » remplit tout le reste.',
          'Choisissez le « Mode de règlement » : « Espèces », « Mobile money MTN », « Orange Money », « Virement », « Chèque » ou « Autre mode ».',
          'Pour un mobile money ou un virement, saisissez la « Référence de l’opération » : le numéro de transaction ou de virement.',
          'Cliquez sur « Encaisser ». L’écran affiche « Encaissement enregistré sur le serveur » ; il reste 50 000 FCFA à encaisser.',
          'Quelques jours plus tard, rouvrez la facture dans « Factures », ou cliquez sur « Nouvel encaissement » si elle est encore affichée.',
          'Encaissez les 50 000 FCFA restants de la même façon.',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Chaque encaissement a son propre reçu, qui dit s’il s’agit d’un « Acompte » ou du règlement du reste. Quand « Reste à encaisser » atteint 0 FCFA, le formulaire « Encaisser » disparaît.',
      },
      {
        kind: 'note',
        tone: 'warning',
        text: 'Un encaissement en « Espèces » exige une caisse ouverte. Sinon l’écran affiche « Caisse non ouverte » et le lien « Ouvrir la caisse ». Mobile money, virement et chèque n’en dépendent pas.',
      },
      {
        kind: 'steps',
        title: 'Imprimer les reçus et la facture',
        items: [
          'Après un encaissement, le reçu s’affiche sous la facture. Pour un reçu plus ancien, cliquez sur « Voir le reçu » dans « Encaissements et reçus ».',
          'Cliquez sur « Aperçu du reçu (PDF) », puis sur « Imprimer » : le PDF s’ouvre, imprimez-le avec Ctrl+P.',
          'Pour la facture : section « Document de la facture », bouton « Aperçu de la facture (PDF) ». « Réimprimer la facture » redonne la même pièce.',
        ],
      },
      {
        kind: 'note',
        tone: 'warning',
        text: 'Tant que le cabinet n’a pas validé ses mentions officielles, l’écran affiche « Document de test » et les PDF portent « DOCUMENT DE TEST ». Ne les remettez pas comme pièces officielles.',
      },
      {
        kind: 'points',
        title: 'À retenir',
        items: [
          'Une facture émise ne se modifie plus : elle garde l’identité du patient et les prix du jour de l’émission (« Patient (identité figée à l’émission) »).',
          'Un numéro n’est jamais réutilisé et un reçu n’est jamais renuméroté.',
          'Un brouillon inutile s’abandonne avec « Abandonner le brouillon » : il n’a pas de numéro.',
          'Une erreur sur une facture émise se corrige par une pièce de correction, jamais en modifiant la facture.',
          'Pour les frais d’examen, créez la facture depuis la visite dans « Aujourd’hui » : elle reste rattachée à cette visite.',
        ],
      },
      {
        kind: 'faq',
        title: 'Si ça ne se passe pas comme prévu',
        items: [
          {
            q: 'La connexion a coupé pendant l’encaissement, ou j’ai cliqué deux fois. Je recommence ?',
            a: 'Non. L’écran affiche « Enregistrement non confirmé ». Cliquez sur « Réessayer l’encaissement » : la même demande repart, sans second encaissement. « Relire la facture » montre si le reçu existe déjà.',
          },
          {
            q: 'L’écran dit « Le montant dépasse le reste à encaisser ».',
            a: 'Un autre encaissement a eu lieu entre-temps. L’écran donne le reste exact : saisissez ce montant.',
          },
          {
            q: 'L’émission est refusée avec « Stock insuffisant ».',
            a: 'Il manque un article géré en stock. Réduisez la quantité ou retirez la ligne, puis prévenez la gérante.',
          },
        ],
      },
    ],
    related: [
      {
        topic: 'parcours-caisse',
        label: 'Ouvrir et clôturer la caisse',
        why: 'Les encaissements en espèces en ont besoin.',
      },
      { topic: 'parcours-devis', label: 'Proposer un devis avant la facture' },
      { topic: 'parcours-remise-article', label: 'Remettre les articles au patient' },
      {
        topic: 'parcours-correction',
        label: 'Corriger une erreur',
        why: 'Après l’émission, une facture ne se modifie plus.',
      },
      { topic: 'notion-facture', label: 'Comprendre la facture' },
      { route: 'facture-nouvelle', label: 'Nouvelle facture' },
    ],
    keywords: [
      'facture',
      'facturer',
      'vendre',
      'vente',
      'émettre',
      'brouillon',
      'acompte',
      'solde',
      'reçu',
      'encaisser',
      'encaissement',
      'remise commerciale',
      'réduction',
      'mobile money',
      'imprimer',
      'PDF',
      'caissière',
    ],
  },
  {
    id: 'parcours-devis',
    title: 'Proposer un devis',
    summary:
      'Établir un devis, le réviser, noter la réponse du client et le convertir en brouillon de facture.',
    module: 'sales',
    anyPermission: ['invoice.read'],
    audience: ['CASHIER', 'MANAGER'],
    intro:
      'Pour la caissière et la gérante. Un devis est une proposition remise au client : il ne vaut pas facture, n’enregistre aucun règlement et ne réserve aucun article. Il est facultatif : on peut facturer sans devis.',
    blocks: [
      {
        kind: 'flow',
        title: 'Du devis à la facture',
        stages: [
          {
            label: 'Brouillon',
            text: 'Vous composez le devis pour un patient ou un prospect.',
          },
          {
            label: 'Émis',
            text: 'Le devis reçoit son numéro et sa révision 1, figée.',
          },
          {
            label: 'Réponse',
            text: 'Le client accepte ou refuse. Rien n’est facturé ni encaissé.',
          },
          {
            label: 'Révision',
            text: 'Un changement crée une nouvelle révision, avec un motif.',
          },
          {
            label: 'Facture',
            text: 'La conversion crée un brouillon de facture, à émettre comme d’habitude.',
          },
        ],
      },
      {
        kind: 'steps',
        title: 'Établir et émettre le devis',
        items: [
          'Cliquez sur « Ventes et caisse », puis sur « Devis », puis sur « Nouveau devis ».',
          'Dans « Destinataire du devis », choisissez « Un patient du cabinet » et cherchez-le, ou « Un prospect sans dossier » : « Nom du prospect », puis « Continuer avec ce prospect ».',
          'Remplissez « Valable jusqu’au » (JJ/MM/AAAA, au plus tôt aujourd’hui). Sans cette date, le devis ne s’émet pas.',
          'Ajoutez les articles avec « Ajouter un article du catalogue », puis cliquez sur « Enregistrer le brouillon ».',
          'Cliquez sur « Émettre le devis » et confirmez dans la boîte « Émettre le devis ? ».',
          'Cliquez sur « Aperçu du devis (PDF) », puis sur « Imprimer ». L’application n’envoie rien au client : vous le lui remettez.',
        ],
      },
      {
        kind: 'steps',
        title: 'Noter la réponse du client ou réviser',
        items: [
          'Ouvrez le devis depuis « Devis ».',
          'Le client accepte : cliquez sur « Accepté par le client », puis sur « Enregistrer l’acceptation ».',
          'Le client refuse : cliquez sur « Refusé par le client », puis sur « Enregistrer le refus ».',
          'Le client veut un changement : cliquez sur « Réviser le devis » et modifiez les lignes.',
          'Donnez une nouvelle date « Valable jusqu’au » et un « Motif de la révision », puis cliquez sur « Enregistrer la révision ».',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Les révisions précédentes restent dans « Révisions figées » : elles se réimpriment telles qu’elles ont été remises.',
      },
      {
        kind: 'steps',
        title: 'Convertir en facture',
        items: [
          'Sur un devis émis ou accepté et encore valable, cliquez sur « Convertir en facture ».',
          'Choisissez la « Révision à convertir ». Pour un prospect, choisissez aussi le « Dossier patient qui recevra la facture ».',
          'Lisez « Prix de la révision et du catalogue actuel » : une ligne est signalée quand le prix du catalogue a changé depuis le devis.',
          'Choisissez la « Base de prix de la facture » : les prix du devis, ou les prix actuels du catalogue sans remise.',
          'Cochez « J’ai vérifié les prix de chaque ligne », puis cliquez sur « Créer le brouillon de facture ».',
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Un brouillon de facture s’ouvre, lié au devis. Vérifiez-le, émettez-le, puis encaissez comme dans le parcours de vente. Aucun paiement n’a été enregistré par la conversion.',
      },
      {
        kind: 'points',
        title: 'À retenir',
        items: [
          'Le devis ne vaut pas facture : l’écran le rappelle par « Devis — ne vaut pas facture. »',
          'Un devis expiré ne s’accepte ni ne se convertit. Révisez-le pour lui donner une nouvelle date.',
          'Un devis refusé se révise, mais ne se convertit pas.',
          'Un devis converti ne se convertit qu’une fois : « Ouvrir la facture existante » vous y mène. Si ce brouillon est abandonné, la conversion redevient possible.',
          'Un prospect n’a pas de dossier : créez la fiche du patient avant de convertir.',
          'L’état se lit dans la liste : « Brouillon », « Émis », « Accepté par le client », « Refusé par le client », « Expiré » ou « Converti en facture ».',
        ],
      },
    ],
    related: [
      {
        topic: 'parcours-vente',
        label: 'Vendre : de la facture au reçu',
        why: 'Pour émettre et encaisser la facture née du devis.',
      },
      {
        topic: 'parcours-accueillir',
        label: 'Accueillir un patient, de la recherche à la file du jour',
      },
      { topic: 'notion-facture', label: 'Comprendre la facture' },
      { route: 'devis', label: 'Devis' },
      { route: 'devis-nouveau', label: 'Nouveau devis' },
    ],
    keywords: [
      'devis',
      'proposition',
      'estimation',
      'prospect',
      'révision',
      'accepté',
      'refusé',
      'convertir',
      'conversion',
      'valable jusqu’au',
    ],
  },
  {
    id: 'parcours-remise-article',
    title: 'Remettre les articles au patient',
    summary:
      'Remettre tout ou partie des articles d’une facture émise, avec leur lot, et savoir quand l’accord de la gérante est nécessaire.',
    module: 'sales',
    anyPermission: ['delivery.confirm'],
    audience: ['CASHIER', 'MANAGER'],
    intro:
      'Pour la caissière et la gérante. La remise se fait sur la facture émise, dans la section « Remise au patient ». Elle fait sortir l’article du stock ; elle ne change ni la facture ni ses reçus.',
    blocks: [
      {
        kind: 'flow',
        title: 'Une remise au patient, en quatre temps',
        stages: [
          {
            label: 'Émission',
            text: 'Les articles en stock sont réservés pour cette vente.',
          },
          {
            label: 'Remise',
            text: 'Vous indiquez ce qui part maintenant : tout, ou une partie.',
          },
          {
            label: 'Stock',
            text: 'L’article sort du stock, avec son lot s’il en a un.',
          },
          {
            label: 'Reste',
            text: 'Ce qui n’est pas remis reste à remettre, jusqu’à la remise complète.',
          },
        ],
      },
      {
        kind: 'steps',
        title: 'Remettre tout ou partie des articles',
        items: [
          'Ouvrez la facture dans « Factures » et descendez à « Remise au patient ». Chaque ligne indique le facturé, le remis et le « reste à remettre ».',
          'Cliquez sur « Remettre au patient ».',
          'Dans « Quantité remise », gardez la quantité proposée (tout le reste) ou saisissez moins. Laissez vide une ligne à remettre plus tard.',
          'Cliquez sur « Confirmer la remise ». L’écran répond « Remise enregistrée sur le serveur » et ajoute la remise à « Remises enregistrées », avec la date, la personne et le lot.',
          'Pour le reste, recommencez plus tard de la même façon, jusqu’à « Tous les articles sont remis ».',
        ],
      },
      {
        kind: 'steps',
        title: 'Remettre avant le règlement complet',
        items: [
          'Quand il reste à encaisser, l’écran affiche « Remise avant règlement complet » avec le reste à encaisser.',
          'Caissière : cliquez sur « Demander l’autorisation de remise », écrivez le « Motif de la demande », puis cliquez sur « Envoyer la demande à la gérante ».',
          'La gérante accorde la demande dans « Paramètres », « Autorisations », avec « Accorder ».',
          'Gardez la remise ouverte à l’écran. Après l’accord, cliquez sur « Confirmer la remise » (le bouton a remplacé la demande), avec les mêmes quantités.',
          'Gérante : cliquez directement sur « Confirmer la remise », sans demande.',
        ],
      },
      {
        kind: 'note',
        tone: 'warning',
        text: 'L’accord porte sur le reste à encaisser et sur les quantités exactes. Si un encaissement ou une quantité change, ou si la gérante n’a pas encore décidé, l’écran refuse : attendez sa décision ou refaites une demande.',
      },
      {
        kind: 'points',
        title: 'À savoir',
        items: [
          'Les articles en stock sont pris sur la réserve de cette vente, en commençant par le lot qui expire le plus tôt.',
          'Un lot expiré ou en quarantaine ne se remet pas : l’écran refuse la ligne, voyez la gérante.',
          'Si l’écran dit « Aucune réserve ouverte », l’article n’est plus réservé pour cette vente : voyez la gérante.',
          'Une facture de prestations seulement n’a rien à remettre : l’écran le dit.',
          'Une remise confirmée ne se modifie pas. Une erreur se corrige par un retour, que la gérante enregistre.',
        ],
      },
    ],
    related: [
      { topic: 'parcours-vente', label: 'Vendre : de la facture au reçu' },
      {
        topic: 'parcours-correction',
        label: 'Corriger une erreur',
        why: 'Un article rapporté se traite par un retour.',
      },
      { topic: 'parcours-stock', label: 'Suivre le stock' },
      { topic: 'notion-stock', label: 'Comprendre le stock' },
      { topic: 'notion-approbations', label: 'Comprendre les autorisations de la gérante' },
      { route: 'factures', label: 'Factures' },
    ],
    keywords: [
      'remise',
      'remettre',
      'livraison',
      'livrer',
      'retrait de commande',
      'donner les lunettes',
      'lot',
      'reste à remettre',
      'partielle',
      'totale',
    ],
  },
  {
    id: 'parcours-correction',
    title: 'Corriger une erreur',
    summary:
      'Choisir le bon geste selon l’erreur : abandon, annulation de visite, contre-écriture, avoir, remboursement ou retour.',
    module: 'sales',
    anyPermission: ['invoice.read', 'payment.collect', 'cash.own_session', 'exam_fee.collect'],
    audience: ['MANAGER', 'CASHIER'],
    intro:
      'Pour la gérante, qui exécute les corrections, et pour la caissière, qui les demande. Rien ne se supprime : un paiement, un reçu et une facture émise restent tels qu’ils ont été émis. Chaque erreur a sa propre pièce de correction.',
    blocks: [
      {
        kind: 'flow',
        title: 'De l’erreur à la pièce de correction',
        stages: [
          {
            label: 'Constater',
            text: 'Repérez l’erreur : un montant, une ligne, un patient ou un article.',
          },
          {
            label: 'Choisir',
            text: 'Prenez le geste du tableau ci-dessous : il dépend de l’erreur.',
          },
          {
            label: 'Demander',
            text: 'La caissière demande l’autorisation ; la gérante exécute.',
          },
          {
            label: 'Pièce',
            text: 'Une pièce liée est créée, avec son motif et son numéro.',
          },
          {
            label: 'Original',
            text: 'Le paiement, le reçu et la facture restent tels qu’émis.',
          },
        ],
      },
      {
        kind: 'table',
        title: 'Quel geste pour quelle erreur ?',
        head: ['Situation', 'Geste', 'Où', 'Qui'],
        rows: [
          [
            'Brouillon devenu inutile',
            '« Abandonner le brouillon » : ni numéro, ni effet financier',
            'Fiche du brouillon',
            'Qui l’a créé, ou la gérante',
          ],
          [
            'Visite enregistrée par erreur, avant l’examen',
            '« Annuler la visite », avec un motif',
            '« Aujourd’hui »',
            'L’accueil',
          ],
          [
            'Encaissement saisi à tort (mauvais montant, saisi deux fois)',
            '« Contre-passer le paiement » : une contre-écriture',
            'Facture, « Corrections de la facture »',
            'La gérante',
          ],
          [
            'Vente à réduire après l’émission (remise accordée après coup, article non fourni)',
            '« Émettre un avoir »',
            'Facture, « Corrections de la facture »',
            'La gérante',
          ],
          [
            'Argent à rendre au patient',
            '« Rembourser » le crédit d’un avoir',
            'Facture, « Corrections de la facture »',
            'La gérante',
          ],
          [
            'Article rapporté par le patient',
            '« Enregistrer un retour » : ni avoir, ni argent rendu',
            'Facture, « Remise au patient »',
            'La gérante',
          ],
        ],
      },
      {
        kind: 'steps',
        title: 'Contre-passer un encaissement saisi à tort',
        items: [
          'Ouvrez la facture. Dans « Corrections de la facture », cliquez sur « Contre-passer le paiement », suivi du numéro du reçu.',
          'Saisissez le « Montant à contre-passer » (au plus la part encore contre-passable) et le « Motif (obligatoire) ».',
          'Cliquez sur « Enregistrer la contre-écriture ». Si l’écran demande votre mot de passe, confirmez-le.',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'L’écran affiche « Correction enregistrée ». Le reçu d’origine garde son numéro. Si le bon montant n’a pas été encaissé, faites un nouvel encaissement.',
      },
      {
        kind: 'steps',
        title: 'Réduire une vente, puis rendre l’argent',
        items: [
          'Cliquez sur « Émettre un avoir ». Pour chaque ligne concernée, saisissez le « Montant à créditer sur » cette ligne, au plus son montant.',
          'Écrivez le « Motif (obligatoire) », puis cliquez sur « Émettre l’avoir ». L’avoir a son numéro et son « PDF de l’avoir ».',
          'Pour rendre l’argent, cliquez sur « Rembourser » sous l’avoir. Saisissez le « Montant remboursé » (au plus le crédit) et choisissez le « Mode de remboursement ».',
          'Mobile money ou virement : saisissez la référence. Espèces : une caisse doit être ouverte, la sortie compte dans le tiroir.',
          'Cliquez sur « Enregistrer le remboursement ». Il a son numéro et son « PDF du remboursement ».',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Un avoir réduit le reste à encaisser. S’il dépasse ce qui restait, « Crédit en faveur du patient » apparaît : c’est la somme remboursable. Un avoir ne touche pas au stock.',
      },
      {
        kind: 'steps',
        title: 'Quand le patient rapporte un article',
        items: [
          'Sur la facture, section « Remise au patient », cliquez sur « Enregistrer un retour » sous la ligne remise.',
          'Saisissez la « Quantité retournée », l’« État constaté » et le « Motif (obligatoire) ».',
          'Cochez « Remettre en stock vendable » seulement pour un article « Intact, vendable » : il retourne dans son lot d’origine.',
          'Cliquez sur « Enregistrer le retour ».',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Un retour ne crée pas d’avoir et ne rend pas d’argent. Pour rembourser le patient, émettez ensuite l’avoir, puis le remboursement.',
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Visite enregistrée par erreur : cliquez sur « Annuler la visite » dans « Aujourd’hui » et écrivez le « Motif de l’annulation (obligatoire) », une information d’accueil, jamais médicale. La visite reste dans la file, marquée annulée. Elle ne s’annule pas si l’examen a démarré ou si elle porte une facture.',
      },
      {
        kind: 'points',
        title: 'Si vous êtes caissière',
        items: [
          'Vous voyez les mêmes formulaires, mais le bouton devient « Demander l’autorisation » : rien n’est exécuté.',
          'Envoyez la demande avec son motif. La gérante fait ensuite la correction elle-même, depuis la facture.',
        ],
      },
      {
        kind: 'points',
        title: 'À retenir',
        items: [
          'Aucun bouton ne supprime un paiement, un reçu ou une facture émise.',
          'Chaque correction demande un motif. La gérante confirme son mot de passe dans la boîte « Confirmer votre mot de passe ».',
          'Pour refaire une facture émise, la gérante émet un avoir sur ses lignes, puis vous créez la bonne facture : elle aura son propre numéro.',
        ],
      },
    ],
    related: [
      { topic: 'parcours-vente', label: 'Vendre : de la facture au reçu' },
      { topic: 'parcours-remise-article', label: 'Remettre les articles au patient' },
      {
        topic: 'parcours-stock',
        label: 'Suivre le stock',
        why: 'Casse, ajustement et retours en stock.',
      },
      { topic: 'notion-approbations', label: 'Comprendre les autorisations de la gérante' },
      {
        route: 'approbations',
        label: 'Approbations',
        why: 'Pour décider les demandes de l’équipe.',
      },
      { topic: 'depannage-messages', label: 'Comprendre les messages de l’application' },
    ],
    keywords: [
      'correction',
      'erreur',
      'annuler',
      'supprimer',
      'effacer',
      'contre-écriture',
      'avoir',
      'remboursement',
      'rembourser',
      'retour',
      'abandon',
      'annulation de visite',
      'mauvais montant',
    ],
  },
  {
    id: 'parcours-caisse',
    title: 'Tenir la caisse',
    summary:
      'Ouvrir la session avec le fond de caisse, noter les dépenses, clôturer avec le comptage, puis lire la caisse du jour et les relevés.',
    module: 'sales',
    anyPermission: ['cash.own_session', 'cash.manage', 'finance.global.read'],
    audience: ['CASHIER', 'MANAGER'],
    intro:
      'Pour la caissière, qui tient sa session, et pour la gérante, qui voit toutes les sessions. Un encaissement en espèces ne s’enregistre que dans une session ouverte par le compte qui encaisse. Mobile money, virement et chèque ne passent pas par le tiroir.',
    blocks: [
      {
        kind: 'flow',
        title: 'Une journée de caisse',
        stages: [
          {
            label: 'Ouverture',
            text: 'Vous comptez le tiroir et saisissez le fond de caisse.',
          },
          {
            label: 'Journée',
            text: 'Chaque encaissement en espèces s’ajoute aux espèces attendues. Dépenses et dépôts se notent à part.',
          },
          {
            label: 'Clôture',
            text: 'Vous comptez le tiroir. L’écart est dit sans jugement ; s’il y en a un, il demande un motif.',
          },
          {
            label: 'Contrôle',
            text: 'La caisse du jour et les relevés PDF résument la journée ; la gérante revoit les écarts.',
          },
        ],
      },
      {
        kind: 'steps',
        title: 'Ouvrir la caisse',
        items: [
          'Cliquez sur « Caisse » sur l’accueil, ou sur « Ventes et caisse », puis sur « Caisse ».',
          'Comptez les espèces du tiroir. S’il y a plusieurs caisses, choisissez la « Caisse ».',
          'Saisissez ce montant dans « Fond de caisse » (0 si le tiroir est vide), puis cliquez sur « Ouvrir la caisse ».',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'L’écran affiche « Session ouverte » et les « Espèces attendues dans le tiroir » : fond de caisse + espèces encaissées − remboursements en espèces ± dépenses et mouvements autorisés. Les autres modes n’y figurent pas.',
      },
      {
        kind: 'steps',
        title: 'Noter une dépense ou un mouvement d’espèces',
        items: [
          'Sous la session ouverte, dans « Dépenses et mouvements de caisse », choisissez la « Nature » : une dépense (première de la liste), « Retrait (versement, coffre) », « Dépôt (entrée d’espèces) » ou « Correction de l’ouverture ».',
          'Saisissez le « Montant (FCFA) » et le « Motif ». Pour une dépense, choisissez aussi la « Catégorie de la dépense ».',
          'Si vous l’avez, saisissez la « Référence du justificatif (facultatif) » : numéro du bon, de la facture du fournisseur ou du bordereau.',
          'Caissière : cliquez sur « Demander l’autorisation » et envoyez la demande. Après l’accord de la gérante, cliquez sur « Enregistrer le mouvement », avec le même montant.',
          'Gérante : cliquez directement sur « Enregistrer le mouvement ».',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Un mouvement n’est jamais le paiement d’un patient : ni facture, ni reçu. Une sortie ne peut pas dépasser les espèces attendues. Aucune catégorie ? La gérante les crée dans « Catégories de dépenses ».',
      },
      {
        kind: 'steps',
        title: 'Clôturer la caisse',
        items: [
          'Comptez le tiroir.',
          'Saisissez le « Montant compté dans le tiroir ». L’écran affiche l’« Écart » et le décrit : aucun écart, compté supérieur ou compté inférieur à l’attendu.',
          'S’il y a un écart, remplissez le « Motif de l’écart ». Sans motif, la clôture est refusée.',
          'Cliquez sur « Clôturer la caisse », puis confirmez dans la boîte « Clôturer la session de caisse ? ».',
          'Cliquez sur « Relevé de clôture (PDF) » pour imprimer le relevé de la session.',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'L’écran affiche « Session de caisse clôturée ». Elle est figée : plus aucun encaissement en espèces n’y est admis. En cours de journée, « Relevé provisoire (PDF) » donne le relevé de la session ouverte.',
      },
      {
        kind: 'note',
        tone: 'warning',
        text: 'Si l’écran dit « Les espèces attendues ont changé depuis l’affichage », un encaissement en espèces est arrivé pendant votre comptage. Votre montant compté est conservé : recomptez, puis clôturez de nouveau.',
      },
      {
        kind: 'steps',
        title: 'Lire la caisse du jour',
        items: [
          'Cliquez sur « Caisse du jour » depuis « Caisse », ou sur « Voir la caisse du jour » sous la tuile « Encaissé net » de l’accueil.',
          'Pour un autre jour, choisissez le « Jour » puis cliquez sur « Afficher ». « Aujourd’hui » revient à la date du jour.',
          'Lisez « Encaissements nets par mode », puis « Espèces (tiroir) », « Autres modes (rapprochés à part) » et « Total net encaissé ».',
          'Dans « Sessions de caisse du jour », cliquez sur « Relevé (PDF) » pour imprimer le relevé d’une session.',
        ],
      },
      {
        kind: 'points',
        title: 'Ce que chacune voit',
        items: [
          'Caissière : vos encaissements et vos sessions seulement.',
          'Gérante : tout le cabinet, plus « Ventes du jour et reste à encaisser » : factures et avoirs émis ce jour, et « Reste à encaisser (factures ouvertes) » de toutes les dates.',
          'Une ancienne facture dont le reste est encaissé aujourd’hui augmente les encaissements d’aujourd’hui, mais n’est pas une vente d’aujourd’hui.',
        ],
      },
      {
        kind: 'steps',
        title: 'La gérante : suivre toutes les sessions',
        items: [
          'Sur l’écran « Caisse », la section « Sessions de toutes les caisses » liste les sessions, les ouvertes d’abord.',
          'Session restée ouverte chez une autre caissière : cliquez sur « Clôturer cette session », saisissez le compté, puis cliquez sur « Clôturer la session ».',
          'Session clôturée avec un écart : cliquez sur « Revoir l’écart », choisissez « Accepter l’écart (motif jugé suffisant) » ou « Contester l’écart (à éclaircir) », puis « Enregistrer la revue ».',
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Contester demande une note de 3 caractères au moins. La revue s’ajoute à la clôture : la session clôturée, elle, ne change pas.',
      },
    ],
    related: [
      { topic: 'parcours-vente', label: 'Vendre : de la facture au reçu' },
      { topic: 'notion-caisse', label: 'Comprendre la session de caisse et l’écart' },
      { topic: 'guide-caisse', label: 'Le guide de la caissière' },
      { topic: 'guide-gerante', label: 'Le guide de la gérante' },
      { route: 'caisse', label: 'Caisse' },
      { route: 'caisse-du-jour', label: 'Caisse du jour' },
    ],
    keywords: [
      'caisse',
      'session',
      'ouvrir la caisse',
      'fond de caisse',
      'tiroir',
      'clôture',
      'clôturer',
      'écart',
      'comptage',
      'dépense',
      'retrait',
      'dépôt',
      'caisse du jour',
      'relevé',
      'espèces',
    ],
  },
  {
    id: 'parcours-stock',
    title: 'Suivre le stock',
    summary:
      'Saisir le stock d’ouverture, lire les disponibilités, enregistrer une casse ou un ajustement et comprendre l’effet des retours.',
    module: 'stock',
    anyPermission: ['stock.read'],
    audience: ['MANAGER', 'CASHIER'],
    intro:
      'Pour la gérante, qui saisit et corrige le stock, et pour qui consulte les disponibilités avant de vendre. On y accède par « Ventes et caisse », carte « Stock ». Seuls les articles dont le « Mode de stock » est « Article géré en stock » sont suivis.',
    blocks: [
      {
        kind: 'flow',
        title: 'Le chemin d’un article',
        stages: [
          {
            label: 'Ouverture',
            text: 'La gérante saisit le stock compté : un mouvement par ligne.',
          },
          {
            label: 'Vente',
            text: 'À l’émission, la quantité vendue passe en « Réservé ». Le « Physique » ne bouge pas.',
          },
          {
            label: 'Remise',
            text: 'À la remise au patient, l’article sort : « Physique » et « Réservé » baissent.',
          },
          {
            label: 'Retour',
            text: 'Un article rapporté intact peut revenir en stock vendable.',
          },
          {
            label: 'Casse',
            text: 'Une perte ou un écart de comptage se note à part, avec un motif.',
          },
        ],
      },
      {
        kind: 'steps',
        title: 'Saisir le stock d’ouverture (gérante)',
        items: [
          'Ouvrez « Stock » et allez à la section « Stock initial ».',
          'Cliquez sur « Ajouter une ligne », puis choisissez l’« Article géré en stock » et l’« Emplacement ».',
          'Saisissez la « Quantité comptée ». Pour un article périssable, ajoutez le « Numéro de lot » et la « Date d’expiration ».',
          'Autre voie : « Télécharger le modèle de stock initial », remplissez-le, puis « Remplir depuis un fichier CSV (facultatif) ». Rien n’est enregistré à cette étape.',
          'Écrivez le « Motif du comptage », relisez, puis cliquez sur « Enregistrer le stock initial ». Votre mot de passe peut être demandé.',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Le stock initial d’un article dans un emplacement ne s’enregistre qu’une fois. Un coût d’achat inconnu reste vide, jamais 0.',
      },
      {
        kind: 'points',
        title: 'Lire les disponibilités',
        items: [
          'Chaque article affiche « Physique », « Réservé » et « Disponible » (le physique moins le réservé), avec ses lots.',
          'En facturant, une ligne indique « Disponible en stock (lecture du serveur) » pour l’article choisi.',
          'Le lot qui expire le plus tôt part en premier. Un lot expiré ou « en quarantaine (jamais réservé) » ne se vend pas.',
          'La colonne « Quotas des postes » concerne une fonction pas encore ouverte : elle ne vous concerne pas pour l’instant.',
        ],
      },
      {
        kind: 'steps',
        title: 'Enregistrer une casse ou un ajustement (gérante)',
        items: [
          'Dans « Stock », cliquez sur « Casse ou ajustement ».',
          'Choisissez l’« Article », l’« Emplacement » et, s’il y en a, le « Lot ».',
          'Choisissez la « Nature » : « Casse ou perte (sortie du stock) » ou « Ajustement après comptage ». Pour un ajustement, choisissez aussi le « Sens de l’ajustement ».',
          'Saisissez la « Quantité » et le « Motif (obligatoire) », puis cliquez sur « Enregistrer le mouvement ».',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Une sortie ne dépasse pas le disponible affiché : la marchandise réservée pour une vente ne se retire pas.',
      },
      {
        kind: 'points',
        title: 'Retours',
        items: [
          'Un article rapporté par un patient se traite sur la facture, avec « Enregistrer un retour ». Seul un article « Intact, vendable » revient en stock vendable.',
          'Un avoir seul ne remet rien en stock.',
        ],
      },
      {
        kind: 'note',
        tone: 'warning',
        text: 'Pas encore disponible : fournisseurs, réceptions de marchandise, inventaire complet, alertes de stock bas ou de péremption, valeur du stock. Le stock évolue par le stock initial, les remises, les retours et les ajustements.',
      },
      {
        kind: 'faq',
        title: 'Si ça ne marche pas',
        items: [
          {
            q: 'L’écran dit « Aucun emplacement de stock ».',
            a: 'L’emplacement se crée à la mise en service du cabinet. Prévenez la gérante, qui contacte l’exploitant.',
          },
          {
            q: 'L’écran dit « Aucun stock enregistré ».',
            a: 'Le stock initial n’a pas encore été saisi : la gérante le saisit dans la section « Stock initial ».',
          },
        ],
      },
    ],
    related: [
      { topic: 'parcours-remise-article', label: 'Remettre les articles au patient' },
      {
        topic: 'parcours-correction',
        label: 'Corriger une erreur',
        why: 'Pour un article rapporté par un patient.',
      },
      { topic: 'notion-stock', label: 'Comprendre le stock' },
      { route: 'stock', label: 'Stock' },
      { route: 'stock-movement', label: 'Casse ou ajustement' },
      {
        route: 'catalogue',
        label: 'Catalogue',
        why: 'Pour régler le mode de stock d’un article.',
      },
    ],
    keywords: [
      'stock',
      'inventaire',
      'disponible',
      'réservé',
      'stock initial',
      'casse',
      'ajustement',
      'lot',
      'péremption',
      'collyre',
      'comptage',
      'emplacement',
      'retour',
    ],
  },
  {
    id: 'parcours-gestion',
    title: 'Gérer le cabinet',
    summary:
      'Le travail de la gérante : comptes du personnel, cabinet et documents, catalogue et taxes, autorisations, chiffres, exports et rythme de contrôle.',
    module: 'settings',
    anyPermission: ['users.manage', 'approval.decide'],
    audience: ['MANAGER'],
    intro:
      'Pour la gérante seulement. Les écritures sensibles redemandent votre mot de passe : l’écran affiche « Confirmer votre mot de passe ». Confirmez : votre saisie est conservée et l’enregistrement reprend, sans doublon.',
    blocks: [
      {
        kind: 'flow',
        title: 'Le travail de la gérante',
        stages: [
          {
            label: 'Mettre en place',
            text: 'Comptes du personnel, cabinet et documents, catalogue, taxes.',
          },
          {
            label: 'Décider',
            text: 'Les demandes d’autorisation de l’équipe, une par une.',
          },
          {
            label: 'Corriger',
            text: 'Contre-écritures, avoirs, remboursements, casse et ajustements.',
          },
          {
            label: 'Suivre',
            text: 'Caisse du jour, sessions, stock, statistiques.',
          },
          {
            label: 'Conserver',
            text: 'Exports de données, rangés en lieu sûr.',
          },
        ],
      },
      {
        kind: 'table',
        title: 'Où faire quoi',
        head: ['Tâche', 'Où', 'À savoir'],
        rows: [
          [
            'Créer ou modifier un compte',
            '« Paramètres », « Personnel »',
            'Un compte ne se supprime pas : il se désactive, avec un motif. Un droit exceptionnel passe par « Dérogation de droit ».',
          ],
          [
            'Régler le cabinet et les documents',
            '« Paramètres », « Cabinet et documents »',
            'Une facture déjà émise garde l’identité de son émission.',
          ],
          [
            'Tenir les articles et les prix',
            '« Ventes et caisse », « Catalogue »',
            'Un changement de prix ne touche pas les factures émises.',
          ],
          [
            'Saisir les taxes',
            '« Ventes et caisse », « Règles fiscales »',
            'Aucune taxe n’est proposée : le taux vient du comptable.',
          ],
          [
            'Importer des articles ou les créances de l’ancien carnet',
            '« Catalogue », « Importer un fichier CSV »',
            'Tout est importé, ou rien si une ligne est à corriger. Les créances sont dans « Créances papier ».',
          ],
          [
            'Décider les demandes de l’équipe',
            '« Paramètres », « Autorisations »',
            'Une autorisation vaut pour une opération précise, une seule fois.',
          ],
          [
            'Exécuter les corrections',
            'Fiche de la facture',
            'Contre-écriture, avoir, remboursement, retour.',
          ],
          [
            'Lire les chiffres',
            '« Caisse du jour », « Statistiques »',
            'Les statistiques comptent les patients et les examens, pas les ventes.',
          ],
          [
            'Conserver les données',
            '« Paramètres », « Exports »',
            'L’archive reste disponible 48 heures : rangez-la en lieu sûr.',
          ],
        ],
      },
      {
        kind: 'steps',
        title: 'Créer le compte d’une nouvelle personne',
        items: [
          'Ouvrez « Paramètres », puis « Personnel », puis cliquez sur « Créer un compte ».',
          'Saisissez le « Nom affiché » et l’« Identifiant de connexion » (minuscules sans accent, par exemple marie.ngono).',
          'Cochez un ou plusieurs « Profils » : « Gérante », « Accueil », « Professionnel (examen) » ou « Caisse ».',
          'Cliquez sur « Générer un mot de passe », puis sur « Créer le compte ». Confirmez votre mot de passe.',
          'Notez le mot de passe initial : il n’est affiché qu’une fois. Remettez-le en personne, puis cliquez sur « J’ai noté, ouvrir le compte ».',
          'La personne se connecte, puis change ce mot de passe avec « Changer mon mot de passe ».',
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Un départ ou un mot de passe perdu : ouvrez le compte. Décochez « Compte actif » (motif obligatoire) puis cliquez sur « Enregistrer le compte », ou cliquez sur « Réinitialiser le mot de passe ». Le mot de passe d’une gérante ne se réinitialise pas depuis l’application.',
      },
      {
        kind: 'note',
        tone: 'warning',
        text: 'Tant que l’écran « Cabinet et documents » affiche « Documents de test », chaque document porte « DOCUMENT DE TEST ». L’activation des documents officiels ne se fait pas depuis cet écran. Tant qu’aucune règle fiscale n’est active et validée, les factures portent « aucune taxe configurée ».',
      },
      {
        kind: 'table',
        title: 'Votre rythme (un repère, l’application ne l’impose pas)',
        head: ['Quand', 'Quoi', 'Où'],
        rows: [
          [
            'Chaque matin',
            'Lire les chiffres du jour et la file des patients',
            'Accueil, bandeau « Aujourd’hui »',
          ],
          [
            'Dans la journée',
            'Décider les demandes « En attente »',
            '« Paramètres », « Autorisations »',
          ],
          [
            'Chaque soir',
            'Vérifier que les sessions sont clôturées, revoir les écarts',
            '« Caisse », « Sessions de toutes les caisses »',
          ],
          ['Chaque soir', 'Lire le total net encaissé', '« Caisse du jour »'],
          [
            'Chaque semaine',
            'Repérer les factures encore ouvertes',
            '« Factures », « Caisse du jour »',
          ],
          ['Chaque semaine', 'Contrôler les disponibilités et les lots', '« Stock »'],
          ['Chaque semaine', 'Lancer un export et le ranger en lieu sûr', '« Exports »'],
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Pas encore disponible : rapports financiers sur une période, export au format attendu par le comptable, rapprochement des paiements mobile money et virements.',
      },
    ],
    related: [
      { topic: 'guide-gerante', label: 'Le guide de la gérante' },
      { topic: 'notion-approbations', label: 'Comprendre les autorisations de la gérante' },
      { topic: 'premiere-configuration', label: 'Première configuration du cabinet' },
      { topic: 'exploitation', label: 'Exploitation' },
      { route: 'parametres', label: 'Paramètres' },
      { route: 'catalogue', label: 'Catalogue' },
    ],
    keywords: [
      'gérante',
      'compte',
      'utilisateur',
      'mot de passe',
      'profil',
      'droits',
      'cabinet',
      'documents',
      'catalogue',
      'prix',
      'taxe',
      'import',
      'autorisation',
      'approbation',
      'statistiques',
      'export',
      'sauvegarde',
    ],
  },
]
