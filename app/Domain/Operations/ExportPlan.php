<?php

namespace App\Domain\Operations;

use Illuminate\Support\Facades\DB;

/**
 * Plan d'un export contrôlé (X02, « restitution utilisable avec dictionnaire et pièces ») : tables exportées par
 * type, colonnes jamais exportées (secrets, jetons, chemins privés), filtre du dossier d'UN patient. Règles pures :
 * aucune lecture ni écriture ici (`App\Support\Exports\ExportBuilder` produit l'archive).
 *
 *   PATIENT_RECORD  le dossier d'un patient : identité, visites, consultations et toutes leurs rubriques, révisions,
 *                   prescriptions, ordonnances, contrôles recommandés (droit clinical.export) ;
 *   PATIENTS        les identités et visites (administratif, aucune donnée clinique ni financière) ;
 *   FINANCE         catalogue, factures, encaissements, reçus, corrections, caisse, créances reprises ;
 *   STOCK           articles, emplacements, positions, lots, mouvements, réserves, remises, retours ;
 *   FULL_HANDOVER   toutes les tables du cabinet et les pièces privées (remise des données à la fin du contrat).
 *
 * Les types autres que PATIENT_RECORD exigent export.global. Une sauvegarde ou un export du SERVEUR ne contient
 * jamais les saisies encore en attente sur un poste hors ligne (le manifeste le dit).
 */
final class ExportPlan
{
    public const TYPES = ['PATIENT_RECORD', 'PATIENTS', 'FINANCE', 'STOCK', 'FULL_HANDOVER'];

    /** Durée de mise à disposition d'une archive prête (heures). */
    public const RETENTION_HOURS = 48;

    private const PATIENTS = ['patient_records', 'visits', 'appointments'];

    private const FINANCE = [
        'tax_rules', 'catalog_items', 'quotes', 'quote_lines', 'quote_revisions', 'invoices', 'invoice_lines', 'payments',
        'receipts', 'payment_reversals', 'credit_notes', 'credit_note_lines', 'refunds', 'legacy_balance_imports',
        'cash_registers', 'cash_sessions', 'expense_categories', 'cash_movements',
        'payment_reconciliations', 'payment_reconciliation_lines', 'document_number_usages',
    ];

    private const STOCK = [
        'catalog_items', 'stock_locations', 'stock_positions', 'stock_lots', 'stock_movements', 'stock_reservations',
        'stock_alerts', 'deliveries', 'delivery_lines', 'physical_returns', 'suppliers', 'goods_receipts',
        'goods_receipt_lines', 'inventory_counts', 'inventory_count_lines',
    ];

    /** Rôles canoniques utilisables pour restreindre la portée d'un export. */
    private const ROLES = ['CASHIER', 'CLINICIAN', 'MANAGER', 'RECEPTION'];

    /** Permissions par table pour filtrage d'export contrôlé (aucun élargissement hors profil). */
    private const TABLE_PERMISSIONS = [
        'consultations' => 'clinical.read',
        'consultation_complaints' => 'clinical.read',
        'consultation_ametropias' => 'clinical.read',
        'consultation_histories' => 'clinical.read',
        'consultation_history_terms' => 'clinical.read',
        'visual_acuities' => 'clinical.read',
        'refraction_measurements' => 'clinical.read',
        'optical_prescriptions' => 'clinical.read',
        'optical_prescription_eyes' => 'clinical.read',
        'optical_prescription_treatments' => 'clinical.read',
        'medication_orders' => 'clinical.read',
        'clinical_amendments' => 'clinical.read',
        'clinical_revisions' => 'clinical.read',
        'quotes' => 'finance.global.read',
        'quote_lines' => 'finance.global.read',
        'quote_revisions' => 'finance.global.read',
        'invoices' => 'finance.global.read',
        'invoice_lines' => 'finance.global.read',
        'payments' => 'finance.global.read',
        'receipts' => 'finance.global.read',
        'payment_reversals' => 'finance.global.read',
        'credit_notes' => 'finance.global.read',
        'credit_note_lines' => 'finance.global.read',
        'refunds' => 'finance.global.read',
        'legacy_balance_imports' => 'finance.global.read',
        'cash_registers' => 'finance.global.read',
        'cash_sessions' => 'finance.global.read',
        'expense_categories' => 'finance.global.read',
        'cash_movements' => 'finance.global.read',
        'payment_reconciliations' => 'finance.global.read',
        'payment_reconciliation_lines' => 'finance.global.read',
        'tax_rules' => 'finance.global.read',
        'document_number_usages' => 'finance.global.read',
        'stock_locations' => 'stock.read',
        'stock_positions' => 'stock.read',
        'stock_lots' => 'stock.read',
        'stock_movements' => 'stock.read',
        'stock_reservations' => 'stock.read',
        'stock_alerts' => 'stock.read',
        'deliveries' => 'stock.read',
        'delivery_lines' => 'stock.read',
        'physical_returns' => 'stock.read',
        'suppliers' => 'stock.read',
        'goods_receipts' => 'stock.read',
        'goods_receipt_lines' => 'stock.read',
        'inventory_counts' => 'stock.read',
        'inventory_count_lines' => 'stock.read',
        'workshop_orders' => 'workshop.manage',
        'workshop_order_eyes' => 'workshop.manage',
        'workshop_events' => 'workshop.manage',
        'audit_events' => 'audit.read',
        'patient_records' => 'patient.read',
        'visits' => 'patient.read',
        'appointments' => 'patient.read',
        'follow_up_plans' => 'patient.read',
        'patient_merges' => 'patient.read',
        'enrolled_devices' => 'audit.read',
        'offline_grants' => 'audit.read',
        'sync_conflicts' => 'audit.read',
    ];

    /** Règles de filtrage sur période civile [from, to] (UTC ou DATE selon table). */
    private const PERIOD_RULES = [
        'visits' => ['kind' => 'timestamp', 'column' => 'occurred_at'],
        'appointments' => ['kind' => 'timestamp', 'column' => 'starts_at'],
        'follow_up_plans' => ['kind' => 'civil_date', 'column' => 'recommended_date'],
        'consultations' => ['kind' => 'timestamp', 'column' => 'effective_at'],
        'consultation_complaints' => ['kind' => 'parent', 'column' => 'consultation_id', 'parent' => 'consultations'],
        'consultation_ametropias' => ['kind' => 'parent', 'column' => 'consultation_id', 'parent' => 'consultations'],
        'consultation_histories' => ['kind' => 'parent', 'column' => 'consultation_id', 'parent' => 'consultations'],
        'visual_acuities' => ['kind' => 'parent', 'column' => 'consultation_id', 'parent' => 'consultations'],
        'refraction_measurements' => ['kind' => 'parent', 'column' => 'consultation_id', 'parent' => 'consultations'],
        'medication_orders' => ['kind' => 'parent', 'column' => 'consultation_id', 'parent' => 'consultations'],
        'clinical_amendments' => ['kind' => 'parent', 'column' => 'consultation_id', 'parent' => 'consultations'],
        'optical_prescriptions' => ['kind' => 'timestamp', 'column' => 'created_at'],
        'optical_prescription_eyes' => ['kind' => 'parent', 'column' => 'prescription_id', 'parent' => 'optical_prescriptions'],
        'optical_prescription_treatments' => ['kind' => 'parent', 'column' => 'prescription_id', 'parent' => 'optical_prescriptions'],
        'quotes' => ['kind' => 'timestamp', 'column' => 'created_at'],
        'quote_lines' => ['kind' => 'parent', 'column' => 'quote_id', 'parent' => 'quotes'],
        'quote_revisions' => ['kind' => 'parent', 'column' => 'quote_id', 'parent' => 'quotes'],
        'invoices' => ['kind' => 'timestamp', 'column' => 'created_at'],
        'invoice_lines' => ['kind' => 'parent', 'column' => 'invoice_id', 'parent' => 'invoices'],
        'payments' => ['kind' => 'timestamp', 'column' => 'effective_at'],
        'receipts' => ['kind' => 'timestamp', 'column' => 'issued_at'],
        'payment_reversals' => ['kind' => 'timestamp', 'column' => 'recorded_at'],
        'credit_notes' => ['kind' => 'timestamp', 'column' => 'issued_at'],
        'credit_note_lines' => ['kind' => 'parent', 'column' => 'credit_note_id', 'parent' => 'credit_notes'],
        'refunds' => ['kind' => 'timestamp', 'column' => 'effective_at'],
        'legacy_balance_imports' => ['kind' => 'timestamp', 'column' => 'validated_at'],
        'cash_sessions' => ['kind' => 'timestamp', 'column' => 'opened_at'],
        'cash_movements' => ['kind' => 'timestamp', 'column' => 'occurred_at'],
        'payment_reconciliations' => ['kind' => 'timestamp', 'column' => 'period_starts_at'],
        'payment_reconciliation_lines' => ['kind' => 'parent', 'column' => 'reconciliation_id', 'parent' => 'payment_reconciliations'],
        'document_number_usages' => ['kind' => 'timestamp', 'column' => 'consumed_at'],
        'stock_movements' => ['kind' => 'timestamp', 'column' => 'occurred_at'],
        'stock_reservations' => ['kind' => 'timestamp', 'column' => 'created_at'],
        'stock_alerts' => ['kind' => 'timestamp', 'column' => 'detected_at'],
        'deliveries' => ['kind' => 'timestamp', 'column' => 'delivered_at'],
        'delivery_lines' => ['kind' => 'parent', 'column' => 'delivery_id', 'parent' => 'deliveries'],
        'physical_returns' => ['kind' => 'timestamp', 'column' => 'occurred_at'],
        'goods_receipts' => ['kind' => 'timestamp', 'column' => 'received_at'],
        'goods_receipt_lines' => ['kind' => 'parent', 'column' => 'receipt_id', 'parent' => 'goods_receipts'],
        'inventory_counts' => ['kind' => 'timestamp', 'column' => 'snapshot_at'],
        'inventory_count_lines' => ['kind' => 'parent', 'column' => 'inventory_id', 'parent' => 'inventory_counts'],
        'workshop_orders' => ['kind' => 'timestamp', 'column' => 'ordered_at'],
        'workshop_order_eyes' => ['kind' => 'parent', 'column' => 'workshop_order_id', 'parent' => 'workshop_orders'],
        'workshop_events' => ['kind' => 'timestamp', 'column' => 'occurred_at'],
        'audit_events' => ['kind' => 'timestamp', 'column' => 'recorded_at'],
    ];

    /** Tables du dossier patient : directement par `patient_id`. */
    private const RECORD_BY_PATIENT = ['patient_records', 'visits', 'consultations', 'optical_prescriptions', 'follow_up_plans'];

    /** Tables du dossier patient : par la consultation du patient. */
    private const RECORD_BY_CONSULTATION = [
        'consultation_complaints', 'consultation_histories', 'consultation_ametropias',
        'consultation_referral_reasons', 'visual_acuities', 'refraction_measurements', 'autorefractor_centering',
        'clinical_revisions', 'medication_orders',
    ];

    /** Tables du dossier patient : par la rubrique d'antécédents (`history_id`) d'une consultation du patient. */
    private const RECORD_BY_HISTORY = ['consultation_history_terms'];

    /** Tables du dossier patient : par la prescription du patient. */
    private const RECORD_BY_PRESCRIPTION = ['optical_prescription_eyes', 'optical_prescription_treatments'];

    /** Tables jamais exportées, même pour une remise complète (sessions, jetons, files techniques). */
    private const NEVER = ['idempotency_requests', 'sync_commands', 'sync_command_results', 'webhook_inbox', 'outbox_events'];

    /** Colonnes jamais exportées : secrets, jetons, chemins privés du serveur. */
    private const EXCLUDED_COLUMNS = [
        'users' => ['password_hash', 'mfa_secret_ciphertext', 'remember_token'],
        'stored_files' => ['private_path', 'encryption_key_id'],
        'calendar_sync_states' => ['sync_token_ciphertext', 'token_encryption_key_id', 'pending_page_token'],
        'public_booking_requests' => ['management_token_hash'],
        'backup_runs' => ['private_destination'],
    ];

    public static function permissionFor(string $type): string
    {
        return $type === 'PATIENT_RECORD' ? 'clinical.export' : 'export.global';
    }

    /**
     * Tables exportées pour un type, dans l'ordre de l'archive. Pour la remise complète, toutes les tables du
     * cabinet connues du catalogue sauf les tables techniques jamais exportées.
     *
     * @param  list<string>  $clinicTables  tables qui portent `clinic_id` (catalogue du schéma)
     * @return list<string>
     */
    public static function tables(string $type, array $clinicTables): array
    {
        $list = match ($type) {
            'PATIENT_RECORD' => [...self::RECORD_BY_PATIENT, ...self::RECORD_BY_CONSULTATION, ...self::RECORD_BY_HISTORY, ...self::RECORD_BY_PRESCRIPTION],
            'PATIENTS' => self::PATIENTS,
            'FINANCE' => self::FINANCE,
            'STOCK' => self::STOCK,
            'FULL_HANDOVER' => array_values(array_diff($clinicTables, self::NEVER)),
            default => [],
        };

        return array_values(array_unique(array_values(array_intersect($list, $clinicTables))));
    }

    /**
     * Filtre d'un dossier patient pour une table : la colonne et la source des identifiants.
     *
     * @return array{column: string, source: 'patient'|'consultation'|'history'|'prescription'}|null
     */
    public static function recordFilter(string $table): ?array
    {
        if ($table === 'patient_records') {
            return ['column' => 'id', 'source' => 'patient'];
        }
        if (in_array($table, self::RECORD_BY_PATIENT, true)) {
            return ['column' => 'patient_id', 'source' => 'patient'];
        }
        if (in_array($table, self::RECORD_BY_CONSULTATION, true)) {
            return ['column' => 'consultation_id', 'source' => 'consultation'];
        }
        if (in_array($table, self::RECORD_BY_HISTORY, true)) {
            return ['column' => 'history_id', 'source' => 'history'];
        }
        if (in_array($table, self::RECORD_BY_PRESCRIPTION, true)) {
            return ['column' => 'prescription_id', 'source' => 'prescription'];
        }

        return null;
    }

    /**
     * @param  list<string>  $columns
     * @return list<string>
     */
    public static function exportedColumns(string $table, array $columns): array
    {
        $excluded = self::EXCLUDED_COLUMNS[$table] ?? [];

        return array_values(array_filter($columns, static fn (string $column): bool => ! in_array($column, $excluded, true)));
    }

    /** Les pièces privées (originaux PDF, justificatifs) accompagnent la seule remise complète. */
    public static function includesFiles(string $type): bool
    {
        return $type === 'FULL_HANDOVER';
    }

    public static function isValidRole(string $role): bool
    {
        return in_array($role, self::ROLES, true);
    }

    public static function requiredPermissionFor(string $table): ?string
    {
        return self::TABLE_PERMISSIONS[$table] ?? null;
    }

    /**
     * @return list<string>
     */
    public static function rolePermissions(string $role): array
    {
        if (! self::isValidRole($role)) {
            return [];
        }

        return array_values(array_map(
            'strval',
            DB::table('role_permissions')
                ->where('role_code', $role)
                ->orderBy('permission_code')
                ->pluck('permission_code')
                ->all(),
        ));
    }

    /**
     * @param  list<string>  $tables
     * @param  list<string>  $effectivePermissions
     * @return array{included: list<string>, excluded: list<array{table: string, reason: string}>}
     */
    public static function tablePartition(array $tables, array $effectivePermissions): array
    {
        $included = [];
        $excluded = [];
        foreach ($tables as $table) {
            $perm = self::requiredPermissionFor($table);
            if ($perm !== null && ! in_array($perm, $effectivePermissions, true)) {
                $excluded[] = ['table' => $table, 'reason' => 'PERMISSION_MISSING'];

                continue;
            }
            $included[] = $table;
        }

        return ['included' => $included, 'excluded' => $excluded];
    }

    /**
     * Colonnes visibles pour une table selon les droits de lecture effectifs (masque aussi les coûts sans `stock.valuation.read`).
     *
     * @param  list<string>  $columns
     * @param  list<string>  $effectivePermissions
     * @return list<string>
     */
    public static function exportedColumnsFor(string $table, array $columns, array $effectivePermissions): array
    {
        $visible = self::exportedColumns($table, $columns);
        if (! in_array('stock.valuation.read', $effectivePermissions, true)) {
            $hiddenCost = match ($table) {
                'catalog_items' => ['purchase_cost'],
                'stock_lots' => ['unit_cost'],
                default => [],
            };
            if ($hiddenCost !== []) {
                $visible = array_values(array_filter(
                    $visible,
                    static fn (string $col): bool => ! in_array($col, $hiddenCost, true),
                ));
            }
        }

        return $visible;
    }

    /**
     * @return array{kind: string, column: string, parent?: string}|null
     */
    public static function periodRuleFor(string $table): ?array
    {
        return self::PERIOD_RULES[$table] ?? null;
    }
}
