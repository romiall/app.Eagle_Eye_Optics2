import type { HandbookTopic } from '../model'

/**
 * Documentation globale, parties « Glossaire » et « Dépannage » : les 54 mots du glossaire (20 mots
 * d’optique et 34 mots de gestion, chacun défini une seule fois), les messages réels de l’application,
 * les questions fréquentes et les limites de cette version. Libellés recopiés de l’application ;
 * voir docs/implementation/help.md.
 */
export const TOPICS_GLOSSAIRE_DEPANNAGE: readonly HandbookTopic[] = [
  {
    id: 'glossaire-optique',
    title: 'Glossaire de l’optique',
    summary:
      'Le sens des vingt mots d’optique de l’examen, de la prescription et des ordonnances, avec ce que vous saisissez ou lisez à l’écran.',
    module: null,
    anyPermission: [],
    intro:
      'Ces mots reviennent dans l’examen de vue, la prescription optique et les ordonnances. Ils sont rangés par ordre alphabétique. L’application enregistre ce que vous saisissez : elle ne calcule rien à votre place et ne pose aucun diagnostic.',
    blocks: [
      {
        kind: 'terms',
        title: 'Les mots de l’optique, de A à Z',
        items: [
          {
            term: 'Acuité visuelle',
            definition:
              'Ce que le patient distingue sur une échelle de lecture, noté pour OD, OG et OU à l’étape « Acuité visuelle ». Une case vide se lit « non mesuré » ; 0 est une valeur.',
          },
          {
            term: 'Addition',
            definition:
              'Puissance ajoutée pour la vision de près, en dioptries. Elle se saisit avec la réfraction subjective (colonne « Addition ») et dans la prescription optique.',
          },
          {
            term: 'Autoréfracteur',
            definition:
              'Appareil qui mesure automatiquement la correction de chaque œil. À l’étape « Réfraction », sa mesure reste séparée des deux autres : rien n’est fusionné ni recopié d’une mesure à l’autre.',
          },
          {
            term: 'Axe',
            definition:
              'Direction du cylindre, en degrés, de 0 à 180. Un cylindre non nul exige un axe.',
          },
          {
            term: 'Collyre',
            definition:
              'Médicament en gouttes pour les yeux, suivi par lot : un collyre exige un numéro de lot et une date d’expiration. À l’examen, « Collyre » est l’une des formes d’un médicament.',
          },
          {
            term: 'Contrôle recommandé',
            definition:
              'Rappel de travail programmé pendant l’examen, avec un motif, une date de départ et un délai qui donnent la date recommandée. Il ne réserve aucune heure : le rendez-vous se prend ensuite avec « Programmer un rendez-vous ».',
          },
          {
            term: 'Cylindre',
            definition:
              'Part de la correction qui compense l’astigmatisme, en dioptries. Un cylindre non nul exige un axe, et l’application garde la valeur saisie : elle ne transpose jamais un cylindre positif.',
          },
          {
            term: 'Dioptrie',
            definition:
              'Unité de puissance d’un verre, notée D. Sphère, cylindre et addition se saisissent en dioptries, avec virgule ou point et deux décimales au plus : une troisième est refusée, jamais arrondie.',
          },
          {
            term: 'Écart pupillaire',
            definition:
              'Distance entre les deux pupilles, en millimètres. À l’étape « Centrage », le total, l’OD et l’OG se saisissent séparément ; une « Justification de l’écart » est obligatoire si la somme OD et OG diffère du total. L’écart total du ticket de l’autoréfracteur se saisit déjà à l’étape « Réfraction ».',
          },
          {
            term: 'Monture',
            definition:
              'La monture des lunettes, catégorie « Monture » du catalogue. Quand son mode de stock est « Article géré en stock », elle est réservée à l’émission de la facture et sort du stock à la remise au patient.',
          },
          {
            term: 'OD',
            definition:
              'Œil droit, toujours noté avant l’OG, dans l’examen comme dans la prescription. À l’écran : « Œil droit (OD) ».',
          },
          {
            term: 'OG',
            definition: 'Œil gauche, noté après l’OD. À l’écran : « Œil gauche (OG) ».',
          },
          {
            term: 'Ordonnance de médicaments',
            definition:
              'Ordonnance imprimée en PDF depuis l’étape « Médicaments » de l’examen, en saisie libre : « Nom du médicament » et « Forme » sont obligatoires. Aucune posologie n’est proposée ; elle s’imprime une fois l’examen terminé, avec au moins un médicament saisi.',
          },
          {
            term: 'Ordonnance externe',
            definition:
              'Ordonnance écrite par un autre prescripteur, recopiée telle qu’elle est sur papier depuis l’onglet « Prescriptions » du dossier, avec « Transcrire une ordonnance externe ». Aucun examen n’est créé et elle ne s’imprime pas.',
          },
          {
            term: 'Orientation',
            definition:
              'Renvoi du patient vers un ophtalmologiste, noté à l’étape « Conclusion et orientation » dans « Orientation vers un ophtalmologiste ». Avec Oui, le « Niveau d’urgence » est obligatoire, et la lettre d’orientation s’imprime une fois l’examen terminé.',
          },
          {
            term: 'OU',
            definition:
              'Les deux yeux, utilisés seulement pour l’acuité visuelle : la réfraction se note pour OD et OG. À l’écran : « Les deux yeux (OU) ».',
          },
          {
            term: 'Prescription optique',
            definition:
              'La correction des lunettes (sphère, cylindre, axe et addition, OD puis OG), écrite dans un document depuis un examen terminé. D’abord brouillon, elle devient définitive avec « Valider la prescription » ; pour la changer, « Créer une nouvelle version ».',
          },
          {
            term: 'Réfraction subjective',
            definition:
              'Mesure faite avec les réponses du patient. À l’étape « Réfraction », elle reste distincte de l’« Autoréfracteur » et de la « Réfraction objective », et elle seule porte l’addition.',
          },
          {
            term: 'Sphère',
            definition:
              'Puissance principale de la correction d’un œil, en dioptries. Elle se saisit dans chaque mesure de réfraction et dans la prescription optique.',
          },
          {
            term: 'Verres',
            definition:
              'Les verres des lunettes, décrits dans la prescription optique par le « Type de verre », l’« Indice » et les « Traitements ». Au catalogue, leur catégorie s’appelle « Verre ».',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Une valeur se note telle qu’elle est lue ou écrite sur le papier. L’application ne convertit pas une échelle d’acuité en une autre. Les « Mots utiles » d’une fiche d’aide mènent à ces définitions.',
      },
    ],
    related: [
      {
        topic: 'notion-examen-prescription',
        label: 'L’examen par étapes et la prescription optique',
      },
      { topic: 'parcours-examen', label: 'Examen de vue : démarrer, saisir, terminer' },
      { topic: 'parcours-ordonnance', label: 'Prescription optique et ordonnances' },
      { topic: 'glossaire-gestion', label: 'Glossaire de la gestion' },
      { route: 'consultations', label: 'Consultations' },
    ],
    keywords: [
      'dictionnaire',
      'lexique',
      'vocabulaire',
      'définition',
      'signification',
      'sens des mots',
      'abréviation',
      'œil droit',
      'œil gauche',
      'acuité',
      'sphère',
      'cylindre',
      'axe',
      'addition',
      'dioptrie',
      'écart pupillaire',
      'autoréfracteur',
      'réfraction',
      'subjective',
      'monture',
      'verres',
      'lentilles',
      'collyre',
      'ordonnance',
      'prescription',
      'orientation',
      'contrôle recommandé',
    ],
  },
  {
    id: 'glossaire-gestion',
    title: 'Glossaire de la gestion',
    summary:
      'Le sens des trente-quatre mots de gestion : dossier et visite, facturation et encaissement, caisse, stock et administration.',
    module: null,
    anyPermission: [],
    intro:
      'Ces mots reviennent dans les écrans de l’accueil, des ventes, de la caisse, du stock et des réglages. Ils sont rangés par thème. Chaque mot est défini une seule fois, ici : les « Mots utiles » d’une fiche d’aide y mènent.',
    blocks: [
      {
        kind: 'terms',
        title: 'Dossier et visite',
        items: [
          {
            term: 'Numéro de dossier',
            definition:
              'Le numéro qui identifie la fiche d’un patient, par exemple EE-2026-0001. Il est attribué à l’enregistrement de la fiche et ne se modifie jamais. Vous pouvez le saisir dans « Rechercher un patient ».',
          },
          {
            term: 'Doublon',
            definition:
              'Deux fiches pour une même personne. À la création, l’application signale les fiches proches (« Des fiches ressemblent à ce patient »), sans jamais fusionner seule. Seule la gérante réunit deux fiches, avec « Fusionner avec une autre fiche ».',
          },
          {
            term: 'Visite',
            definition:
              'Une venue du patient au cabinet, notée à son arrivée. Son motif est « Examen de vue », « Achat direct », « Retrait de commande » ou « Contrôle de suivi ». Une visite n’est pas un examen : un achat ou un retrait n’en crée aucun.',
          },
          {
            term: 'File du jour',
            definition:
              'La liste des visites du jour, dans l’écran « Aujourd’hui ». Chaque visite a un statut : « Arrivé », « Prêt pour l’examen », « En consultation », « Terminé » ou « Annulé ». Si le cabinet contrôle les frais d’examen, « En attente du paiement de l’examen » s’ajoute.',
          },
          {
            term: 'Examen',
            definition:
              'La séance du professionnel, saisie en sept étapes dans l’écran « Consultations ». Une fois terminé, il ne se modifie plus : une erreur se corrige par une révision.',
          },
          {
            term: 'Révision',
            definition:
              'Une version enregistrée d’un examen terminé ou d’un devis. Chaque correction en ajoute une, avec son motif. Les précédentes restent lisibles : « Révisions et comparaison » pour un examen, « Révisions figées » pour un devis.',
          },
          {
            term: 'Brouillon',
            definition:
              'Une pièce pas encore définitive, que l’on peut modifier : facture, devis ou prescription optique. Un brouillon de facture n’a ni numéro ni stock réservé, et « Abandonner le brouillon » le ferme. Un brouillon ne s’imprime pas.',
          },
        ],
      },
      {
        kind: 'terms',
        title: 'Facturation et encaissement',
        items: [
          {
            term: 'Facture émise',
            definition:
              'Une facture devenue définitive avec « Émettre la facture ». Elle reçoit son numéro. Ses lignes et l’identité du patient sont figées, et ses articles gérés en stock sont réservés. Elle ne se modifie plus : une erreur se corrige par une pièce de correction.',
          },
          {
            term: 'Acompte',
            definition:
              'Une partie du prix encaissée avant le reste. Il a son propre reçu, qui porte « Acompte ». La facture reste émise et son « Reste à encaisser » baisse.',
          },
          {
            term: 'Solde',
            definition:
              'Ce qui reste à encaisser sur une facture après un acompte. L’encaissement qui règle ce reste a son propre reçu, qui porte « Règlement du solde ».',
          },
          {
            term: 'Reste à encaisser',
            definition:
              'Ce que le patient doit encore sur une facture émise, après les encaissements et les avoirs. À 0 FCFA, le formulaire d’encaissement disparaît. Un avoir plus grand que ce reste fait apparaître le « Crédit en faveur du patient ».',
          },
          {
            term: 'Reçu',
            definition:
              'La pièce qui prouve un encaissement : un reçu par encaissement, avec son numéro, qui ne change jamais. « Aperçu du reçu (PDF) » ou « Réimprimer le reçu » redonnent la même pièce, sans nouvel encaissement.',
          },
          {
            term: 'Avoir',
            definition:
              'Une pièce qui réduit une vente déjà émise, ligne par ligne et avec un motif : « Émettre un avoir ». La facture et ses reçus ne changent pas. Un avoir ne rend aucun argent et ne remet aucun article en stock.',
          },
          {
            term: 'Remboursement',
            definition:
              'L’argent rendu au patient, sur le crédit d’un avoir : « Rembourser ». Il a son propre numéro. En espèces, il demande une session de caisse ouverte.',
          },
          {
            term: 'Contre-écriture',
            definition:
              'La correction d’un encaissement saisi à tort : « Contre-passer le paiement ». Le paiement et son reçu restent tels quels, et le total encaissé baisse. Ce n’est pas une sortie d’argent. Un motif est obligatoire.',
          },
          {
            term: 'Remise commerciale',
            definition:
              'Une réduction accordée sur une ligne de facture, saisie en FCFA dans « Remise TTC ». La gérante peut aller jusqu’au montant de la ligne. Les autres comptes ont un plafond en pourcentage, à 0 % par défaut ; au-delà, l’écran propose « Demander une autorisation ».',
          },
          {
            term: 'Devis',
            definition:
              'Une proposition de prix remise au client avant la facture. Il ne vaut pas facture, n’enregistre aucun règlement et ne réserve aucun article. Émis, il a son numéro ; tant qu’il est valable, « Convertir en facture » en fait un brouillon de facture.',
          },
        ],
      },
      {
        kind: 'terms',
        title: 'Caisse',
        items: [
          {
            term: 'Session de caisse',
            definition:
              'La période de travail d’une caissière sur son tiroir, de « Ouvrir la caisse » à « Clôturer la caisse ». Un encaissement en espèces n’entre que dans une session ouverte au nom de la personne qui encaisse. Une session clôturée est figée.',
          },
          {
            term: 'Fond de caisse',
            definition:
              'Les espèces déjà dans le tiroir quand la caissière ouvre sa session : 0 si le tiroir est vide. Elles comptent dans les espèces attendues.',
          },
          {
            term: 'Espèces attendues',
            definition:
              'Ce que le tiroir doit contenir d’après l’application. On part du fond de caisse, on ajoute les espèces encaissées, on retire les remboursements et contre-écritures en espèces, puis on ajoute ou retire les mouvements autorisés. Mobile money, virement et chèque n’y figurent pas.',
          },
          {
            term: 'Écart de caisse',
            definition:
              'La différence entre le « Montant compté dans le tiroir » et les espèces attendues. Elle est dite sans jugement : « Le compté est supérieur à l’attendu » ou « Le compté est inférieur à l’attendu ». Un écart exige un « Motif de l’écart » ; la gérante peut le revoir avec « Revoir l’écart ».',
          },
        ],
      },
      {
        kind: 'terms',
        title: 'Stock',
        items: [
          {
            term: 'Stock disponible',
            definition:
              'Ce qui reste à vendre : le stock physique moins le stock réservé. Il baisse à l’émission de la facture, pas à la remise. C’est la colonne « Disponible » de l’écran « Stock ».',
          },
          {
            term: 'Stock réservé',
            definition:
              'Ce qui est mis de côté pour des factures émises et pas encore remis aux patients. Il monte à l’émission et retombe à la remise. C’est la colonne « Réservé ».',
          },
          {
            term: 'Stock physique',
            definition:
              'Ce qui est réellement en place dans le cabinet. Il baisse à la remise au patient et à une casse, remonte avec un retour remis en stock, et varie avec un ajustement après comptage. C’est la colonne « Physique ».',
          },
          {
            term: 'Lot',
            definition:
              'Un groupe d’exemplaires d’un même article, avec son « Numéro de lot » et sa « Date d’expiration ». Le lot qui expire le plus tôt part en premier. Un lot expiré, ou « en quarantaine (jamais réservé) », ne se remet pas.',
          },
          {
            term: 'Remise au patient',
            definition:
              'Le moment où l’article part avec le patient : sur la facture émise, « Remettre au patient », puis « Confirmer la remise ». L’article sort du stock et la remise peut être partielle. S’il reste à encaisser, la remise demande l’accord de la gérante.',
          },
          {
            term: 'Retour',
            definition:
              'Un article rapporté par le patient, enregistré par la gérante avec « Enregistrer un retour ». Il ne crée ni avoir ni remboursement. L’article ne revient en stock vendable que s’il est intact et que « Remettre en stock vendable » est coché.',
          },
        ],
      },
      {
        kind: 'terms',
        title: 'Administration',
        items: [
          {
            term: 'Approbation',
            definition:
              'L’accord de la gérante pour une opération sensible. Exemples : prix ou remise au-delà des droits du compte, contre-écriture, avoir, remboursement, remise avant règlement complet, mouvement de caisse, casse ou ajustement, dispense des frais d’examen. Il vaut pour cette opération précise, une seule fois, avant son échéance. Certains écrans disent autorisation : c’est la même chose.',
          },
          {
            term: 'Profil',
            definition:
              'Le rôle d’un compte au cabinet : « Gérante », « Accueil », « Professionnel (examen) » ou « Caisse ». Un compte peut en cumuler plusieurs. Le profil décide des écrans et des boutons que vous voyez.',
          },
          {
            term: 'Droit',
            definition:
              'Une permission précise, par exemple « Encaisser paiement ». Les droits viennent des profils. La gérante peut en ajouter ou en retirer à une personne nommée par une « Dérogation de droit », avec un motif.',
          },
          {
            term: 'Module',
            definition:
              'Un ensemble d’écrans, par exemple « Patients » ou « Ventes et caisse ». Le prestataire l’ouvre pour le cabinet au fil de la mise en service. Un module fermé reste fermé pour tous, gérante comprise.',
          },
          {
            term: 'Catalogue',
            definition:
              'La liste des articles et prestations vendus. Chacun a un prix TTC, une catégorie (par exemple « Monture », « Verre » ou « Collyre »), une unité et un mode de stock. Seule la gérante la modifie. Un changement de prix ne touche pas les factures émises.',
          },
          {
            term: 'Règle fiscale',
            definition:
              'Un taux de taxe saisi et validé par la gérante, puis rattaché aux articles. Il n’est appliqué aux documents que si la règle est active et validée. Sans règle validée, les factures portent « aucune taxe configurée » : aucun taux n’est inventé.',
          },
          {
            term: 'Créance papier',
            definition:
              'Un reste dû d’une vente faite avant l’application, noté sur un carnet papier. La gérante le reprend dans « Créances papier ». Il devient une pièce émise dont le total est le seul reste dû, qui se règle par l’encaissement habituel.',
          },
        ],
      },
    ],
    related: [
      { topic: 'notion-facture', label: 'La vie d’une facture' },
      { topic: 'notion-encaissement', label: 'Encaissements, reçus et corrections' },
      { topic: 'notion-caisse', label: 'La caisse : session, tiroir et clôture' },
      { topic: 'notion-stock', label: 'Le stock : physique, réservé, disponible' },
      { topic: 'notion-approbations', label: 'Approbations : l’accord de la gérante' },
      { topic: 'glossaire-optique', label: 'Glossaire de l’optique' },
    ],
    keywords: [
      'dictionnaire',
      'lexique',
      'vocabulaire',
      'définition',
      'signification',
      'sens des mots',
      'numéro de dossier',
      'doublon',
      'visite',
      'file du jour',
      'examen',
      'révision',
      'brouillon',
      'facture émise',
      'acompte',
      'solde',
      'reste à encaisser',
      'reçu',
      'avoir',
      'remboursement',
      'contre-écriture',
      'remise',
      'remise commerciale',
      'devis',
      'fond de caisse',
      'espèces attendues',
      'écart de caisse',
      'stock disponible',
      'stock réservé',
      'stock physique',
      'lot',
      'retour',
      'approbation',
      'autorisation',
      'profil',
      'droit',
      'module',
      'catalogue',
      'règle fiscale',
      'taxe',
      'créance papier',
      'dette',
    ],
  },
  {
    id: 'depannage-messages',
    title: 'Comprendre les messages de l’application',
    summary:
      'Les messages qui s’affichent quand quelque chose ne passe pas, rangés par situation, avec ce qu’ils veulent dire et ce qu’il faut faire.',
    module: null,
    anyPermission: [],
    intro:
      'Quand quelque chose ne passe pas, l’application l’écrit en clair. Un message dit ce qui est su, pas davantage : « Serveur indisponible » ne veut pas dire que la donnée n’existe pas. Le serveur est l’ordinateur central où l’application enregistre vos données. Vos saisies restent à l’écran : lisez le message en entier avant de recommencer.',
    blocks: [
      {
        kind: 'faq',
        title: 'Connexion et session',
        items: [
          {
            q: '« Connexion impossible »',
            a: 'Votre identifiant ou votre mot de passe est refusé, ou un champ est vide : le message sous le champ le dit. L’identifiant reste, le mot de passe est effacé : ressaisissez-le. Un compte désactivé reçoit le même refus, voyez la gérante. Après plusieurs essais ratés en une minute, patientez avant de réessayer.',
          },
          {
            q: '« Session expirée : vos saisies sont conservées »',
            a: 'Votre session s’est fermée après 30 minutes sans activité. Rien n’est perdu. Cliquez sur « Se reconnecter », saisissez votre « Mot de passe », puis cliquez de nouveau sur « Se reconnecter ». Relancez ensuite l’enregistrement avec le bouton de reprise de l’écran, par exemple « Réessayer l’enregistrement ». Seul le compte qui a commencé la saisie peut la reprendre.',
          },
          {
            q: '« Compte différent »',
            a: 'Le compte connecté n’est plus celui qui a commencé cette saisie, par exemple après une connexion dans un autre onglet. Rien n’a été envoyé et vos saisies sont conservées. Reconnectez-vous avec le compte d’origine.',
          },
          {
            q: '« Confirmer votre mot de passe »',
            a: 'Une opération sensible redemande le mot de passe du compte connecté, par exemple pour créer un compte, saisir une règle fiscale, corriger une pièce, fusionner des fiches ou exporter. Saisissez-le, puis cliquez sur « Confirmer et reprendre ». Votre saisie est conservée et reprend sans doublon. La confirmation vaut environ un quart d’heure. Un écran peut aussi afficher « Confirmation du mot de passe demandée ».',
          },
          {
            q: '« La confirmation est différente du nouveau mot de passe. »',
            a: 'Les deux saisies du nouveau mot de passe ne sont pas identiques. Ressaisissez le même mot de passe dans « Nouveau mot de passe » et dans « Confirmation du nouveau mot de passe ». Il compte 12 caractères au moins, avec des lettres et des chiffres, et diffère de votre identifiant. Si « Mot de passe non changé » s’affiche, lisez la ligne dessous : après trop d’essais, patientez une minute.',
          },
          {
            q: '« Déconnexion impossible »',
            a: 'Le serveur n’a pas confirmé la fermeture de votre session : elle reste ouverte sur ce poste. Réessayez quand la connexion revient, avant de laisser le poste à une autre personne.',
          },
        ],
      },
      {
        kind: 'faq',
        title: 'Réseau et serveur',
        items: [
          {
            q: '« Hors ligne » ou « Serveur injoignable » dans l’en-tête',
            a: '« Hors ligne » : votre appareil n’a plus de réseau. « Serveur injoignable » : l’appareil est connecté, mais le serveur ne répond pas. Dans les deux cas, rien ne s’enregistre et vos saisies restent à l’écran. L’application revérifie seule la connexion au serveur. Reprenez quand l’en-tête redit « En ligne ».',
          },
          {
            q: '« Serveur indisponible »',
            a: 'Le serveur n’a pas répondu à la lecture d’un écran. Rien n’est conclu : ce n’est pas un résultat vide, et aucune ancienne copie n’est présentée comme à jour. Cliquez sur « Réessayer ». Même sens pour « Recherche serveur indisponible », « Fiche indisponible » et « Consultation indisponible ».',
          },
          {
            q: '« Enregistrement non confirmé »',
            a: 'Le serveur n’a pas répondu, ou a répondu par une erreur : la demande a peut-être été appliquée. Vos saisies sont conservées. Cliquez sur le bouton de reprise, par exemple « Réessayer l’encaissement ». La même demande repart une seule fois, sans doublon, tant que l’écran reste ouvert. Si vous l’avez quitté, vérifiez d’abord la liste concernée avant de recommencer.',
          },
          {
            q: '« Le serveur demande de patienter »',
            a: 'Le serveur est occupé ou limite le nombre de demandes. Rien n’a été appliqué et vos saisies sont conservées. Patientez quelques secondes, puis cliquez sur le bouton de reprise.',
          },
          {
            q: '« Réponse inattendue du serveur »',
            a: 'Le serveur a répondu par une page d’erreur au lieu de l’application. Rien n’est conclu. Réessayez dans un instant. Si cela dure, prévenez la gérante, qui contactera le prestataire.',
          },
        ],
      },
      {
        kind: 'faq',
        title: 'Droits et écrans',
        items: [
          {
            q: '« Accès refusé »',
            a: 'Votre compte n’a pas le droit d’ouvrir cet écran. L’application ne nomme pas le droit manquant. Cliquez sur « Revenir à l’accueil ». Si la tâche fait partie de votre travail, demandez à la gérante d’attribuer le droit.',
          },
          {
            q: '« Page introuvable »',
            a: 'L’adresse ne mène à aucun écran ouvert : elle est mal saisie, ou l’écran n’est pas ouvert dans votre cabinet. L’application répond de la même façon dans les deux cas. Cliquez sur « Retour à l’accueil ». Si l’écran devrait exister, prévenez la gérante : elle demandera au prestataire si son module est ouvert.',
          },
          {
            q: '« Droits insuffisants »',
            a: 'L’écran est ouvert, mais une lecture est refusée à votre compte, par exemple celle des dossiers cliniques. Demandez le droit à la gérante si la tâche fait partie de votre travail. Sur la page d’accueil, « Aucune action d’accueil ouverte à ce compte » veut dire qu’aucun raccourci n’est ouvert à votre compte. Utilisez le menu s’il montre des écrans.',
          },
        ],
      },
      {
        kind: 'faq',
        title: 'Saisie, doublons et conflits',
        items: [
          {
            q: '« Certaines informations sont à corriger »',
            a: 'Le résumé en haut du formulaire liste chaque champ à corriger. Chaque ligne reprend le message écrit sous le champ (par exemple « Saisissez votre identifiant. »). Cliquez sur une ligne pour aller au champ. Le formulaire n’est pas enregistré tant qu’un champ reste à corriger ; vos autres saisies sont conservées.',
          },
          {
            q: '« Des saisies ne sont pas encore enregistrées. Quitter cet écran sans les enregistrer ? »',
            a: 'Vous allez quitter un écran dont la saisie n’est pas enregistrée. Pour la garder, refusez de quitter, puis enregistrez. Si vous quittez, la saisie est perdue : l’application ne la conserve nulle part ailleurs.',
          },
          {
            q: '« La fiche a changé entre-temps »',
            a: 'Quelqu’un a modifié la fiche pendant votre saisie. Vos saisies sont conservées. Cliquez sur « Recharger la fiche » : vos modifications sont reportées sur la version actuelle. Les champs modifiés des deux côtés sont signalés par « Champs modifiés aussi par une autre personne ». Relisez, puis enregistrez de nouveau.',
          },
          {
            q: '« La consultation a changé entre-temps »',
            a: 'Une autre personne a modifié l’examen pendant votre saisie. Rien n’est écrasé et votre saisie est gardée. Cliquez sur « Recharger la consultation » : vos modifications sont reportées sur la version actuelle. Les valeurs modifiées des deux côtés sont signalées par « Valeurs modifiées aussi par une autre personne ». Relisez avant d’enregistrer.',
          },
          {
            q: '« Le brouillon a changé entre-temps »',
            a: 'Quelqu’un a modifié ce brouillon de facture pendant votre saisie. Cliquez sur « Relire le brouillon », puis choisissez « Garder ma saisie » ou « Reprendre la version actuelle ». Trois autres messages suivent le même principe : « L’article a changé entre-temps », « Le devis a changé entre-temps » et « La règle a changé entre-temps ». Relisez la version actuelle avant de reprendre.',
          },
          {
            q: 'Un message dit que le créneau choisi n’est plus libre',
            a: 'Une autre personne a pris le créneau pendant que vous choisissiez. L’écran affiche le message du serveur et relit les créneaux libres. Choisissez-en un autre, puis cliquez sur « Confirmer le rendez-vous ».',
          },
          {
            q: '« Cette arrivée est peut-être déjà enregistrée » ou « Émission peut-être déjà faite »',
            a: 'La demande a probablement abouti, mais la réponse n’est pas arrivée. Ne recommencez pas. Pour une arrivée, vérifiez la file du jour dans « Aujourd’hui ». Pour une facture, ouvrez-la et cherchez son numéro. Pour un encaissement, « Cet encaissement a peut-être déjà été enregistré » : cherchez son reçu.',
          },
          {
            q: '« Des fiches ressemblent à ce patient »',
            a: 'Des fiches existantes ressemblent à votre saisie par le nom, le téléphone ou la date de naissance. Cliquez sur « Ouvrir la fiche » pour comparer. Même personne : « Revenir au formulaire », sans créer de fiche. Autre personne : « Créer quand même ».',
          },
          {
            q: '« Vérification des doublons impossible »',
            a: 'Le serveur n’a pas pu chercher les fiches proches. Réessayez d’abord. « Créer sans vérification » ne sert qu’en cas de nécessité : contrôlez ensuite la liste des patients pour repérer un doublon.',
          },
        ],
      },
      {
        kind: 'faq',
        title: 'Ventes, caisse et stock',
        items: [
          {
            q: '« Prix ou remise au-delà de vos droits »',
            a: 'Les lignes dépassent ce que votre compte peut accorder. Cliquez sur « Demander une autorisation » et donnez un motif. Quand la gérante a cliqué sur « Accorder », enregistrez de nouveau le brouillon sans toucher aux lignes.',
          },
          {
            q: '« Stock insuffisant »',
            a: 'À l’émission, une ligne dépasse le stock disponible, que le message indique. La facture reste un brouillon. Baissez la quantité ou retirez la ligne, puis prévenez la gérante.',
          },
          {
            q: '« Le montant dépasse le reste à encaisser »',
            a: 'Un autre encaissement ou un avoir a eu lieu entre-temps. L’écran relit et affiche le reste à encaisser. Saisissez ce montant, ou cliquez sur « Encaisser le reste ».',
          },
          {
            q: '« Caisse non ouverte »',
            a: 'Un encaissement en espèces exige une session de caisse ouverte à votre nom. Cliquez sur « Ouvrir la caisse ». Mobile money, virement et chèque n’en dépendent pas.',
          },
          {
            q: '« Les espèces attendues ont changé depuis l’affichage »',
            a: 'Un encaissement en espèces est arrivé pendant votre comptage. Votre montant compté est conservé. Recomptez le tiroir, corrigez au besoin, puis clôturez de nouveau.',
          },
          {
            q: '« Remise avant règlement complet »',
            a: 'Il reste à encaisser sur cette facture : la remise des articles exige l’accord de la gérante pour ces quantités exactes. La caissière clique sur « Demander l’autorisation de remise ». Après l’accord, elle clique sur « Confirmer la remise », avec les mêmes quantités.',
          },
          {
            q: '« L’autorisation demandée n’est pas (ou plus) accordée »',
            a: 'Soit la gérante n’a pas encore décidé ou a refusé, soit l’accord est échu. Un accord ne vaut que pour l’opération exacte demandée : si le montant, une ligne ou le mode a changé, il ne s’applique plus. Attendez sa décision ou faites une nouvelle demande, puis renvoyez exactement la même opération.',
          },
          {
            q: '« Fusion impossible pour l’instant »',
            a: 'Le message liste ce qui bloque. Cela peut être une visite en cours, un examen non terminé, un brouillon de facture ou un rendez-vous à venir sur la fiche en double. Réglez chaque point, puis recommencez.',
          },
          {
            q: '« PDF non généré »',
            a: 'Le PDF de la facture ou du reçu n’a pas pu être préparé, mais la pièce existe. Pour un reçu, ne recommencez pas l’encaissement. Cliquez de nouveau sur « Aperçu de la facture (PDF) » ou sur « Aperçu du reçu (PDF) ».',
          },
        ],
      },
      {
        kind: 'table',
        title: 'Un réglage manque : qui agit',
        head: ['Message', 'Ce que cela veut dire', 'Qui agit'],
        rows: [
          [
            '« Aucune caisse active dans ce cabinet »',
            'La caisse principale n’a pas été créée à la mise en service : personne ne peut ouvrir de session de caisse.',
            'Le prestataire',
          ],
          [
            '« Aucun emplacement de stock »',
            'L’emplacement du stock n’a pas été créé à la mise en service.',
            'Le prestataire',
          ],
          [
            '« Aucun stock enregistré »',
            'Le stock initial n’a pas encore été saisi.',
            'La gérante, dans la section « Stock initial » de l’écran « Stock »',
          ],
          [
            '« Aucune échelle d’acuité n’est configurée pour ce cabinet »',
            'Les acuités ne se saisissent pas tant que l’échelle du cabinet n’est pas créée. Les autres étapes restent utilisables.',
            'Le prestataire',
          ],
          [
            '« Agenda non configuré »',
            'Aucune prestation ou ressource active : aucun horaire n’est proposé.',
            'La gérante, dans « Agenda », « Configuration »',
          ],
          [
            '« Demandé : en attente de production »',
            'Dans « Exports », l’archive n’est pas encore prête. Cliquez sur « Actualiser la liste » après quelques minutes. Si le message reste, ou devient « Échec de la production », le prestataire doit intervenir.',
            'Le prestataire',
          ],
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Le prestataire installe et entretient l’application ; certains messages l’appellent l’exploitant. Un message absent de cette liste ? Notez-le tel qu’il s’affiche, avec l’heure et l’écran, puis transmettez-le à la gérante, qui contactera le prestataire si besoin.',
      },
    ],
    related: [
      { topic: 'depannage-questions', label: 'Questions fréquentes' },
      { topic: 'depannage-limites', label: 'Ce que cette version ne fait pas encore' },
      { topic: 'se-connecter', label: 'Se connecter et se déconnecter' },
      { topic: 'notion-securite', label: 'Sécurité : compte, droits et traçabilité' },
      { topic: 'notion-modules', label: 'Pourquoi un écran apparaît ou non' },
      { topic: 'principes', label: 'Sept principes à connaître' },
    ],
    keywords: [
      'message',
      'erreur',
      'problème',
      'panne',
      'bug',
      'bloqué',
      'ça ne marche pas',
      'que faire',
      'session expirée',
      'se reconnecter',
      'mot de passe',
      'confirmation du mot de passe',
      'hors ligne',
      'serveur injoignable',
      'serveur indisponible',
      'réseau',
      'internet',
      'accès refusé',
      'page introuvable',
      'droits insuffisants',
      'enregistrement non confirmé',
      'réessayer',
      'conflit',
      'changé entre-temps',
      'modifié par une autre personne',
      'créneau',
      'doublon',
      'au-delà de vos droits',
      'stock insuffisant',
      'caisse non ouverte',
      'fusion impossible',
    ],
  },
  {
    id: 'depannage-questions',
    title: 'Questions fréquentes',
    summary:
      'Les questions que se pose le personnel : fiche en double, montant erroné, menu manquant, patient introuvable, document de test, mot de passe oublié.',
    module: null,
    anyPermission: [],
    intro:
      'Chaque réponse vaut pour cette version de l’application. Ouvrez la question pour lire la réponse. Si la vôtre n’y est pas, regardez les messages de l’application, puis demandez à la gérante.',
    blocks: [
      {
        kind: 'faq',
        title: 'Patients et dossiers',
        items: [
          {
            q: 'Une même personne a deux fiches. Comment les réunir ?',
            a: 'Aucune fiche ne se supprime ni ne se fusionne seule. Demandez à la gérante. Sur la fiche en double, elle clique sur « Fusionner avec une autre fiche ». Elle choisit la « Fiche à conserver », écrit le « Motif de la fusion » et confirme son mot de passe. Rien n’est effacé : la fiche absorbée renvoie vers la fiche conservée. La fusion est refusée si la fiche en double a une visite en cours, un examen non terminé, un brouillon de facture ou un rendez-vous à venir. Elle ne se défait pas.',
          },
          {
            q: 'Je ne trouve pas un patient. Que faire avant de créer une fiche ?',
            a: 'Dans « Rechercher un patient », saisissez au moins 2 caractères : nom, prénom, téléphone ou numéro de dossier. Les accents et les majuscules n’ont pas d’importance. Si l’écran affiche « Aucun résultat », vérifiez l’orthographe, puis cherchez par téléphone ou par numéro de dossier avant de créer une fiche. « Recherche serveur indisponible » ne prouve pas que le patient n’existe pas : réessayez d’abord.',
          },
          {
            q: 'Le patient ne connaît pas sa date de naissance, ou n’a pas de téléphone.',
            a: 'Laissez le champ vide et remplissez « Raison de l’absence de date de naissance » ou « Raison de l’absence de téléphone ». Aucune date n’est inventée : la fiche affiche « âge non renseigné ». Seul le nom est toujours obligatoire.',
          },
          {
            q: 'Deux patients ont le même téléphone. Est-ce une erreur ?',
            a: 'Non : un même téléphone peut servir à plusieurs patients, par exemple une famille. L’application ne le refuse jamais. Elle signale seulement des fiches proches avec « Des fiches ressemblent à ce patient » : comparez, puis décidez.',
          },
          {
            q: 'Une arrivée a été enregistrée par erreur.',
            a: 'Avant l’examen, cliquez sur « Annuler la visite » dans « Aujourd’hui ». Écrivez le « Motif de l’annulation (obligatoire) » : une information d’accueil, jamais médicale. La visite reste dans la file, marquée « Annulé ». L’annulation est refusée si l’examen a démarré ou si la visite porte une facture.',
          },
        ],
      },
      {
        kind: 'faq',
        title: 'Ventes, caisse et stock',
        items: [
          {
            q: 'Un encaissement a été saisi avec un mauvais montant.',
            a: 'Aucun bouton ne supprime un paiement ni un reçu. La gérante corrige : sur la facture, « Corrections de la facture », puis « Contre-passer le paiement », avec un motif. Le reçu d’origine garde son numéro. Encaissez ensuite le bon montant. La caissière clique sur « Demander l’autorisation » : c’est la gérante qui exécute.',
          },
          {
            q: 'Une facture émise contient une erreur. Peut-on la modifier ou l’annuler ?',
            a: 'Non : une facture émise ne se modifie ni ne se supprime. La gérante émet un avoir sur les lignes concernées, avec « Émettre un avoir ». Vous créez ensuite la bonne facture, qui a son propre numéro. Pour rendre de l’argent, la gérante utilise « Rembourser ». Un brouillon, lui, se modifie ou se ferme avec « Abandonner le brouillon ».',
          },
          {
            q: 'La connexion a coupé, ou un bouton a été cliqué deux fois, pendant un enregistrement.',
            a: 'Il n’y a pas de doublon si vous restez sur l’écran. Il affiche « Enregistrement non confirmé » : cliquez sur le bouton de reprise, par exemple « Réessayer l’encaissement ». La même demande repart une seule fois. Si vous avez quitté l’écran, vérifiez d’abord la facture, ses reçus ou la file du jour avant de recommencer.',
          },
          {
            q: 'Un patient veut repartir avec ses lunettes avant d’avoir tout réglé.',
            a: 'La remise avant règlement complet exige l’accord de la gérante. Sur la facture, section « Remise au patient », la caissière clique sur « Remettre au patient ». Elle clique ensuite sur « Demander l’autorisation de remise ». Après l’accord, elle clique sur « Confirmer la remise », avec les mêmes quantités. La gérante peut confirmer directement.',
          },
          {
            q: 'Un patient rapporte un article.',
            a: 'Seule la gérante enregistre un retour : sur la facture, section « Remise au patient », « Enregistrer un retour ». Un retour ne crée ni avoir ni remboursement. Pour rendre de l’argent, la gérante émet ensuite l’avoir, puis le remboursement. L’article ne revient en stock vendable que s’il est intact.',
          },
          {
            q: 'Les espèces comptées ne correspondent pas aux espèces attendues.',
            a: 'Seules les espèces comptent : mobile money, virement et chèque n’entrent pas dans le tiroir. Vérifiez aussi les remboursements et les dépenses en espèces. À la clôture, saisissez le « Montant compté dans le tiroir » et le « Motif de l’écart ». L’écart est dit sans jugement ; la gérante peut le revoir avec « Revoir l’écart ».',
          },
          {
            q: 'Le stock disponible est plus petit que le stock physique.',
            a: 'C’est normal : le disponible est le physique moins le réservé. Une facture émise réserve ses articles dès l’émission ; ils ne sortent du stock physique qu’à la remise au patient. Exemple : 5 en place, 1 réservé, 4 disponibles.',
          },
        ],
      },
      {
        kind: 'faq',
        title: 'Accès, mot de passe et connexion',
        items: [
          {
            q: 'Un écran ou un bouton manque.',
            a: 'Un écran n’apparaît que s’il est livré, ouvert par le prestataire et autorisé à votre profil. Un bouton absent veut dire que votre profil n’a pas ce droit, ou que la pièce n’est plus dans le bon état. Par exemple, une facture émise ne se modifie plus. La gérante attribue les droits dans « Paramètres », « Personnel ». Seul le prestataire ouvre un écran.',
          },
          {
            q: 'J’ai oublié mon mot de passe.',
            a: 'Demandez à la gérante de le réinitialiser : « Paramètres », « Personnel », votre nom, puis « Réinitialiser le mot de passe ». Elle vous remet le nouveau mot de passe en personne. Changez-le à votre connexion avec « Changer mon mot de passe ». Il n’y a pas de réinitialisation par courriel. Pour la gérante, le prestataire agit sur le serveur.',
          },
          {
            q: 'Je n’arrive pas à me connecter.',
            a: 'Vérifiez votre identifiant et votre mot de passe : chaque personne a son propre compte. Après plusieurs essais ratés en une minute, patientez avant de réessayer. Un compte désactivé reçoit le même refus : la gérante vérifie « Compte actif » dans « Personnel ». Si l’écran affiche « Serveur injoignable », la connexion exige le réseau.',
          },
          {
            q: 'L’en-tête affiche « Hors ligne » ou « Serveur injoignable ». Peut-on continuer à travailler ?',
            a: 'L’application exige Internet. Tant que la coupure dure, rien ne s’enregistre, mais vos saisies restent à l’écran. Attendez que l’en-tête redise « En ligne », puis enregistrez. Si la coupure se prolonge, notez sur papier le patient, l’article, le montant et le mode, puis ressaisissez ensuite. Le travail sans Internet est en cours de validation : il n’est pas ouvert au cabinet.',
          },
        ],
      },
      {
        kind: 'faq',
        title: 'Documents et rappels',
        items: [
          {
            q: 'Les documents portent « DOCUMENT DE TEST ». Peut-on les remettre aux patients ?',
            a: 'Non. Tant que les mentions officielles du cabinet ne sont pas validées, chaque PDF porte « DOCUMENT DE TEST ». Les numéros de facture et de reçu peuvent aussi commencer par TEST. Un tel document n’a aucune valeur comptable, fiscale, médicale ni légale. L’écran « Cabinet et documents » dit si le cabinet est en « Documents de test » ou en « Documents officiels activés ». Le prestataire active les documents officiels : la gérante ne le fait pas elle-même.',
          },
          {
            q: 'Je clique sur « Imprimer » et rien ne s’imprime.',
            a: '« Imprimer » ouvre le PDF dans la visionneuse du navigateur : imprimez-le ensuite avec Ctrl+P. Si le navigateur bloque l’ouverture, il affiche « Le navigateur a bloqué l’ouverture : le PDF a été téléchargé ». Ouvrez le fichier téléchargé et imprimez-le. Si le PDF d’un reçu n’a pas pu être généré, le reçu existe quand même : ne recommencez pas l’encaissement.',
          },
          {
            q: 'Un patient demande un rappel par SMS ou WhatsApp.',
            a: 'L’application n’envoie aucun SMS ni aucun message WhatsApp dans cette version. La liste « Patients à rappeler » dit qui contacter et quand : appelez ou écrivez vous-même, puis cliquez sur « Noter un contact ».',
          },
        ],
      },
      {
        kind: 'table',
        title: 'Qui contacter selon ce que vous voyez',
        head: ['Ce que vous voyez', 'Qui agit', 'Comment'],
        rows: [
          [
            'Un bouton ou un écran absent, « Accès refusé »',
            'La gérante',
            'Elle attribue le profil ou le droit manquant dans « Paramètres », « Personnel ». Si l’écran n’est pas ouvert au cabinet, voyez le prestataire.',
          ],
          [
            'Une demande d’autorisation : remise, correction, mouvement de caisse, dispense des frais d’examen',
            'La gérante',
            'Elle décide dans « Paramètres », « Autorisations », avec « Accorder » ou « Refuser ».',
          ],
          [
            'Un mot de passe oublié, un compte à désactiver',
            'La gérante',
            'Elle ouvre le compte dans « Personnel » : « Réinitialiser le mot de passe », ou « Compte actif » décoché.',
          ],
          [
            '« Page introuvable » pour un écran qui devrait exister, un réglage manquant, « Serveur injoignable » qui dure, les documents officiels, le mot de passe de la gérante',
            'Le prestataire',
            'Il ouvre les écrans, règle la mise en service et intervient sur le serveur. Notez le message exact et l’heure, puis passez par la gérante, qui le contacte.',
          ],
        ],
      },
    ],
    related: [
      { topic: 'depannage-messages', label: 'Comprendre les messages de l’application' },
      { topic: 'depannage-limites', label: 'Ce que cette version ne fait pas encore' },
      { topic: 'parcours-correction', label: 'Corriger une erreur, pas à pas' },
      { topic: 'profils', label: 'Les profils : qui peut faire quoi' },
      { route: 'mot-de-passe', label: 'Changer mon mot de passe' },
      { topic: 'notion-documents', label: 'Les documents PDF : aperçu, impression et mentions' },
    ],
    keywords: [
      'faq',
      'questions',
      'aide',
      'problème',
      'comment faire',
      'fiche en double',
      'doublon',
      'fusion',
      'montant erroné',
      'mauvais montant',
      'erreur de saisie',
      'annuler une facture',
      'supprimer une facture',
      'corriger',
      'menu manquant',
      'bouton manquant',
      'écran absent',
      'patient introuvable',
      'recherche',
      'document de test',
      'mot de passe oublié',
      'connexion',
      'imprimer',
      'écart de caisse',
      'stock',
      'retour',
      'rappel',
    ],
  },
  {
    id: 'depannage-limites',
    title: 'Ce que cette version ne fait pas encore',
    summary:
      'Les fonctions que l’application n’offre pas encore ou n’a pas ouvertes au cabinet, et ce que vous faites en attendant.',
    module: null,
    anyPermission: [],
    intro:
      'Ne promettez à un patient aucune des fonctions ci-dessous : elles n’existent pas encore ou ne sont pas ouvertes au cabinet. Si une fonction vous manque et ne figure pas ici, demandez à la gérante : elle contactera au besoin le prestataire.',
    blocks: [
      {
        kind: 'table',
        title: 'Fonction, état et solution provisoire',
        head: ['Fonction', 'Où elle en est', 'En attendant'],
        rows: [
          [
            'Travailler quand Internet est coupé',
            'En cours de validation : cette fonction n’est pas encore ouverte au cabinet. Rien ne s’enregistre tant que le réseau manque.',
            'Vos saisies restent à l’écran. Notez sur papier le patient, l’article, le montant et le mode. Ressaisissez-les au retour de la connexion : l’encaissement ressaisi porte la date de sa saisie.',
          ],
          [
            'Messages aux patients et campagnes',
            'Pas encore disponible : l’application n’envoie aucun SMS, aucun message WhatsApp ni aucun courriel, et aucun rappel de rendez-vous ou de contrôle ne part seul.',
            'La liste « Patients à rappeler » dit qui contacter et quand. Appelez ou écrivez vous-même, puis cliquez sur « Noter un contact ». Le « Canal souhaité par le patient » est une préférence, pas un envoi.',
          ],
          [
            'Envoi d’un document au patient',
            'Pas encore disponible : l’application n’envoie ni facture, ni reçu, ni ordonnance.',
            'Cliquez sur « Imprimer » ou sur « Télécharger le PDF », puis remettez le document vous-même.',
          ],
          [
            'Atelier',
            'Pas encore disponible : aucun écran ne suit une commande de verres à l’atelier.',
            'Facturez et remettez l’article comme d’habitude. Un article « Sur mesure (commandé) » se facture sans mouvement de stock. Suivez la fabrication en dehors de l’application.',
          ],
          [
            'Comptabilité et rapports financiers',
            'Pas encore disponible : export au format attendu par le comptable, rapport financier sur une période, rapprochement du mobile money et des virements avec les relevés.',
            '« Caisse du jour » donne les encaissements d’un jour. « Exports » remet des fichiers de données, pas une comptabilité. « Statistiques » compte les patients et les examens, pas les ventes. Rien n’est vérifié auprès de l’opérateur de mobile money : vous saisissez la « Référence de l’opération ».',
          ],
          [
            'Réception de marchandises et inventaire',
            'Pas encore disponible : commandes et réceptions fournisseur, inventaire complet, valeur du stock. Les champs « Seuil de stock bas (facultatif) » et « Délai d’alerte de péremption, en jours (facultatif) » du catalogue sont enregistrés, mais aucune alerte ne s’affiche.',
            'Le stock évolue par le stock initial, les remises au patient, les retours et « Casse ou ajustement ». Contrôlez les disponibilités et les lots dans « Stock ».',
          ],
          [
            'Comparer deux examens d’un patient',
            'L’écran « Comparer deux examens » existe, mais aucun bouton ne l’ouvre encore.',
            'Ouvrez les deux examens l’un après l’autre, depuis l’onglet « Activité » du dossier. Seule la comparaison des révisions d’un même examen est proposée : « Révisions et comparaison ».',
          ],
          [
            'Lire le journal des actions',
            'Chaque action importante est consignée (qui, quand, quoi), mais aucun écran ne permet encore de lire ce journal.',
            'Les reçus indiquent « Encaissé par » et la fiche d’un patient indique sa « Dernière modification ».',
          ],
          [
            'Réinitialiser son mot de passe soi-même',
            'Pas disponible : il n’existe pas de réinitialisation par courriel.',
            'Demandez à la gérante : « Paramètres », « Personnel », « Réinitialiser le mot de passe ». Celui d’une gérante se réinitialise sur le serveur, par le prestataire.',
          ],
          [
            'Ouvrir un écran, activer les documents officiels, choisir les séries de numéros',
            'Réservé au prestataire : aucun réglage de l’application ne le permet, même à la gérante.',
            'La gérante le demande au prestataire. Tant que les documents officiels ne sont pas activés, chaque PDF porte « DOCUMENT DE TEST ».',
          ],
        ],
      },
    ],
    related: [
      { topic: 'depannage-questions', label: 'Questions fréquentes' },
      { topic: 'depannage-messages', label: 'Comprendre les messages de l’application' },
      { topic: 'bienvenue', label: 'Bienvenue dans l’application' },
      { topic: 'notion-modules', label: 'Pourquoi un écran apparaît ou non' },
      {
        topic: 'parcours-suivi',
        label: 'Suivre le patient : contrôle recommandé et patients à rappeler',
      },
    ],
    keywords: [
      'pas encore disponible',
      'limites',
      'manque',
      'absent',
      'futur',
      'travail sans internet',
      'sans connexion',
      'hors ligne',
      'sms',
      'whatsapp',
      'rappel',
      'envoi automatique',
      'atelier',
      'comptabilité',
      'export comptable',
      'rapprochement',
      'mobile money',
      'réception de stock',
      'fournisseur',
      'inventaire',
      'alerte de stock',
      'péremption',
      'comparer deux examens',
      'journal',
      'audit',
    ],
  },
]
