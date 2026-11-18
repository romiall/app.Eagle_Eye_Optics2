<?php

use App\Support\Schema\BaselineInstaller;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Assouplit `cash_movements` pour les dépenses et leur synchronisation depuis un poste préparé :
 *  - `method` (`CASH`, `MTN_MOMO`, `ORANGE_MONEY`, `BANK_TRANSFER`, `CHEQUE`, `OTHER`, défaut `'CASH'`) ;
 *  - `cash_session_id` nullable (obligatoire quand `method = 'CASH'`, nul hors tiroir espèces) ;
 *  - `reason` et `approval_id` nullables pour `kind = 'EXPENSE'`, obligatoires sinon ;
 *  - `source_device_id` et `sync_command_id` pour tracer les dépenses synchronisées d'un poste ;
 *  - vue `vw_cash_session_totals` explicitement restreinte aux mouvements rattachés à une session (`cash_session_id IS NOT NULL`).
 *
 * Idempotent : sur une base neuve déjà installée par la baseline à jour (où `method` existe), la migration ne fait rien.
 */
return new class extends Migration
{
    public function up(): void
    {
        $connectionName = $this->getConnection();
        if (Schema::connection($connectionName)->hasColumn('cash_movements', 'method')) {
            return;
        }

        $db = DB::connection($connectionName);

        // Sur MySQL 8 les ULID sont en CHAR(26) ; sous MariaDB InnoDB les convertit en VARCHAR(26) sur les tables
        // mixtes : suivre le type réel de la table parente évite tout mismatch FK lors de la migration.
        $idColumn = $db->selectOne(
            "SELECT COLUMN_TYPE AS col_type
             FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'cash_sessions' AND column_name = 'id'"
        );
        $ulidType = strtoupper((string) ($idColumn->col_type ?? 'CHAR(26)'));
        if (! in_array($ulidType, ['CHAR(26)', 'VARCHAR(26)'], true)) {
            $ulidType = 'CHAR(26)';
        }

        // Retirer d'abord les contraintes et index qui changent de numérotation ou de nullabilité.
        $db->unprepared('
            ALTER TABLE `cash_movements`
              DROP FOREIGN KEY `fk_cash_movements_02`,
              DROP FOREIGN KEY `fk_cash_movements_03`,
              DROP FOREIGN KEY `fk_cash_movements_04`,
              DROP FOREIGN KEY `fk_cash_movements_05`,
              DROP CONSTRAINT `ck_cash_movements_05`,
              DROP CONSTRAINT `ck_cash_movements_06`,
              DROP INDEX `ix_cash_movements_01`,
              DROP INDEX `ix_cash_movements_02`,
              DROP INDEX `ix_cash_movements_03`,
              DROP INDEX `ix_cash_movements_04`
        ');

        $db->unprepared("
            ALTER TABLE `cash_movements`
              MODIFY COLUMN `cash_session_id` {$ulidType} CHARACTER SET ascii COLLATE ascii_bin NULL,
              ADD COLUMN `method` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CASH' AFTER `kind`,
              MODIFY COLUMN `reason` TEXT NULL COMMENT 'Motif de l’opération (facultatif pour une dépense, obligatoire sinon)',
              MODIFY COLUMN `approval_id` {$ulidType} CHARACTER SET ascii COLLATE ascii_bin NULL,
              ADD COLUMN `source_device_id` {$ulidType} CHARACTER SET ascii COLLATE ascii_bin NULL AFTER `created_by`,
              ADD COLUMN `sync_command_id` {$ulidType} CHARACTER SET ascii COLLATE ascii_bin NULL AFTER `source_device_id`,
              COMMENT = 'Dépenses et mouvements hors vente (tiroir espèces ou hors tiroir), sans duplication paiements/refunds'
        ");

        $db->unprepared("
            ALTER TABLE `cash_movements`
              ADD KEY `ix_cash_movements_01` (`clinic_id`, `occurred_at`, `kind`),
              ADD KEY `ix_cash_movements_02` (`clinic_id`, `cash_session_id`),
              ADD KEY `ix_cash_movements_03` (`clinic_id`, `approval_id`),
              ADD KEY `ix_cash_movements_04` (`clinic_id`, `expense_category_id`),
              ADD KEY `ix_cash_movements_05` (`clinic_id`, `created_by`),
              ADD KEY `ix_cash_movements_06` (`clinic_id`, `source_device_id`),
              ADD KEY `ix_cash_movements_07` (`clinic_id`, `sync_command_id`),
              ADD CONSTRAINT `ck_cash_movements_05` CHECK (kind = 'EXPENSE' OR method = 'CASH'),
              ADD CONSTRAINT `ck_cash_movements_06` CHECK ((method = 'CASH' AND cash_session_id IS NOT NULL) OR (method <> 'CASH' AND cash_session_id IS NULL)),
              ADD CONSTRAINT `ck_cash_movements_07` CHECK (kind = 'EXPENSE' OR (reason IS NOT NULL AND approval_id IS NOT NULL)),
              ADD CONSTRAINT `ck_cash_movements_08` CHECK (`kind` IN ('DEPOSIT','WITHDRAWAL','EXPENSE','OPENING_CORRECTION')),
              ADD CONSTRAINT `ck_cash_movements_09` CHECK (`method` IN ('CASH','MTN_MOMO','ORANGE_MONEY','BANK_TRANSFER','CHEQUE','OTHER')),
              ADD CONSTRAINT `ck_cash_movements_10` CHECK (id <> '00000000000000000000000000')
        ");

        $db->unprepared('
            ALTER TABLE `cash_movements`
              ADD CONSTRAINT `fk_cash_movements_02` FOREIGN KEY (`clinic_id`, `cash_session_id`) REFERENCES `cash_sessions` (`clinic_id`, `id`),
              ADD CONSTRAINT `fk_cash_movements_03` FOREIGN KEY (`clinic_id`, `approval_id`) REFERENCES `approvals` (`clinic_id`, `id`),
              ADD CONSTRAINT `fk_cash_movements_04` FOREIGN KEY (`clinic_id`, `expense_category_id`) REFERENCES `expense_categories` (`clinic_id`, `id`),
              ADD CONSTRAINT `fk_cash_movements_05` FOREIGN KEY (`clinic_id`, `created_by`) REFERENCES `users` (`clinic_id`, `id`),
              ADD CONSTRAINT `fk_cash_movements_06` FOREIGN KEY (`clinic_id`, `source_device_id`) REFERENCES `enrolled_devices` (`clinic_id`, `id`),
              ADD CONSTRAINT `fk_cash_movements_07` FOREIGN KEY (`clinic_id`, `sync_command_id`) REFERENCES `sync_commands` (`clinic_id`, `id`)
        ');

        $db->unprepared("
            CREATE OR REPLACE SQL SECURITY INVOKER VIEW vw_cash_session_totals AS
            SELECT s.clinic_id,s.id AS cash_session_id,s.cash_register_id,s.cashier_id,s.opened_at,s.closed_at,
                   s.opening_amount,COALESCE(p.received,0) AS cash_received,
                   COALESCE(r.reversed,0) AS accounting_reversals,
                   COALESCE(f.refunded,0) AS cash_refunded,COALESCE(m.moved,0) AS authorized_movements,
                   s.opening_amount+COALESCE(p.received,0)-COALESCE(r.reversed,0)-COALESCE(f.refunded,0)+COALESCE(m.moved,0)
                     AS recomputed_cash_amount,
                   s.expected_amount AS frozen_closing_expected_amount,s.counted_amount,s.variance,
                   COALESCE(pr.after_close,0) AS post_closure_accounting_reversals
            FROM cash_sessions s
            LEFT JOIN (SELECT clinic_id,cash_session_id,SUM(amount) AS received FROM payments
                       WHERE status='CONFIRMED' AND method='CASH' GROUP BY clinic_id,cash_session_id) p
              ON p.clinic_id=s.clinic_id AND p.cash_session_id=s.id
            LEFT JOIN (SELECT r.clinic_id,p.cash_session_id,SUM(r.amount) AS reversed FROM payment_reversals r
                       JOIN payments p ON p.clinic_id=r.clinic_id AND p.id=r.payment_id WHERE p.method='CASH'
                       GROUP BY r.clinic_id,p.cash_session_id) r ON r.clinic_id=s.clinic_id AND r.cash_session_id=s.id
            LEFT JOIN (SELECT clinic_id,cash_session_id,SUM(amount) AS refunded FROM refunds WHERE method='CASH'
                       GROUP BY clinic_id,cash_session_id) f ON f.clinic_id=s.clinic_id AND f.cash_session_id=s.id
            LEFT JOIN (SELECT clinic_id,cash_session_id,SUM(signed_amount) AS moved FROM cash_movements
                       WHERE cash_session_id IS NOT NULL GROUP BY clinic_id,cash_session_id) m ON m.clinic_id=s.clinic_id AND m.cash_session_id=s.id
            LEFT JOIN (SELECT r.clinic_id,p.cash_session_id,SUM(r.amount) AS after_close FROM payment_reversals r
                       JOIN payments p ON p.clinic_id=r.clinic_id AND p.id=r.payment_id
                       JOIN cash_sessions cs ON cs.clinic_id=p.clinic_id AND cs.id=p.cash_session_id
                       WHERE p.method='CASH' AND cs.closed_at IS NOT NULL AND r.recorded_at>cs.closed_at
                       GROUP BY r.clinic_id,p.cash_session_id) pr ON pr.clinic_id=s.clinic_id AND pr.cash_session_id=s.id
        ");
    }

    public function down(): void
    {
        BaselineInstaller::refuseRollback('cash_movements_expenses');
    }
};
