import type { PageHelp } from '../model'

/**
 * Aide des écrans de la caisse (module `sales`) : « Caisse » (session, mouvements, clôture, revue des
 * écarts), « Catégories de dépenses » et « Caisse du jour » (encaissements nets, relevés de session).
 */
export const PAGES_CAISSE: readonly PageHelp[] = [
  {
    route: 'caisse',
    title: 'Caisse',
    module: 'sales',
    anyPermission: ['cash.own_session'],
    purpose:
      'C’est ici que la journée de caisse commence et se termine : ouvrez la caisse avec le fond de caisse, notez les dépenses et mouvements d’espèces, puis clôturez avec le montant compté dans le tiroir. On n’encaisse en espèces que dans une session ouverte.',
    actions: [
      {
        label: 'Ouvrir la caisse',
        effect:
          'Ouvre votre session avec le fond de caisse saisi, puis affiche la session ouverte et ses espèces attendues.',
      },
      {
        label: 'Enregistrer le mouvement',
        effect:
          'Enregistre une dépense, un retrait, un dépôt ou une correction de l’ouverture. Chez la caissière, le bouton s’appelle d’abord « Demander l’autorisation ».',
      },
      {
        label: 'Clôturer la caisse',
        effect:
          'Contrôle le compté et le motif de l’écart, demande confirmation, puis clôture et fige la session.',
      },
      {
        label: 'Relevé provisoire (PDF)',
        effect:
          'Prépare le relevé de la session en cours (tiroir espèces, mouvements, reçus). Il reste provisoire tant que la session est ouverte.',
      },
      {
        label: 'Caisse du jour',
        effect: 'Ouvre le résumé des encaissements nets du jour, mode par mode.',
      },
      {
        label: 'Aller aux factures',
        effect:
          'Ouvre la liste des factures, pour encaisser un règlement en espèces dans votre session.',
      },
      {
        label: 'Catégories de dépenses',
        effect:
          'Gérante : ouvre la gestion des catégories de dépenses. Le lien s’affiche quand votre propre session est ouverte.',
        anyPermission: ['cash.manage'],
      },
      {
        label: 'Clôturer cette session',
        effect: 'Gérante : ouvre la clôture d’une session encore ouverte d’une autre caissière.',
        anyPermission: ['cash.manage'],
      },
      {
        label: 'Revoir l’écart',
        effect:
          'Gérante : ouvre la revue de l’écart d’une session clôturée, pour l’accepter ou le contester.',
        anyPermission: ['cash.manage'],
      },
      {
        label: 'Relevé (PDF)',
        effect:
          'Gérante : prépare le relevé de n’importe quelle session de la liste, ouverte ou clôturée.',
        anyPermission: ['cash.manage'],
      },
    ],
    tasks: [
      {
        id: 'ouvrir-et-cloturer-la-caisse',
        title: 'Ouvrir la caisse le matin et la clôturer le soir',
        steps: [
          'Ouvrez « Ventes et caisse », puis « Caisse » (ou le raccourci « Caisse » de l’accueil). L’écran annonce « Aucune session de caisse ouverte ».',
          'Comptez le tiroir et saisissez le total dans « Fond de caisse » (0 si le tiroir est vide). Avec plusieurs caisses, choisissez d’abord la vôtre dans « Caisse ».',
          'Cliquez sur « Ouvrir la caisse ». L’écran affiche « Session ouverte » avec le fond, les espèces encaissées et les « Espèces attendues dans le tiroir ».',
          'En fin de journée, revenez sur « Caisse », comptez le tiroir et saisissez le total dans « Montant compté dans le tiroir ».',
          'Quittez le champ : l’écran affiche l’écart avec les espèces attendues. S’il n’est pas nul, expliquez-le dans « Motif de l’écart » (obligatoire dans ce cas).',
          'Cliquez sur « Clôturer la caisse », relisez le compté, l’attendu et l’écart dans « Clôturer la session de caisse ? », puis confirmez avec « Clôturer la caisse ».',
          'Cliquez sur « Relevé de clôture (PDF) » pour ouvrir, imprimer ou télécharger le relevé. Plus tard, retrouvez-le dans « Caisse du jour ».',
        ],
        result:
          'Le matin, la session est ouverte et vous pouvez encaisser en espèces. Le soir, « Session de caisse clôturée » rappelle l’attendu, le compté et l’écart : la session est figée.',
      },
      {
        id: 'enregistrer-un-mouvement',
        title: 'Enregistrer une dépense ou un mouvement d’espèces',
        steps: [
          'Dans une session ouverte, descendez à « Dépenses et mouvements de caisse », puis au formulaire « Enregistrer un mouvement ».',
          'Choisissez la « Nature » : la dépense (en tête de liste), « Retrait (versement, coffre) », « Dépôt (entrée d’espèces) » ou « Correction de l’ouverture ».',
          'Saisissez le « Montant (FCFA) », toujours positif. Pour une dépense, choisissez la « Catégorie de la dépense » ; pour une correction, le « Sens de la correction ».',
          'Écrivez le « Motif » (3 caractères au moins) et, si vous l’avez, la « Référence du justificatif (facultatif) » (bon, facture du fournisseur ou bordereau de versement).',
          'Gérante : cliquez sur « Enregistrer le mouvement » : il est enregistré directement, et la colonne « Autorisation » du tableau indique « Gérante (directe) ».',
          'Caissière : cliquez sur « Demander l’autorisation », écrivez le « Motif de la demande », puis cliquez sur « Envoyer la demande à la gérante ».',
          'Caissière : restez sur l’écran. Quand la gérante a accordé la demande dans « Approbations », cliquez sur « Enregistrer le mouvement » sans rien changer au formulaire.',
          'Si l’écran demande « Confirmer votre mot de passe », saisissez-le puis cliquez sur « Confirmer et reprendre » : votre saisie est conservée.',
        ],
        result:
          'Un message vert confirme le mouvement. Il apparaît dans le tableau (Heure, Nature, Motif, Autorisation, Montant) et les espèces attendues changent.',
      },
      {
        id: 'cloturer-une-autre-session-et-revoir-un-ecart',
        title: 'Clôturer la session d’une autre caissière et revoir un écart',
        anyPermission: ['cash.manage'],
        steps: [
          'Sur « Caisse », descendez à « Sessions de toutes les caisses » (ouvertes d’abord). S’il y a plusieurs pages, utilisez « Page suivante ».',
          'Pour la session ouverte d’une autre caissière, cliquez sur « Clôturer cette session ». Votre propre session se clôture avec le formulaire « Clôturer la caisse ».',
          'Saisissez le « Montant compté dans le tiroir » et, si l’écart n’est pas nul, le « Motif de l’écart ». Cliquez sur « Clôturer la session ».',
          'Vérifiez la caissière, le compté, l’attendu et l’écart dans « Clôturer cette session de caisse ? », puis confirmez avec « Clôturer la session ».',
          'Pour une session clôturée avec un écart, cliquez sur « Revoir l’écart ».',
          'Choisissez la « Décision » : « Accepter l’écart (motif jugé suffisant) » ou « Contester l’écart (à éclaircir) ».',
          'Ajoutez une « Note (obligatoire pour une contestation) » (3 caractères au moins), puis cliquez sur « Enregistrer la revue ».',
          'Si l’écran demande « Confirmer votre mot de passe », saisissez-le puis cliquez sur « Confirmer et reprendre ».',
        ],
        result:
          'La revue s’affiche : « Écart accepté par la gérante » ou « Écart contesté par la gérante », avec votre nom, la date et la note. La clôture n’est pas modifiée.',
      },
    ],
    rules: [
      'Un encaissement ou un remboursement en espèces exige une session ouverte par son auteur ; un compte n’en a qu’une à la fois. Mobile money, virement et chèque n’entrent pas dans le tiroir.',
      'Les espèces attendues, calculées par le serveur, valent : fond de caisse, plus les espèces encaissées, moins les contre-écritures et remboursements en espèces, plus ou moins les mouvements autorisés.',
      'À la clôture, le serveur recalcule l’attendu. Si un encaissement en espèces est arrivé depuis l’affichage, il refuse, annonce le nouvel attendu et garde votre compté : vous recomptez puis clôturez de nouveau.',
      'L’écart (compté moins attendu) est dit sans jugement. S’il n’est pas nul, un motif est obligatoire, sinon la clôture ne part pas ; la gérante le relit à la revue de l’écart.',
      'Une session clôturée est figée : elle ne se modifie plus et n’admet ni encaissement en espèces ni mouvement. Une erreur se corrige dans une session ouverte, avec son motif.',
      'Un mouvement hors vente n’est jamais un paiement de patient (ni facture, ni reçu). Une sortie ne dépasse jamais les espèces attendues. La caissière demande l’autorisation exacte de la gérante ; la gérante enregistre directement.',
    ],
    next: [
      {
        route: 'factures',
        label: 'Factures',
        why: 'Pour encaisser : un règlement en espèces entre dans votre session ouverte.',
      },
      {
        route: 'caisse-du-jour',
        label: 'Caisse du jour',
        why: 'Pour lire les encaissements nets du jour, mode par mode.',
      },
      {
        route: 'approbations',
        label: 'Approbations',
        why: 'Pour suivre une demande d’autorisation, ou l’accorder si vous êtes la gérante.',
      },
      {
        topic: 'notion-caisse',
        label: 'Comprendre la session de caisse, l’attendu et l’écart',
      },
    ],
    tips: [
      'Ouvrez la caisse avant le premier encaissement en espèces de la journée : sinon la facture affiche « Caisse non ouverte » et bloque l’encaissement en espèces. Les autres modes ne dépendent pas de la caisse.',
      'La « Correction de l’ouverture » sert quand le fond saisi à l’ouverture était faux : elle ajuste les espèces attendues sans être une vraie sortie d’argent.',
      'Si l’écran montre déjà une « Session ouverte » que vous n’avez pas ouverte aujourd’hui, par exemple celle de la veille, clôturez-la d’abord : comptez le tiroir, puis « Clôturer la caisse ». La gérante peut aussi la clôturer à votre place.',
      'Ouverture, clôture et mouvements ne sont enregistrés que lorsque le serveur répond. Si l’écran affiche « Enregistrement non confirmé », cliquez sur « Réessayer l’ouverture » ou « Réessayer la clôture » : la même opération est renvoyée, jamais deux fois.',
      'Le relevé en PDF n’est pas une pièce numérotée : il est refait à chaque demande. Tant que les mentions réelles du cabinet ne sont pas validées à la mise en service, il porte « DOCUMENT DE TEST ».',
    ],
    problems: [
      {
        symptom: '« Aucune caisse active dans ce cabinet »',
        remedy:
          'La caisse principale n’a pas été créée à l’installation. Prévenez la personne qui a installé l’application : sans elle, aucune ouverture n’est possible.',
      },
      {
        symptom: '« Un écart de caisse exige un motif. »',
        remedy:
          'Le compté diffère de l’attendu : remplissez « Motif de l’écart », puis cliquez de nouveau sur « Clôturer la caisse ».',
      },
      {
        symptom: '« Les espèces attendues ont changé depuis l’affichage »',
        remedy:
          'Un encaissement en espèces est probablement arrivé pendant votre comptage. Votre compté est conservé : recomptez le tiroir, corrigez-le si besoin, puis clôturez de nouveau.',
      },
      {
        symptom:
          '« Ce compte ne peut pas demander d’autorisation : la gérante enregistre ce mouvement. »',
        remedy:
          'Les demandes d’autorisation ne sont pas ouvertes à ce compte : laissez la gérante enregistrer elle-même le mouvement.',
      },
      {
        symptom: '« L’autorisation demandée n’est pas (ou plus) accordée »',
        remedy:
          'La gérante n’a pas encore décidé, a refusé, ou l’accord est échu. Regardez l’état dans « Approbations » ; si la demande est refusée ou échue, quittez l’écran « Caisse », revenez-y et refaites la demande.',
      },
    ],
    terms: [
      'Session de caisse',
      'Fond de caisse',
      'Espèces attendues',
      'Écart de caisse',
      'Contre-écriture',
      'Approbation',
    ],
  },
  {
    route: 'categories-depenses',
    title: 'Catégories de dépenses',
    module: 'sales',
    anyPermission: ['cash.manage'],
    purpose:
      'Réservé à la gérante : créez ici les catégories qui classent les dépenses faites en espèces depuis la caisse (transport, fournitures, entretien). Elles sont proposées dans « Catégorie de la dépense ». Elles ne remplacent pas le plan comptable du comptable.',
    actions: [
      {
        label: 'Créer la catégorie',
        effect:
          'Crée la catégorie avec le nom et le code saisis ; elle sera proposée pour les nouvelles dépenses.',
      },
      {
        label: 'Désactiver',
        effect:
          'Retire la catégorie de la liste proposée pour les nouvelles dépenses. Les dépenses déjà enregistrées la gardent.',
      },
      {
        label: 'Réactiver',
        effect:
          'Remet une catégorie désactivée dans la liste proposée pour les nouvelles dépenses.',
      },
      {
        label: 'Retour à la caisse',
        effect: 'Revient à l’écran « Caisse ».',
      },
    ],
    tasks: [
      {
        id: 'creer-une-categorie',
        title: 'Créer une catégorie de dépenses',
        steps: [
          'Sur l’écran « Caisse », votre session étant ouverte, cliquez sur « Catégories de dépenses ».',
          'Dans « Nouvelle catégorie », saisissez le « Nom » tel que l’équipe le lira, par exemple Transport.',
          'Saisissez le « Code » avec des majuscules, des chiffres ou _ (par exemple TRANSPORT). Il doit être unique et ne change plus ensuite.',
          'Cliquez sur « Créer la catégorie ».',
        ],
        result:
          'Un message vert confirme la création. La catégorie figure dans la liste et la caisse la propose dans « Catégorie de la dépense ».',
      },
      {
        id: 'desactiver-ou-reactiver',
        title: 'Désactiver ou réactiver une catégorie',
        steps: [
          'Repérez la catégorie dans la liste : son nom, son code, et la mention « Désactivée » si elle ne sert plus.',
          'Cliquez sur « Désactiver » pour ne plus la proposer pour les nouvelles dépenses, ou sur « Réactiver » pour la proposer de nouveau.',
        ],
        result:
          'Un message vert le confirme. Les dépenses déjà enregistrées gardent leur catégorie.',
      },
    ],
    rules: [
      'Aucune catégorie n’est préparée à l’avance : chaque cabinet crée les siennes. Tant qu’il n’y en a aucune, l’écran affiche « Aucune catégorie ».',
      'Le code est fixé à la création : il ne change plus, et deux catégories ne peuvent pas porter le même. L’écran écrit les lettres du code en majuscules.',
      'Une catégorie ne se supprime jamais, elle se désactive. Les dépenses passées la gardent ; la caisse ne la propose plus pour les nouvelles dépenses.',
      'Une dépense enregistrée à la caisse sort des espèces du tiroir : elle diminue les espèces attendues, sans être un paiement de patient.',
      'Seule la gérante crée, désactive et réactive les catégories. La caissière ne voit, dans la caisse, que les catégories actives.',
    ],
    next: [
      {
        route: 'caisse',
        label: 'Caisse',
        why: 'Pour enregistrer une dépense avec la catégorie créée.',
      },
      {
        topic: 'notion-caisse',
        label: 'Comprendre la session de caisse, l’attendu et l’écart',
      },
      {
        topic: 'guide-gerante',
        label: 'Le guide de la gérante',
      },
    ],
    tips: [
      'Gardez peu de catégories, avec des noms simples que toute l’équipe comprend, comme transport, fournitures ou entretien.',
      'L’écran ne permet pas de renommer une catégorie. En cas de faute de frappe, désactivez-la et créez-en une autre avec un autre code.',
      'Une catégorie créée apparaît dans la caisse quand la caissière rouvre ou recharge l’écran « Caisse ».',
      'Pas encore disponible : un état des dépenses par catégorie. Les dépenses se lisent dans la session en cours, sur l’écran « Caisse », et dans le relevé PDF de chaque session.',
      'Le lien « Catégories de dépenses » n’apparaît sur l’écran « Caisse » que lorsque votre propre session est ouverte : ouvrez-la d’abord si besoin.',
    ],
    problems: [
      {
        symptom:
          '« Catégories non lues » : « Le serveur n’a pas répondu : les catégories ne sont pas affichées. »',
        remedy: 'Vérifiez la connexion Internet, puis rechargez l’écran.',
      },
      {
        symptom: 'Un message rouge en haut de l’écran ou sous « Nom » ou « Code »',
        remedy:
          'C’est un refus du serveur, par exemple un code déjà utilisé. Corrigez le champ indiqué, puis cliquez de nouveau sur « Créer la catégorie ».',
      },
      {
        symptom: '« Aucune catégorie »',
        remedy:
          'Ce n’est pas une erreur : aucune catégorie n’existe encore. Créez la première avec le formulaire « Nouvelle catégorie ».',
      },
      {
        symptom: 'Une catégorie manque dans la liste de la caisse',
        remedy:
          'Vérifiez qu’elle ne porte pas la mention « Désactivée » (cliquez alors sur « Réactiver »). Si elle est active, la caissière doit recharger l’écran « Caisse ».',
      },
    ],
    terms: ['Espèces attendues'],
  },
  {
    route: 'caisse-du-jour',
    title: 'Caisse du jour',
    module: 'sales',
    anyPermission: ['finance.global.read', 'cash.own_session'],
    purpose:
      'Voyez ce qui a été encaissé un jour donné, mode par mode, net des contre-écritures et des remboursements. La gérante lit tout le cabinet ; la caissière lit ses seuls encaissements et ses sessions, avec le relevé de chaque session en PDF.',
    actions: [
      {
        label: 'Afficher',
        effect: 'Lit la caisse du jour saisi dans « Jour » (JJ/MM/AAAA ou 8 chiffres).',
      },
      {
        label: 'Aujourd’hui',
        effect: 'Remet le jour en cours et relit les chiffres du serveur.',
      },
      {
        label: 'Relevé (PDF)',
        effect:
          'Prépare le relevé d’une session (tiroir espèces, mouvements, reçus), à ouvrir, imprimer ou télécharger.',
      },
      {
        label: 'Voir les factures',
        effect: 'Gérante : ouvre la liste des factures, pour suivre le reste à encaisser.',
        anyPermission: ['finance.global.read'],
      },
      {
        label: 'Retour à la caisse',
        effect: 'Revient à l’écran « Caisse ».',
      },
    ],
    tasks: [
      {
        id: 'lire-les-encaissements',
        title: 'Lire les encaissements d’un jour',
        steps: [
          'Ouvrez « Ventes et caisse », puis « Caisse du jour ». Sur l’accueil, la tuile « Encaissé net » y mène par « Voir la caisse du jour ».',
          'Le jour affiché est aujourd’hui. Pour un autre jour, saisissez-le dans « Jour » (JJ/MM/AAAA ou 8 chiffres, par exemple 15102026), puis cliquez sur « Afficher ».',
          'Sous « Encaissements nets par mode », lisez une carte par mode : le net, le nombre d’encaissements, puis les contre-écritures et remboursements retranchés.',
          'Comparez ensuite « Espèces (tiroir) », « Autres modes (rapprochés à part) » et « Total net encaissé ».',
        ],
        result:
          'Vous connaissez le total net encaissé du jour et la part en espèces, celle du tiroir.',
      },
      {
        id: 'lire-les-ventes-du-jour',
        title: 'Lire les ventes du jour et le reste à encaisser',
        anyPermission: ['finance.global.read'],
        steps: [
          'Descendez à « Ventes du jour et reste à encaisser ».',
          '« Factures émises ce jour » donne le nombre et le total des factures émises ; « Avoirs émis ce jour » donne ceux des avoirs.',
          '« Reste à encaisser (factures ouvertes) » additionne le reste à encaisser de toutes les factures émises, même anciennes, à l’instant de la lecture.',
          'S’il apparaît, « Crédits à rembourser » montre ce que le cabinet doit encore rembourser aux patients.',
          'Cliquez sur « Voir les factures » pour ouvrir la liste et suivre les restes à encaisser.',
        ],
        result:
          'Vous distinguez les ventes du jour de l’argent encaissé le même jour, et vous voyez ce qu’il reste à encaisser sur tout le cabinet.',
      },
      {
        id: 'obtenir-un-releve',
        title: 'Obtenir le relevé d’une session en PDF',
        steps: [
          'Descendez à « Sessions de caisse du jour » : chaque session indique la caissière, la caisse, l’ouverture, le fond, les espèces encaissées, puis l’attendu ou l’écart.',
          'Cliquez sur « Relevé (PDF) » sous la session voulue et patientez pendant « Préparation du relevé… ».',
          'Cliquez sur « Ouvrir le PDF », « Imprimer » ou « Télécharger le PDF ». Pour imprimer, le PDF s’ouvre dans le navigateur : utilisez Ctrl+P.',
          'Contrôlez le tiroir espèces, les mouvements autorisés, les autres modes de règlement et les reçus de la session.',
        ],
        result:
          'Le relevé s’affiche page par page : « Relevé provisoire » si la session est ouverte, « Session clôturée » si elle est clôturée.',
      },
    ],
    rules: [
      'Le jour civil est celui du cabinet. Un encaissement compte à sa date d’encaissement : une ancienne facture encaissée aujourd’hui augmente les encaissements d’aujourd’hui, sans devenir une vente d’aujourd’hui.',
      'Le net d’un mode est le total encaissé moins les contre-écritures et les remboursements. Un avoir corrige une vente, pas un encaissement. Le « Total net encaissé » additionne les modes.',
      'Seules les espèces sont dans le tiroir. Mobile money, virement et chèque sont affichés à part : cette version n’interroge aucun opérateur ni banque, ces montants sont ceux constatés à l’encaissement.',
      'La gérante lit tout le cabinet : ventes et avoirs émis du jour, reste à encaisser. La caissière lit seulement ses encaissements et ses sessions, sans chiffre d’affaires ni créances.',
      'Le reste à encaisser est celui de l’instant de la lecture, toutes factures émises confondues : il ne dépend pas du jour choisi.',
      'Une lecture qui échoue est annoncée comme indisponible, jamais comme « Aucun encaissement ce jour-là ». Les chiffres viennent du serveur, dont l’heure de lecture est indiquée en bas de l’écran.',
    ],
    next: [
      {
        route: 'caisse',
        label: 'Caisse',
        why: 'Pour ouvrir, clôturer ou noter un mouvement d’espèces.',
      },
      {
        route: 'factures',
        label: 'Factures',
        why: 'Pour encaisser un reste à encaisser.',
      },
      {
        topic: 'notion-encaissement',
        label: 'Comprendre l’encaissement et le reçu',
      },
      {
        topic: 'parcours-caisse',
        label: 'Une journée de caisse, de l’ouverture à la clôture',
      },
    ],
    tips: [
      '« Espèces (tiroir) » ne compte que les encaissements en espèces, nets : ni le fond de caisse, ni les dépenses et mouvements. Les espèces attendues d’une session se lisent sur l’écran « Caisse ».',
      'Le titre rappelle le jour réellement affiché : relisez-le après avoir changé le « Jour ».',
      'Le relevé en PDF n’est pas une pièce numérotée : il est refait à chaque demande. Tant que les mentions réelles du cabinet ne sont pas validées à la mise en service, il porte « DOCUMENT DE TEST ».',
      'Une caissière voit « Vos encaissements et vos sessions seulement » : les chiffres du cabinet entier sont réservés à la gérante.',
    ],
    problems: [
      {
        symptom: '« Serveur indisponible »',
        remedy:
          'Le serveur n’a pas répondu : rien n’est conclu et aucune ancienne copie n’est montrée. Vérifiez la connexion Internet, puis cliquez sur « Réessayer ».',
      },
      {
        symptom: '« Aucun encaissement ce jour-là »',
        remedy:
          'Ce n’est pas une erreur : le serveur n’a enregistré aucun encaissement, contre-écriture ni remboursement ce jour-là. Vérifiez le jour affiché dans le titre.',
      },
      {
        symptom: '« Aucune session de caisse ce jour-là »',
        remedy:
          'Aucune session n’était ouverte ce jour-là, pour votre compte si vous êtes caissière. Vérifiez le jour ; la gérante voit toutes les caisses.',
      },
      {
        symptom: '« Date invalide : JJ/MM/AAAA ou AAAA-MM-JJ. »',
        remedy:
          'Écrivez le jour comme 15/10/2026 ou 15102026. Avec une date invalide, « Afficher » lit aujourd’hui : relisez le titre pour savoir quel jour est affiché.',
      },
      {
        symptom: '« Relevé non produit »',
        remedy:
          'Le message dit pourquoi : reconnectez-vous ou réessayez. Si les espèces attendues ne correspondent plus aux mouvements de la session, le relevé est refusé plutôt que corrigé : signalez-le à la gérante.',
      },
    ],
    terms: [
      'Reste à encaisser',
      'Contre-écriture',
      'Remboursement',
      'Avoir',
      'Espèces attendues',
      'Session de caisse',
    ],
  },
]
