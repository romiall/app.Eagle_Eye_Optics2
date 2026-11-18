-- Reporting projections, complete application. No patient data is seeded here.
-- Views are INVOKER: the API still filters clinic_id and authorizes each reader.
-- Datetimes remain UTC; calculate local day/week/month boundaries in PHP.
-- Each ledger is aggregated independently BEFORE joining: no payment/credit fan-out.
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE SQL SECURITY INVOKER VIEW vw_invoice_balances AS
SELECT i.clinic_id, i.id AS invoice_id, i.patient_id, i.number, i.origin,
       i.issued_at, i.due_date, i.total_gross,
       COALESCE(p.received,0) AS payments_confirmed,
       COALESCE(r.reversed,0) AS payment_reversals,
       COALESCE(c.credited,0) AS credits_issued,
       COALESCE(f.refunded,0) AS refunds_confirmed,
       i.total_gross - COALESCE(c.credited,0) - COALESCE(p.received,0)
         + COALESCE(r.reversed,0) + COALESCE(f.refunded,0) AS signed_balance,
       GREATEST(0, i.total_gross - COALESCE(c.credited,0) - COALESCE(p.received,0)
         + COALESCE(r.reversed,0) + COALESCE(f.refunded,0)) AS amount_due,
       GREATEST(0, -i.total_gross + COALESCE(c.credited,0) + COALESCE(p.received,0)
         - COALESCE(r.reversed,0) - COALESCE(f.refunded,0)) AS refundable_credit
FROM invoices i
LEFT JOIN (SELECT clinic_id,invoice_id,SUM(amount) AS received FROM payments
           WHERE status='CONFIRMED' GROUP BY clinic_id,invoice_id) p
  ON p.clinic_id=i.clinic_id AND p.invoice_id=i.id
LEFT JOIN (SELECT p.clinic_id,p.invoice_id,SUM(r.amount) AS reversed
           FROM payment_reversals r JOIN payments p ON p.clinic_id=r.clinic_id AND p.id=r.payment_id
           GROUP BY p.clinic_id,p.invoice_id) r ON r.clinic_id=i.clinic_id AND r.invoice_id=i.id
LEFT JOIN (SELECT clinic_id,invoice_id,SUM(amount_gross) AS credited FROM credit_notes
           WHERE status='ISSUED' GROUP BY clinic_id,invoice_id) c
  ON c.clinic_id=i.clinic_id AND c.invoice_id=i.id
LEFT JOIN (SELECT clinic_id,invoice_id,SUM(amount) AS refunded FROM refunds GROUP BY clinic_id,invoice_id) f
  ON f.clinic_id=i.clinic_id AND f.invoice_id=i.id
WHERE i.status='ISSUED';

CREATE SQL SECURITY INVOKER VIEW vw_patient_account_balances AS
SELECT clinic_id,patient_id,COUNT(*) AS invoice_count,
       SUM(amount_due) AS amount_due,SUM(refundable_credit) AS refundable_credit
FROM vw_invoice_balances GROUP BY clinic_id,patient_id;

CREATE SQL SECURITY INVOKER VIEW vw_revenue_events AS
SELECT i.clinic_id,i.id AS source_id,'INVOICE' AS event_type,i.id AS invoice_id,
       i.patient_id,i.issued_at AS occurred_at,i.issued_by AS actor_id,i.total_gross AS signed_amount
FROM invoices i WHERE i.status='ISSUED' AND i.origin='NATIVE'
UNION ALL
SELECT c.clinic_id,c.id,'CREDIT_NOTE',c.invoice_id,i.patient_id,c.issued_at,c.issued_by,-c.amount_gross
FROM credit_notes c JOIN invoices i ON i.clinic_id=c.clinic_id AND i.id=c.invoice_id
WHERE c.status='ISSUED' AND i.status='ISSUED' AND i.origin='NATIVE';

CREATE SQL SECURITY INVOKER VIEW vw_collection_events AS
SELECT p.clinic_id,p.id AS source_id,'PAYMENT' AS event_type,p.invoice_id,
       p.effective_at AS occurred_at,p.received_by AS actor_id,p.method,p.amount AS signed_amount,
       p.cash_session_id AS related_cash_session_id
FROM payments p WHERE p.status='CONFIRMED'
UNION ALL
SELECT r.clinic_id,r.id,'PAYMENT_REVERSAL',p.invoice_id,r.recorded_at,r.created_by,p.method,-r.amount,p.cash_session_id
FROM payment_reversals r JOIN payments p ON p.clinic_id=r.clinic_id AND p.id=r.payment_id
UNION ALL
SELECT f.clinic_id,f.id,'REFUND',f.invoice_id,f.effective_at,f.created_by,f.method,-f.amount,f.cash_session_id
FROM refunds f;

CREATE SQL SECURITY INVOKER VIEW vw_cash_session_totals AS
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
           GROUP BY r.clinic_id,p.cash_session_id) pr ON pr.clinic_id=s.clinic_id AND pr.cash_session_id=s.id;

CREATE SQL SECURITY INVOKER VIEW vw_stock_position_balances AS
SELECT p.clinic_id,p.id AS stock_position_id,p.item_id,p.location_id,
       COALESCE(m.physical,0) AS ledger_on_hand,
       COALESCE(r.reserved,0) AS central_reserved,
       COALESCE(a.allocated,0) AS offline_allocated,
       COALESCE(m.physical,0)-COALESCE(r.reserved,0)-COALESCE(a.allocated,0) AS central_available,
       p.on_hand AS cached_on_hand,p.reserved AS cached_reserved,p.offline_allocated AS cached_offline_allocated
FROM stock_positions p
LEFT JOIN (SELECT clinic_id,position_id,SUM(signed_quantity) AS physical FROM stock_movements
           GROUP BY clinic_id,position_id) m ON m.clinic_id=p.clinic_id AND m.position_id=p.id
LEFT JOIN (SELECT clinic_id,stock_position_id,SUM(quantity-consumed_quantity-released_quantity) AS reserved
           FROM stock_reservations WHERE device_allocation_id IS NULL AND status='ACTIVE'
           GROUP BY clinic_id,stock_position_id) r ON r.clinic_id=p.clinic_id AND r.stock_position_id=p.id
LEFT JOIN (SELECT clinic_id,stock_position_id,SUM(allocated_quantity-consumed_quantity-returned_quantity) AS allocated
           FROM device_stock_allocations WHERE status IN ('ACTIVE','CLOSING')
           GROUP BY clinic_id,stock_position_id) a ON a.clinic_id=p.clinic_id AND a.stock_position_id=p.id;

CREATE SQL SECURITY INVOKER VIEW vw_stock_lot_balances AS
SELECT l.clinic_id,l.id AS stock_lot_id,l.stock_position_id,l.item_id,l.expires_on,l.status,
       COALESCE(m.physical,0) AS ledger_on_hand,COALESCE(r.reserved,0) AS central_reserved,
       COALESCE(a.allocated,0) AS offline_allocated,
       COALESCE(m.physical,0)-COALESCE(r.reserved,0)-COALESCE(a.allocated,0) AS central_available,
       l.on_hand AS cached_on_hand,l.reserved AS cached_reserved,l.offline_allocated AS cached_offline_allocated
FROM stock_lots l
LEFT JOIN (SELECT clinic_id,lot_id,SUM(signed_quantity) AS physical FROM stock_movements
           GROUP BY clinic_id,lot_id) m ON m.clinic_id=l.clinic_id AND m.lot_id=l.id
LEFT JOIN (SELECT clinic_id,stock_lot_id,SUM(quantity-consumed_quantity-released_quantity) AS reserved
           FROM stock_reservations WHERE device_allocation_id IS NULL AND status='ACTIVE'
           GROUP BY clinic_id,stock_lot_id) r ON r.clinic_id=l.clinic_id AND r.stock_lot_id=l.id
LEFT JOIN (SELECT clinic_id,stock_lot_id,SUM(allocated_quantity-consumed_quantity-returned_quantity) AS allocated
           FROM device_stock_allocations WHERE status IN ('ACTIVE','CLOSING')
           GROUP BY clinic_id,stock_lot_id) a ON a.clinic_id=l.clinic_id AND a.stock_lot_id=l.id;

CREATE SQL SECURITY INVOKER VIEW vw_active_invoice_write_owners AS
SELECT clinic_id,invoice_id,device_id,epoch,status,granted_at
FROM invoice_write_owners WHERE status IN ('ACTIVE','CLOSING');

CREATE SQL SECURITY INVOKER VIEW vw_current_communication_consents AS
SELECT id,clinic_id,patient_id,prospect_contact_id,subject_key,channel,purpose,destination_hash,
       status,recorded_at,event_sequence,policy_version
FROM (SELECT c.*,ROW_NUMBER() OVER (
      PARTITION BY clinic_id,subject_key,channel,purpose,destination_hash
      ORDER BY event_sequence DESC) AS position_in_stream FROM communication_consents c) ranked
WHERE position_in_stream=1;

CREATE SQL SECURITY INVOKER VIEW vw_device_sync_health AS
SELECT d.clinic_id,d.id AS device_id,d.name,d.status,d.last_sync_at,d.last_accepted_sequence,
       COALESCE(c.pending_count,0) AS received_commands_pending,
       COALESCE(c.conflict_count,0) AS received_commands_in_conflict
FROM enrolled_devices d
LEFT JOIN (SELECT sc.clinic_id,sc.device_id,
       SUM(CASE WHEN cr.status IN ('RECEIVED','WAITING_DEPENDENCY') OR cr.id IS NULL THEN 1 ELSE 0 END) AS pending_count,
       SUM(CASE WHEN cr.status='CONFLICT_REQUIRES_REVIEW' THEN 1 ELSE 0 END) AS conflict_count
     FROM sync_commands sc LEFT JOIN sync_command_results cr ON cr.clinic_id=sc.clinic_id AND cr.command_id=sc.id
     GROUP BY sc.clinic_id,sc.device_id) c ON c.clinic_id=d.clinic_id AND c.device_id=d.id;
-- Server cannot count commands it has never received. UI also displays last_sync_at and known completeness.
