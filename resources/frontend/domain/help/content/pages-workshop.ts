import type { PageHelp } from '../model'

/**
 * Aide intégrée des écrans de l’atelier optique (L1D04) : suivi des commandes confiées aux
 * laboratoires, création depuis une ligne facturée et une ordonnance validée, bon laboratoire
 * anonymisé et cycle contrôle qualité / reprise / remise.
 */
export const PAGES_WORKSHOP: readonly PageHelp[] = [
  {
    route: 'workshop',
    title: 'Atelier optique',
    module: 'workshop',
    anyPermission: ['workshop.manage'],
    purpose:
      'Vous suivez ici toutes les commandes de montage confiées aux laboratoires optiques : état d’avancement, retards par rapport à la date prévue et archivage du bon laboratoire anonymisé.',
    actions: [
      {
        label: 'Nouvelle commande atelier',
        effect:
          'Ouvre la création d’une commande à partir d’une ligne facturée et d’une ordonnance validée.',
      },
      {
        label: 'État de la commande',
        effect: 'Filtre la liste sur un état précis (ou « Tous les états » pour tout revoir).',
      },
      {
        label: 'Uniquement les commandes en retard',
        effect: 'N’affiche que les commandes non terminées dont l’échéance prévue est dépassée.',
      },
      {
        label: 'Ouvrir',
        effect:
          'Ouvre la fiche détaillée d’une commande pour générer son bon laboratoire ou la faire avancer.',
      },
    ],
    tasks: [
      {
        id: 'filtrer-retards-atelier',
        title: 'Repérer les commandes en retard',
        steps: [
          'Cochez « Uniquement les commandes en retard ».',
          'Cliquez sur « Ouvrir » sur une commande pour consulter les échanges et son échéance.',
        ],
        result: 'Vous voyez uniquement les montages en attente qui dépassent la date convenue.',
      },
    ],
    rules: [
      'Aucun montant ni règlement n’est affiché sur l’écran de l’atelier.',
      'Une commande terminée (« Remise au patient » ou « Annulée ») n’est jamais considérée en retard.',
      'Chaque bon laboratoire archivé ne porte que le numéro de dossier du patient, sans nom ni téléphone.',
    ],
    next: [
      {
        route: 'atelier-nouveau',
        label: 'Nouvelle commande atelier',
        why: 'Pour confier un nouveau montage au laboratoire à partir d’une facture émise.',
      },
      {
        route: 'suppliers',
        label: 'Fournisseurs',
        why: 'Pour créer ou activer un laboratoire optique.',
      },
    ],
    tips: [
      'Lorsqu’une monture passe par une reprise puis revient au contrôle conforme, le numéro de révision indique qu’un nouvel exemplaire est prêt.',
    ],
    problems: [
      {
        symptom: '« Aucune commande atelier enregistrée »',
        remedy:
          'Aucune commande n’a encore été créée. Cliquez sur « Créer une commande atelier » après avoir émis une facture contenant des verres ou une monture.',
      },
    ],
  },
  {
    route: 'atelier-nouveau',
    title: 'Nouvelle commande atelier',
    module: 'workshop',
    anyPermission: ['workshop.manage'],
    purpose:
      'Vous créez ici une commande pour le laboratoire à partir d’une ligne de facture émise, en y rattachant l’ordonnance validée du patient et les mesures de montage.',
    actions: [
      {
        label: 'Rechercher',
        effect:
          'Filtre les lignes de factures disponibles par numéro de facture, patient ou article.',
      },
      {
        label: 'Créer la commande atelier',
        effect:
          'Enregistre la commande, fige les mesures de l’ordonnance sélectionnée et ouvre sa fiche.',
      },
      {
        label: 'Retour à l’atelier',
        effect: 'Revient à la liste des commandes sans rien enregistrer.',
      },
    ],
    tasks: [
      {
        id: 'creer-commande-atelier',
        title: 'Créer une commande pour le laboratoire',
        steps: [
          'Sélectionnez la ligne de facture à confier au laboratoire.',
          'Vérifiez ou sélectionnez l’ordonnance optique validée du patient.',
          'Choisissez le laboratoire optique dans « Laboratoire optique » et vérifiez « Type de verre sur le bon laboratoire » et « Quantité à commander ».',
          'Renseignez si besoin l’échéance prévue, la monture et les écarts pupillaires ou hauteurs de montage.',
          'Cliquez sur « Créer la commande atelier ».',
        ],
        result:
          'La fiche de commande s’ouvre avec sa référence officielle et son bon laboratoire anonymisé prêt à être généré.',
      },
    ],
    rules: [
      'Seules les lignes d’articles d’optique issues de factures émises avec un reliquat à commander apparaissent.',
      'Le type de verre et les mesures OD/OG sont figés à la création : si une nouvelle ordonnance est validée plus tard pour ce patient, cette commande conserve les valeurs d’origine.',
      'La quantité commandée ne peut pas dépasser le reliquat disponible sur la ligne de facture.',
    ],
    next: [
      {
        route: 'factures',
        label: 'Factures',
        why: 'Pour retrouver une facture en brouillon encore non émise.',
      },
      {
        route: 'suppliers',
        label: 'Fournisseurs',
        why: 'Pour vérifier qu’un laboratoire optique est bien actif.',
      },
    ],
    tips: [
      'Si vous ajustez l’écart pupillaire ou la hauteur de montage ici, seule la commande atelier prend cette précision sans modifier l’ordonnance médicale.',
    ],
    problems: [
      {
        symptom: '« Aucune ordonnance validée pour ce patient »',
        remedy:
          'Ouvrez le dossier du patient pour valider son examen optique ou transcrire une ordonnance externe avant de lancer la commande.',
      },
      {
        symptom: '« Aucun laboratoire optique actif »',
        remedy:
          'Demandez à la gérante d’ajouter ou d’activer un fournisseur de type laboratoire optique.',
      },
    ],
  },
  {
    route: 'atelier-detail',
    title: 'Commande atelier',
    module: 'workshop',
    anyPermission: ['workshop.manage'],
    purpose:
      'Vous consultez ici les paramètres optiques figés de la commande, générez son bon laboratoire anonymisé et faites avancer chaque étape jusqu’à la remise au patient.',
    actions: [
      {
        label: 'Générer et afficher le bon laboratoire',
        effect:
          'Crée l’original anonymisé (sans nom ni montant) et le dépose dans les documents du cabinet.',
      },
      {
        label: 'Enregistrer la réception labo',
        effect: 'Marque les verres comme reçus du laboratoire.',
      },
      {
        label: 'Passer en montage',
        effect: 'Indique que le montage en atelier a commencé.',
      },
      {
        label: 'Envoyer au contrôle qualité',
        effect: 'Transmet la monture montée à la vérification finale.',
      },
      {
        label: 'Valider : conforme (prête)',
        effect: 'Déclare le contrôle qualité conforme et marque l’équipement prêt à remettre.',
      },
      {
        label: 'Non conforme : renvoyer en montage',
        effect: 'Retourne la commande en montage avec le motif constaté.',
      },
      {
        label: 'Confirmer la remise au patient',
        effect:
          'Clôture la commande en la rattachant à la ligne de remise physique confirmée sur la facture.',
      },
      {
        label: 'Enregistrer la reprise',
        effect:
          'Renvoie une commande reçue, en montage, en contrôle ou prête vers le laboratoire ou l’atelier.',
      },
      {
        label: 'Consigner au journal',
        effect: 'Enregistre une note ou met à jour la référence donnée par le laboratoire.',
      },
      {
        label: 'Annuler cette commande',
        effect: 'Annule définitivement la commande et libère sa quantité sur la ligne de facture.',
      },
    ],
    tasks: [
      {
        id: 'produire-bon-labo',
        title: 'Générer et imprimer le bon laboratoire',
        steps: [
          'Ouvrez la fiche de la commande atelier.',
          'Cliquez sur « Générer et afficher le bon laboratoire ».',
          'Vérifiez l’aperçu puis téléchargez ou imprimez le document pour le laboratoire.',
        ],
        result:
          'L’original anonymisé est conservé et accessible pour le laboratoire sans aucune donnée d’identité ou de tarif.',
      },
      {
        id: 'cloturer-atelier-remise',
        title: 'Contrôler puis clôturer à la remise',
        steps: [
          'Faites avancer les étapes jusqu’à « Valider : conforme (prête) ».',
          'Confirmez d’abord la remise physique au patient depuis la fiche facture.',
          'Revenez sur cette fiche, choisissez la ligne de remise correspondante et cliquez sur « Confirmer la remise au patient ».',
        ],
        result: 'La commande passe à « Remise au patient » et toutes les étapes restent tracées.',
      },
    ],
    rules: [
      'Toutes les étapes et notes sont enregistrées dans un journal immuable : rien ne s’efface.',
      'Le passage à « Remise au patient » exige une remise physique déjà confirmée sur la facture correspondante.',
      'Le bon laboratoire ne montre jamais le nom du patient, son téléphone, ses antécédents ni les prix.',
    ],
    next: [
      {
        route: 'workshop',
        label: 'Atelier optique',
        why: 'Pour revenir à la liste de toutes les commandes atelier.',
      },
      {
        route: 'factures',
        label: 'Factures',
        why: 'Pour retrouver la facture correspondante et enregistrer la remise physique.',
      },
    ],
    tips: [
      'Si une pièce doit être refaite après avoir été déclarée prête, utilisez « Déclarer une reprise atelier / laboratoire » plutôt que d’annuler.',
    ],
    problems: [
      {
        symptom: '« Remise physique attendue avant clôture »',
        remedy:
          'Ouvrez la facture liée, confirmez la remise au patient dans la section des livraisons, puis revenez valider la clôture ici.',
      },
    ],
  },
]
