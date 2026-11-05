import type { PageHelp } from '../model'

/**
 * Aide de l’écran « Facture » (module sales) : lire, encaisser, imprimer, remettre les articles,
 * enregistrer un retour et corriger (contre-écriture, avoir, remboursement).
 */
export const PAGES_FACTURE_DETAIL: readonly PageHelp[] = [
  {
    route: 'facture',
    title: 'Facture',
    module: 'sales',
    anyPermission: ['invoice.read'],
    purpose:
      'Voici une facture et tout ce qu’on y fait : lire ses montants, encaisser un acompte ou le reste, imprimer la facture et les reçus, remettre les articles au patient, puis corriger une erreur. Une facture émise ne se modifie plus.',
    actions: [
      {
        label: 'Encaisser',
        effect:
          'Enregistre le montant saisi et crée aussitôt son reçu numéroté. Le bouton rappelle le montant saisi.',
        anyPermission: ['payment.collect', 'exam_fee.collect'],
      },
      {
        label: 'Encaisser le reste',
        effect: 'Remplit « Montant encaissé » avec tout le reste à encaisser.',
        anyPermission: ['payment.collect', 'exam_fee.collect'],
      },
      {
        label: 'Nouvel encaissement',
        effect: 'Rouvre le formulaire après un reçu, pour un second règlement.',
        anyPermission: ['payment.collect', 'exam_fee.collect'],
      },
      {
        label: 'Voir le reçu',
        effect:
          'Déplie le reçu d’un encaissement, avec « Aperçu du reçu (PDF) » ; « Masquer le reçu » le replie.',
      },
      {
        label: 'Aperçu de la facture (PDF)',
        effect:
          'Produit le PDF de la facture à imprimer ou télécharger ; le bouton devient « Réimprimer la facture ».',
      },
      {
        label: 'Remettre au patient',
        effect:
          'Ouvre le formulaire de remise des articles, en totalité ou en partie. Les articles sortent du stock à la confirmation.',
        anyPermission: ['delivery.confirm'],
      },
      {
        label: 'Enregistrer un retour',
        effect:
          'Ouvre, sous une ligne déjà remise, le formulaire de retour de l’article. Aucun avoir n’est créé.',
        anyPermission: ['stock.adjust'],
      },
      {
        label: 'Émettre un avoir',
        effect:
          'Ouvre le formulaire d’avoir, qui réduit la vente sans modifier la facture. La caissière l’envoie en demande à la gérante.',
        anyPermission: ['credit_note.issue', 'approval.request'],
      },
      {
        label: 'Contre-passer le paiement …',
        effect:
          'Ouvre le formulaire de contre-écriture d’un encaissement saisi à tort ; le reçu d’origine reste tel quel.',
        anyPermission: ['payment.reverse', 'approval.request'],
      },
      {
        label: 'Rembourser',
        effect:
          'Ouvre, sous un avoir, le formulaire de remboursement quand il reste un crédit à rendre au patient.',
        anyPermission: ['refund.execute', 'approval.request'],
      },
    ],
    tasks: [
      {
        id: 'lire-la-facture',
        title: 'Lire la facture et ce qui reste à encaisser',
        steps: [
          'Lisez l’état « Émise » sous le titre « Facture » : la phrase « elle ne se modifie plus » rappelle que la facture est définitive.',
          'Vérifiez « Patient (identité figée à l’émission) » : nom et numéro de dossier sont ceux du jour de l’émission, même si la fiche patient change ensuite.',
          'Lisez le cadre des montants : « Total de la facture », « Total encaissé » et, en gras, « Reste à encaisser ».',
          '« Avoirs », « Remboursé » et « Crédit en faveur du patient » n’apparaissent que s’il y en a : ils viennent des corrections.',
          'Parcourez « Lignes (figées à l’émission) » : désignation, quantité, prix et remise éventuelle ne changent plus. « Montant de la ligne » est le total de la ligne.',
          'Sous « Encaissements et reçus », chaque encaissement montre son numéro de reçu, son montant, son mode de règlement et sa date.',
        ],
        result:
          'Vous connaissez le total encaissé, le reste à encaisser et les reçus déjà émis. Ces montants se calculent seuls : rien ne se saisit sur cette partie de l’écran.',
      },
      {
        id: 'encaisser',
        title: 'Encaisser un acompte ou le reste',
        anyPermission: ['payment.collect', 'exam_fee.collect'],
        steps: [
          'Dans le formulaire « Encaisser », lisez « Reste à encaisser » : c’est le plafond de ce que vous pouvez saisir.',
          'Saisissez le « Montant encaissé » (par exemple 30 000 sur une facture de 80 000 FCFA), ou cliquez sur « Encaisser le reste » pour tout encaisser.',
          'Dans « Mode de règlement », choisissez « Espèces », « Mobile money MTN », « Orange Money », « Virement », « Chèque » ou « Autre mode ».',
          'Pour « Mobile money MTN », « Orange Money » et « Virement », la « Référence de l’opération » est obligatoire : numéro de transaction ou de virement.',
          'En « Espèces », une session de caisse doit être ouverte à votre nom. Sinon « Caisse non ouverte » s’affiche, avec le lien « Ouvrir la caisse ».',
          'Constatez que l’argent est bien reçu, puis cliquez sur « Encaisser ». L’application n’interroge aucun opérateur de paiement : c’est vous qui constatez l’encaissement.',
          'Attendez « Encaissement enregistré sur le serveur » : le reçu s’affiche, avec « Reste à encaisser maintenant » mis à jour.',
          'Pour un second règlement, cliquez sur « Nouvel encaissement ». Plusieurs jours plus tard, rouvrez la facture depuis « Factures » : le formulaire est de nouveau là.',
        ],
        result:
          'Chaque encaissement crée son propre reçu numéroté. Il ne sera jamais renuméroté ni supprimé : une erreur se corrige par une contre-écriture. À 0 FCFA de reste à encaisser, le formulaire disparaît.',
      },
      {
        id: 'imprimer-en-pdf',
        title: 'Imprimer la facture et les reçus en PDF',
        steps: [
          'Au bas de la fiche, dans « Document de la facture », cliquez sur « Aperçu de la facture (PDF) ».',
          'Patientez pendant « Génération du PDF… » : l’aperçu des pages s’affiche avec « Ouvrir le PDF », « Imprimer » et « Télécharger le PDF ».',
          'Cliquez sur « Imprimer » : le PDF s’ouvre dans le navigateur, d’où vous imprimez avec Ctrl+P. Si le navigateur bloque l’ouverture, le PDF est téléchargé.',
          'Pour un reçu, cliquez sur « Voir le reçu » sous l’encaissement, dans « Encaissements et reçus », puis sur « Aperçu du reçu (PDF) ».',
          'Pour réimprimer, cliquez sur « Réimprimer la facture » ou « Réimprimer le reçu » : la pièce est la même, sans nouvel encaissement ni nouveau numéro.',
          'Un avoir et un remboursement ont leur propre bouton, « PDF de l’avoir » et « PDF du remboursement », dans « Corrections de la facture ».',
        ],
        result:
          'Le PDF reproduit la pièce telle qu’elle a été émise. Il n’est pas conservé après la fermeture du navigateur : rouvrez la fiche et réimprimez quand il le faut.',
      },
      {
        id: 'remettre-les-articles',
        title: 'Remettre les articles au patient',
        anyPermission: ['delivery.confirm'],
        steps: [
          'Dans « Remise au patient », lisez le « reste à remettre » de chaque ligne, puis cliquez sur « Remettre au patient ». Une prestation n’a rien à remettre.',
          'Vérifiez la « Quantité remise » de chaque ligne (par défaut, tout le reste). Réduisez-la pour une remise partielle ; videz le champ d’une ligne remise plus tard.',
          'Si la facture n’a plus de reste à encaisser, cliquez sur « Confirmer la remise ».',
          'S’il reste un montant à encaisser, « Remise avant règlement complet » s’affiche : la gérante doit autoriser ces quantités exactes.',
          'Gérante : cliquez sur « Confirmer la remise » ; l’autorisation s’enregistre alors à votre nom.',
          'Caissière : cliquez sur « Demander l’autorisation de remise », écrivez le « Motif de la demande », puis « Envoyer la demande à la gérante ».',
          'Quand la gérante a accordé la demande dans « Approbations », cliquez sur « Confirmer la remise ». Si le reste à encaisser a changé entre-temps, redemandez.',
          'Contrôlez le message « Remise enregistrée sur le serveur » puis « Remises enregistrées » : date, personne qui a remis et lot.',
        ],
        result:
          'Les articles remis sortent du stock. Pour un collyre, l’application choisit le lot qui expire le premier et refuse un lot expiré. Une remise partielle se complète plus tard, jusqu’à « Tous les articles sont remis ». Une remise confirmée ne se modifie pas : une erreur se corrige par un retour.',
      },
      {
        id: 'enregistrer-un-retour',
        title: 'Enregistrer un retour physique',
        anyPermission: ['stock.adjust'],
        steps: [
          'Dans « Remises enregistrées », cliquez sur « Enregistrer un retour » sous la ligne que le patient rapporte.',
          'Saisissez la « Quantité retournée » : au plus ce qui a été remis et n’a pas déjà été retourné.',
          'Dans le champ « État constaté », choisissez « Intact, vendable », « Abîmé », « À contrôler (quarantaine) » ou « Autre ».',
          'Cochez « Remettre en stock vendable » seulement pour un article intact : il retourne dans son emplacement et son lot d’origine.',
          'Si un avoir existe déjà pour cette vente, reliez-le avec « Avoir déjà émis à relier (facultatif) ».',
          'Écrivez le « Motif (obligatoire) » : ce que le patient rapporte et pourquoi.',
          'Cliquez sur « Enregistrer le retour ». Si « Confirmer votre mot de passe » s’affiche, saisissez-le puis cliquez sur « Confirmer et reprendre ».',
        ],
        result:
          'Le retour s’inscrit sous « Retours physiques ». Il ne crée aucun avoir et ne rend aucun argent : le remboursement éventuel passe par un avoir. Cet écran ne permet pas de modifier un retour enregistré.',
      },
      {
        id: 'emettre-un-avoir',
        title: 'Émettre un avoir',
        anyPermission: ['credit_note.issue', 'approval.request'],
        steps: [
          'Dans « Corrections de la facture », cliquez sur « Émettre un avoir ». Le bouton disparaît quand plus rien n’est créditable.',
          'Pour chaque ligne concernée, saisissez le « Montant à créditer » : au plus le montant de la ligne. Laissez vides les autres lignes.',
          'Si besoin, indiquez la « Quantité concernée (facultative) » de la ligne.',
          'Vérifiez le « Total de l’avoir » : il ne peut pas dépasser la part encore créditable de la facture, affichée au-dessus.',
          'Écrivez le « Motif (obligatoire) », par exemple une remise accordée après émission ou un article non fourni.',
          'Gérante : cliquez sur « Émettre l’avoir », puis confirmez votre mot de passe si l’écran le demande.',
          'Caissière : cliquez sur « Demander l’autorisation », écrivez le « Motif de la demande », puis « Envoyer la demande à la gérante ». La gérante émettra l’avoir elle-même.',
        ],
        result:
          'L’avoir reçoit son numéro et figure sous « Avoirs », avec « PDF de l’avoir ». La facture, ses lignes et ses reçus ne changent pas ; le reste à encaisser baisse. Au-delà, un « Crédit en faveur du patient » apparaît.',
      },
      {
        id: 'rembourser-un-avoir',
        title: 'Rembourser le crédit d’un avoir',
        anyPermission: ['refund.execute', 'approval.request'],
        steps: [
          'Sous l’avoir concerné, dans « Avoirs », cliquez sur « Rembourser ». Le bouton n’existe que s’il reste un crédit à rendre au patient.',
          'Saisissez le « Montant remboursé » : au plus le « Montant remboursable » affiché.',
          'Choisissez le « Mode de remboursement ».',
          'Pour « Mobile money MTN », « Orange Money » et « Virement », remplissez « Référence (numéro de transaction ou de virement) ».',
          'En « Espèces », une session de caisse doit être ouverte à votre nom ; la sortie compte dans les espèces attendues du tiroir.',
          'Gérante : cliquez sur « Enregistrer le remboursement », puis confirmez votre mot de passe si l’écran le demande.',
          'Caissière : cliquez sur « Demander l’autorisation » ; la gérante enregistrera le remboursement elle-même.',
        ],
        result:
          'Le remboursement reçoit son numéro, jamais renuméroté, et figure sous « Remboursements », avec « PDF du remboursement ». Il ne dépasse jamais le crédit disponible et ne modifie ni la facture, ni l’avoir, ni les reçus.',
      },
      {
        id: 'contre-passer-un-encaissement',
        title: 'Corriger un encaissement par une contre-écriture',
        anyPermission: ['payment.reverse', 'approval.request'],
        steps: [
          'Dans « Corrections de la facture », cliquez sur « Contre-passer le paiement » suivi du numéro du reçu à corriger.',
          'Saisissez le « Montant à contre-passer » : au plus la part encore contre-passable de ce paiement.',
          'Écrivez le « Motif (obligatoire) », par exemple un encaissement saisi deux fois ou un mauvais montant.',
          'Gérante : cliquez sur « Enregistrer la contre-écriture », puis confirmez votre mot de passe si l’écran le demande.',
          'Caissière : cliquez sur « Demander l’autorisation » ; la gérante fera la contre-écriture elle-même.',
          'Si le bon montant doit encore être encaissé, encaissez-le ensuite : le reste à encaisser a remonté.',
        ],
        result:
          '« Correction enregistrée » s’affiche et la contre-écriture figure sous « Contre-écritures ». Le paiement et son reçu restent tels qu’émis, avec leur numéro : le « Total encaissé » baisse, le « Reste à encaisser » remonte.',
      },
    ],
    rules: [
      'Une facture émise ne se modifie plus : ni lignes, ni prix, ni patient, ni numéro. Une erreur se corrige par une pièce liée (contre-écriture, avoir, remboursement), jamais par une suppression.',
      '« Total encaissé » et « Reste à encaisser » sont calculés par l’application. Chaque encaissement a son reçu numéroté, jamais renuméroté ni supprimé. Un reste à 0 FCFA se vérifie avec les reçus.',
      'Le montant encaissé ne dépasse jamais le reste à encaisser. Si une autre personne encaisse au même moment, le second encaissement est refusé et l’écran indique le reste à jour.',
      'L’émission réserve les articles en stock ; seule la remise les sort du stock. Un avoir ne les remet pas en stock ; seul un retour « Intact, vendable » les y remet, une fois.',
      'Contre-écriture, avoir, remboursement et retour demandent de confirmer votre mot de passe. Vos saisies sont gardées et l’opération reprend sans doublon. Une fois confirmé, il n’est pas redemandé pendant 15 minutes par défaut.',
      'La gérante exécute les corrections et le retour. La caissière envoie une demande d’autorisation, valable pour ce contenu exact, une seule fois et un temps limité : si le contenu change, il faut la redemander.',
    ],
    next: [
      {
        topic: 'parcours-remise-article',
        label: 'Remettre un article au patient, de la facture au retour',
      },
      {
        topic: 'parcours-correction',
        label: 'Corriger une facture : contre-écriture, avoir, remboursement',
      },
      {
        topic: 'notion-approbations',
        label: 'Comprendre les autorisations de la gérante',
        why: 'Pour savoir quand une demande est nécessaire et combien de temps elle vaut.',
      },
      {
        route: 'factures',
        label: 'Factures',
        why: 'Pour retrouver une autre facture, par jour d’émission ou par état.',
      },
    ],
    tips: [
      'Tant que le cabinet n’a pas validé ses mentions officielles, l’écran affiche « Document de test » et les PDF portent « DOCUMENT DE TEST » : ne les remettez pas comme pièces officielles.',
      'Réimprimer est sans risque : la facture et chaque reçu se rouvrent à volonté, avec le même numéro. Si « PDF non généré » s’affiche, la pièce existe : recliquez sur le bouton d’aperçu, sans réencaisser.',
      'Un bouton absent n’est pas une panne : votre profil n’a pas ce droit, ou le module concerné n’est pas ouvert sur ce cabinet. « Remettre au patient » reste grisé quand aucune ligne n’a de réserve ouverte : voyez la gérante.',
      'Un brouillon s’ouvre dans l’éditeur de cette même page (« Enregistrer le brouillon », « Émettre la facture ») : voyez l’aide de « Nouvelle facture ». Un brouillon abandonné affiche « Facture abandonnée ».',
      'Les encaissements en espèces, leurs contre-écritures et les remboursements en espèces entrent dans les « Espèces attendues dans le tiroir » de la session de caisse.',
    ],
    problems: [
      {
        symptom: '« Caisse non ouverte »',
        remedy:
          'Un encaissement ou un remboursement en espèces exige une session de caisse ouverte à votre nom. Cliquez sur « Ouvrir la caisse », ouvrez la session, puis revenez sur la facture. Les autres modes n’en ont pas besoin.',
      },
      {
        symptom: '« Le montant dépasse le reste à encaisser »',
        remedy:
          'Le reste a changé, par exemple parce qu’une autre personne a encaissé. La facture est relue et le reste à jour s’affiche : corrigez le « Montant encaissé » puis recommencez.',
      },
      {
        symptom: '« Enregistrement non confirmé »',
        remedy:
          'La réponse n’est pas arrivée : l’encaissement a peut-être été enregistré. Cliquez sur « Relire la facture ». S’il n’y figure pas, cliquez sur « Réessayer l’encaissement » : la même opération repart, sans doublon.',
      },
      {
        symptom:
          'Sous un reçu : « PDF du serveur en préparation » ou « PDF du serveur à régénérer »',
        remedy:
          'Le reçu existe et son numéro est définitif. Le message est normal avant la première impression : cliquez sur « Aperçu du reçu (PDF) » et n’encaissez pas de nouveau.',
      },
      {
        symptom:
          '« Remise non enregistrée », « Retour non enregistré », « Avoir non émis », « Remboursement non enregistré » ou « Correction non enregistrée »',
        remedy:
          'Lisez le message dessous. Le plus souvent la facture a changé (elle est relue : vérifiez les montants et recommencez), ou une autorisation de la gérante manque ou n’est plus valable : redemandez-la. Un lot expiré n’est pas remis : voyez la gérante.',
      },
    ],
    terms: [
      'Facture émise',
      'Acompte',
      'Solde',
      'Reste à encaisser',
      'Reçu',
      'Contre-écriture',
      'Avoir',
      'Remboursement',
      'Remise au patient',
      'Retour',
      'Approbation',
      'Session de caisse',
      'Lot',
    ],
  },
]
