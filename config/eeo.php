<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Paramètres métier d'Eagle's Eye Optics Medical
    |--------------------------------------------------------------------------
    |
    | Les instants sont enregistrés en UTC (config('app.timezone') reste « UTC », ainsi que la
    | session MySQL) ; le fuseau métier ci-dessous sert aux dates civiles et à l'affichage.
    | Valeurs proposées d'après les sources du projet (hypothèse A02, fichier 15) : XAF et
    | Africa/Douala, cabinet unique. La valeur effective par cabinet reste portée par la table
    | `clinics` (F04/F05).
    |
    */

    'clinic_timezone' => env('CLINIC_TIMEZONE', 'Africa/Douala'),

    /*
    | Cabinet servi par l'installation (ULID). Vide : l'unique cabinet de la base est utilisé ; s'il en
    | existe plusieurs, la connexion est refusée tant que la valeur n'est pas définie (contrat 23).
    */
    'clinic_id' => env('EEO_CLINIC_ID'),

    /*
    | Durée de validité d'une réauthentification pour les opérations sensibles (approbations, droits,
    | exports globaux), en secondes (fichier 09).
    */
    'reauthentication_ttl' => (int) env('EEO_REAUTHENTICATION_TTL', 900),

    'clinic_currency' => env('CLINIC_CURRENCY', 'XAF'),

    // Limites de débit par compte (requêtes par minute).
    'rate_limits' => [
        // Connexions par adresse IP : 20 par minute. Relevée seulement pour les parcours e2e (EEO_RATE_LOGIN_IP).
        'login_ip' => (int) env('EEO_RATE_LOGIN_IP', 20),
        'patient_search' => (int) env('EEO_RATE_PATIENT_SEARCH', 120),
        // Lectures d'un dossier clinique (consultation, révision, prescription) : 60 par minute et par compte. Les
        // identifiants sont des ULID non devinables, mais la file du jour les rend à qui détient clinical.read : la
        // limite empêche de parcourir tous les dossiers à la chaîne (chaque lecture est de plus tracée).
        'consultation_read' => (int) env('EEO_RATE_CONSULTATION_READ', 60),
        // Confirmations du mot de passe (réauthentification) : 5 par minute et par compte. Relevée seulement pour les
        // parcours e2e (EEO_RATE_REAUTHENTICATE) : préparer un poste en demande quatre ou cinq à la suite, et deux parcours
        // enchaînés partagent la même minute.
        'reauthenticate' => (int) env('EEO_RATE_REAUTHENTICATE', 5),
    ],

    /*
    |--------------------------------------------------------------------------
    | Mise en service progressive des modules
    |--------------------------------------------------------------------------
    |
    | Codes des modules ouverts aux utilisateurs, séparés par des virgules (voir App\Support\Modules).
    | Vide : aucun module métier n'est exposé, ni à l'écran ni dans l'API. Cette liste appartient au
    | déploiement ; elle n'est pas un paramètre du cabinet.
    |
    */

    'enabled_modules' => array_values(array_filter(
        array_map('trim', explode(',', (string) env('EEO_ENABLED_MODULES', ''))),
        static fn (string $code): bool => $code !== '',
    )),

    /*
    |--------------------------------------------------------------------------
    | Transactions du chemin central de commandes (F07, contrat 23)
    |--------------------------------------------------------------------------
    |
    | max_attempts : tentatives internes sur interblocage (3 au plus), puis erreur réessayable SERVER_BUSY.
    | lock_wait_timeout_seconds : attente maximale d'un verrou de ligne (innodb_lock_wait_timeout de la
    | session) ; au-delà, SERVER_BUSY sans nouvelle tentative interne. Le verrou du cabinet sérialise les
    | mutations centrales : mesurer avant de l'affiner (fichier 05).
    |
    */

    'transactions' => [
        'max_attempts' => (int) env('EEO_TRANSACTION_MAX_ATTEMPTS', 3),
        'lock_wait_timeout_seconds' => (int) env('EEO_LOCK_WAIT_TIMEOUT', 10),
    ],

    /*
    |--------------------------------------------------------------------------
    | Postes hors-ligne
    |--------------------------------------------------------------------------
    |
    | max_clock_skew_seconds : tolérance entre l'horloge d'un poste et l'heure du serveur pour le contexte
    | d'autorisation HISTORIQUE d'une commande synchronisée (au-delà : revue par la gérante). Règles
    | d'horloge à confirmer avec la préparation des postes (O02).
    |
    */

    'offline' => [
        'max_clock_skew_seconds' => (int) env('EEO_MAX_CLOCK_SKEW', 300),
        // Préparation des postes (O02) : fichier PEM PRIVÉ de la clé ES256 qui signe les grants (créé par
        // `php artisan eeo:offline:signing-key`, hors de la racine web, jamais dans le dépôt ni MySQL) ; vide =
        // storage/app/private/offline/grant-signing.pem.
        'signing_key_path' => (string) env('EEO_OFFLINE_SIGNING_KEY_PATH', ''),
        // Validité d'un grant (fichier 19 : 72 h proposées après la dernière préparation) et plafond d'une durée
        // demandée par la gérante (à confirmer avec la politique de sécurité du cabinet).
        'grant_hours' => (int) env('EEO_OFFLINE_GRANT_HOURS', 72),
        'grant_max_hours' => (int) env('EEO_OFFLINE_GRANT_MAX_HOURS', 168),
        // Fraîcheur de la preuve de possession de la clé d'un poste à l'enrôlement (secondes, dans les deux sens).
        'proof_max_age_seconds' => 600,
        // Ressources d'un poste (O03) : taille maximale d'une plage de numéros préparée en une fois (fichier 19 :
        // « préparer suffisamment de numéros pour la durée prévue ») et une seule caisse hors-ligne principale
        // (fichier 19, L0) : une ressource financière n'est préparée que si aucun autre poste n'en détient.
        'range_max_size' => (int) env('EEO_OFFLINE_RANGE_MAX_SIZE', 1000),
        'single_financial_device' => (bool) env('EEO_OFFLINE_SINGLE_FINANCIAL_DEVICE', true),
        // Synchronisation (O05 ; contrat 23 : limites initiales proposées) : commandes et octets d'un envoi, changements
        // d'une page de pull ; identifiant de la clé qui rechiffre les charges reçues (`APP_KEY`, voir SyncPayloads).
        'push_max_commands' => 50,
        'push_max_bytes' => 2 * 1024 * 1024,
        'pull_page_size' => 100,
        'sync_key_id' => 'app-key-1',
    ],

    /*
    |--------------------------------------------------------------------------
    | Documents de production
    |--------------------------------------------------------------------------
    |
    | Interrupteur d'environnement. Tant qu'il vaut « false », tout document est un document TEST
    | clairement marqué (mentions légales, logo et régime de taxe non validés : Q03). Il ne peut
    | être passé à « true » qu'après validation des paramètres réels ; la règle exacte de
    | combinaison avec clinics.production_documents_enabled est définie avec les documents (L0-06).
    |
    */

    'production_documents_enabled' => (bool) env('PRODUCTION_DOCUMENTS_ENABLED', false),

    // Originaux PDF déposés sur le serveur (D01) : taille maximale d'un document, en octets.
    'documents' => [
        'max_bytes' => (int) env('EEO_DOCUMENT_MAX_BYTES', 5242880),
    ],

    /*
    |--------------------------------------------------------------------------
    | Facturation, caisse et paiement de l'examen (B01 à B05)
    |--------------------------------------------------------------------------
    |
    | Aucune de ces valeurs n'est un prix, une taxe ni une identité légale : elles règlent des CONTRÔLES, avec des
    | valeurs prudentes par défaut. Les prix, taxes et séries réels viennent de la gérante (Q03, Q04) et ne se
    | trouvent jamais dans le dépôt.
    |
    | exam_fee_control : `off` (par défaut) laisse le contrôle du paiement de l'examen inactif (« non contrôlé ») ;
    |   `billed` exige, au démarrage d'un examen, la facture de frais de CETTE visite réglée ou une dérogation exacte
    |   de la gérante (App\Domain\Billing\BilledExamFeeControl). Ne l'activer qu'avec l'article ci-dessous et l'écran
    |   adapté (docs/implementation/billing.md).
    | exam_fee_item_reference : référence du catalogue de l'article « frais d'examen » (profil `exam_fee.collect`,
    |   contrôle du paiement de l'examen). Vide : aucun article n'est désigné, le profil ne peut rien facturer.
    | discount_cap_percent : plafond de remise de ligne (en % du brut) pour un compte SANS autorité de prix
    |   (`catalog.manage`) ; zéro par défaut : sans approbation exacte (B06), pas de remise. La gérante remise
    |   jusqu'au brut de la ligne.
    | payment_reference_required : modes de règlement dont la référence est obligatoire (mobile money, virement).
    |
    */

    'billing' => [
        'exam_fee_control' => env('EEO_EXAM_FEE_CONTROL', 'off'),
        'exam_fee_item_reference' => env('EEO_EXAM_FEE_ITEM_REFERENCE'),
        'discount_cap_percent' => env('EEO_DISCOUNT_CAP_PERCENT', '0'),
        'payment_reference_required' => array_values(array_filter(
            array_map('trim', explode(',', (string) env('EEO_PAYMENT_REFERENCE_REQUIRED', 'MTN_MOMO,ORANGE_MONEY,BANK_TRANSFER'))),
            static fn (string $method): bool => $method !== '',
        )),
    ],

    /*
    |--------------------------------------------------------------------------
    | Approbations exactes (B06)
    |--------------------------------------------------------------------------
    |
    | ttl_minutes : durée de validité d'une approbation ACCORDÉE par la gérante (échéance = la plus proche de celle
    |   proposée par la demande et de l'instant de la décision + cette durée), bornée de 1 minute à 24 heures. 60 minutes
    |   par défaut : proposition à confirmer avec la gérante (Q07). Une approbation échue ne redevient jamais valable.
    |
    */

    'approvals' => [
        'ttl_minutes' => (int) env('EEO_APPROVAL_TTL_MINUTES', 60),
    ],

    /*
    |--------------------------------------------------------------------------
    | Numérotation des pièces financières (fichier 03)
    |--------------------------------------------------------------------------
    |
    | Format proposé `<préfixe>-AAAA-NNNNNN` (série par cabinet et par année civile du fuseau du cabinet). Les préfixes
    | sont ceux des séries papier à CHOISIR avec la gérante avant la bascule (Q03, Q05) : tant qu'ils ne le sont pas,
    | ils commencent par TEST et tout numéro émis est visiblement un numéro de test. Modifier un préfixe en cours
    | d'année ne renumérote rien : la série continue (le numéro émis ne change jamais).
    |
    */

    'numbering' => [
        'width' => (int) env('EEO_NUMBER_WIDTH', 6),
        'prefixes' => [
            'INVOICE' => env('EEO_NUMBER_PREFIX_INVOICE', 'TEST-FAC'),
            'RECEIPT' => env('EEO_NUMBER_PREFIX_RECEIPT', 'TEST-REC'),
            'CREDIT_NOTE' => env('EEO_NUMBER_PREFIX_CREDIT_NOTE', 'TEST-AV'),
            'REFUND' => env('EEO_NUMBER_PREFIX_REFUND', 'TEST-RMB'),
            // Reprise d'une créance papier (X01) : série distincte, jamais un numéro de facture du jour.
            'LEGACY_BALANCE' => env('EEO_NUMBER_PREFIX_LEGACY_BALANCE', 'TEST-REP'),
            // Devis (L1D07) : série distincte, ni facture ni reçu ; préfixe réel à choisir avec la gérante (Q03).
            'QUOTE' => env('EEO_NUMBER_PREFIX_QUOTE', 'TEST-DEV'),
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Intégrations externes
    |--------------------------------------------------------------------------
    |
    | « fake » : doubles de test uniquement, aucun message ni appel réel à un fournisseur pendant le
    | développement. Aucune clé fournisseur n'est lue ici ni versionnée.
    |
    */

    'integrations' => [
        'mode' => env('EEO_INTEGRATIONS_MODE', 'fake'),
    ],

];
