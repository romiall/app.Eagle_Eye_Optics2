-- Read-only diagnostics after the complete import and after committed business transactions.
-- Each result set below should contain ZERO rows on a consistent database.
-- Run as authorized administrator; no patient names or clinical text are selected.

-- I01: invoice total and number of lines at emission. Native invoices only: a certified paper receivable import
-- (origin LEGACY_BALANCE) has no article line by design and is checked by I08.
SELECT 'I01_INVOICE_TOTAL' AS issue,i.clinic_id,i.id
FROM invoices i LEFT JOIN invoice_lines l ON l.clinic_id=i.clinic_id AND l.invoice_id=i.id
WHERE i.status='ISSUED' AND i.origin='NATIVE' GROUP BY i.clinic_id,i.id,i.total_gross
HAVING COUNT(l.id)=0 OR COALESCE(SUM(l.line_total_gross),0)<>i.total_gross;

-- I02: every confirmed payment has exactly one receipt.
SELECT 'I02_RECEIPT_MISSING' AS issue,p.clinic_id,p.id
FROM payments p LEFT JOIN receipts r ON r.clinic_id=p.clinic_id AND r.payment_id=p.id
WHERE p.status='CONFIRMED' AND r.id IS NULL;
SELECT 'I03_RECEIPT_WRONG_STATE' AS issue,r.clinic_id,r.id
FROM receipts r JOIN payments p ON p.clinic_id=r.clinic_id AND p.id=r.payment_id
WHERE p.status<>'CONFIRMED';

-- I04: cumulative reversals cannot exceed the original confirmed payment.
SELECT 'I04_REVERSAL_LIMIT' AS issue,p.clinic_id,p.id
FROM payments p JOIN payment_reversals r ON r.clinic_id=p.clinic_id AND r.payment_id=p.id
GROUP BY p.clinic_id,p.id,p.amount,p.status
HAVING SUM(r.amount)>p.amount OR p.status<>'CONFIRMED';

-- I05: credit-note total equals the credited lines.
SELECT 'I05_CREDIT_TOTAL' AS issue,c.clinic_id,c.id
FROM credit_notes c LEFT JOIN credit_note_lines l ON l.clinic_id=c.clinic_id AND l.credit_note_id=c.id
WHERE c.status='ISSUED' GROUP BY c.clinic_id,c.id,c.amount_gross
HAVING COUNT(l.id)=0 OR COALESCE(SUM(l.amount_gross),0)<>c.amount_gross;
SELECT 'I06_CREDIT_LINE_LIMIT' AS issue,l.clinic_id,l.id
FROM invoice_lines l JOIN credit_note_lines cl ON cl.clinic_id=l.clinic_id AND cl.invoice_line_id=l.id
JOIN credit_notes c ON c.clinic_id=cl.clinic_id AND c.id=cl.credit_note_id AND c.status='ISSUED'
GROUP BY l.clinic_id,l.id,l.line_total_gross HAVING SUM(cl.amount_gross)>l.line_total_gross;
SELECT 'I07_REFUND_LIMIT' AS issue,b.clinic_id,b.invoice_id
FROM vw_invoice_balances b WHERE b.refunds_confirmed>b.credits_issued;
SELECT 'I07_REFUND_NOTE_LIMIT' AS issue,c.clinic_id,c.id
FROM credit_notes c JOIN refunds r ON r.clinic_id=c.clinic_id AND r.credit_note_id=c.id
GROUP BY c.clinic_id,c.id,c.amount_gross HAVING SUM(r.amount)>c.amount_gross;
-- Also enforce the refundable amount immediately BEFORE each refund under invoice lock.

-- I08: certified paper import has the same patient and residual value, never new turnover.
SELECT 'I08_LEGACY_BALANCE' AS issue,i.clinic_id,i.id
FROM invoices i LEFT JOIN legacy_balance_imports l ON l.clinic_id=i.clinic_id AND l.invoice_id=i.id
WHERE i.status='ISSUED' AND i.origin='LEGACY_BALANCE'
  AND (l.id IS NULL OR l.opening_balance<>i.total_gross OR l.paper_reference<>i.legacy_reference);

-- I09: cached stock equals independently recomputed ledger/quota values.
SELECT 'I09_STOCK_POSITION' AS issue,clinic_id,stock_position_id
FROM vw_stock_position_balances
WHERE ledger_on_hand<>cached_on_hand OR central_reserved<>cached_reserved
   OR offline_allocated<>cached_offline_allocated OR central_available<0;
SELECT 'I10_STOCK_LOT' AS issue,clinic_id,stock_lot_id
FROM vw_stock_lot_balances
WHERE ledger_on_hand<>cached_on_hand OR central_reserved<>cached_reserved
   OR offline_allocated<>cached_offline_allocated OR central_available<0;

-- I11: physical movement source has consistent location/batch where a source is nullable.
SELECT 'I11_RECEIPT_MOVEMENT_SOURCE' AS issue,m.clinic_id,m.id
FROM stock_movements m JOIN goods_receipt_lines g ON g.clinic_id=m.clinic_id AND g.id=m.goods_receipt_line_id
JOIN stock_positions p ON p.clinic_id=m.clinic_id AND p.id=m.position_id
WHERE g.location_id<>p.location_id OR NOT (g.stock_lot_id <=> m.lot_id);
SELECT 'I12_RETURN_MOVEMENT_BATCH' AS issue,m.clinic_id,m.id
FROM stock_movements m JOIN physical_returns r ON r.clinic_id=m.clinic_id AND r.id=m.physical_return_id
JOIN delivery_lines d ON d.clinic_id=r.clinic_id AND d.id=r.delivery_line_id
WHERE NOT (m.lot_id <=> d.stock_lot_id) OR r.accepted_for_restock=0;

-- I13: cumulative physically delivered quantity cannot exceed the sale line.
SELECT 'I13_DELIVERY_QUANTITY' AS issue,l.clinic_id,l.id
FROM invoice_lines l JOIN delivery_lines dl ON dl.clinic_id=l.clinic_id AND dl.invoice_line_id=l.id
JOIN deliveries d ON d.clinic_id=dl.clinic_id AND d.id=dl.delivery_id AND d.status='CONFIRMED'
GROUP BY l.clinic_id,l.id,l.quantity HAVING SUM(dl.quantity)>l.quantity;
SELECT 'I14_RETURN_QUANTITY' AS issue,d.clinic_id,d.id
FROM delivery_lines d JOIN physical_returns r ON r.clinic_id=d.clinic_id AND r.delivery_line_id=d.id
GROUP BY d.clinic_id,d.id,d.quantity HAVING SUM(r.quantity)>d.quantity;

-- I15: number allocation ranges must not overlap (CHECK cannot compare other rows).
SELECT 'I15_NUMBER_RANGE_OVERLAP' AS issue,a.clinic_id,a.id,b.id AS other_allocation_id
FROM document_number_allocations a JOIN document_number_allocations b
 ON b.clinic_id=a.clinic_id AND b.document_type=a.document_type AND b.document_year=a.document_year
 AND b.id>a.id AND a.range_start<=b.range_end AND b.range_start<=a.range_end;
SELECT 'I16_NUMBER_OUTSIDE_ALLOCATION' AS issue,u.clinic_id,u.id
FROM document_number_usages u JOIN document_number_allocations a ON a.clinic_id=u.clinic_id AND a.id=u.allocation_id
WHERE u.document_type<>a.document_type OR u.document_year<>a.document_year
   OR u.number_value<a.range_start OR u.number_value>a.range_end
   OR NOT (u.source_device_id <=> a.device_id);

-- I17: none-known clinical history is exclusive of positive terms.
SELECT 'I17_HISTORY_NONE_CONFLICT' AS issue,h.clinic_id,h.id
FROM consultation_histories h JOIN consultation_history_terms t ON t.clinic_id=h.clinic_id AND t.history_id=h.id
WHERE h.known_none=1;

-- I18: linked appointments/visits keep the intended patient and exact booking request.
SELECT 'I18_VISIT_APPOINTMENT_PATIENT' AS issue,v.clinic_id,v.id
FROM visits v JOIN appointments a ON a.clinic_id=v.clinic_id AND a.id=v.appointment_id
WHERE NOT (a.patient_id <=> v.patient_id);
SELECT 'I19_BOOKING_CONFIRMATION' AS issue,b.clinic_id,b.id
FROM public_booking_requests b JOIN appointments a ON a.clinic_id=b.clinic_id AND a.id=b.appointment_id
WHERE b.status='CONFIRMED' AND (NOT (a.prospect_contact_id <=> b.prospect_contact_id)
 OR a.service_id<>b.service_id OR a.resource_id<>b.resource_id
 OR a.starts_at<>b.requested_starts_at OR a.ends_at<>b.requested_ends_at);

-- I20: task recipient matches its source; contact phone/purpose is rechecked by app before sending.
SELECT 'I20_TASK_FOLLOWUP_PATIENT' AS issue,t.clinic_id,t.id
FROM contact_tasks t JOIN follow_up_plans f ON f.clinic_id=t.clinic_id AND f.id=t.follow_up_id
WHERE NOT (t.patient_id <=> f.patient_id);
SELECT 'I21_TASK_INVOICE_PATIENT' AS issue,t.clinic_id,t.id
FROM contact_tasks t JOIN invoices i ON i.clinic_id=t.clinic_id AND i.id=t.invoice_id
WHERE NOT (t.patient_id <=> i.patient_id);
SELECT 'I22_TASK_APPOINTMENT_RECIPIENT' AS issue,t.clinic_id,t.id
FROM contact_tasks t JOIN appointments a ON a.clinic_id=t.clinic_id AND a.id=t.appointment_id
WHERE NOT (t.patient_id <=> a.patient_id) OR NOT (t.prospect_contact_id <=> a.prospect_contact_id);
SELECT 'I23_TASK_WORKSHOP_PATIENT' AS issue,t.clinic_id,t.id
FROM contact_tasks t JOIN workshop_orders w ON w.clinic_id=t.clinic_id AND w.id=t.workshop_order_id
WHERE NOT (t.patient_id <=> w.patient_id);

-- I24: a READY document references a typed source consistent with its kind.
SELECT 'I24_DOCUMENT_SOURCE_TYPE' AS issue,d.clinic_id,d.id FROM generated_documents d
WHERE NOT (
 (d.document_type IN ('INVOICE','LEGACY_BALANCE') AND d.invoice_id IS NOT NULL)
 OR (d.document_type='RECEIPT' AND d.receipt_id IS NOT NULL)
 OR (d.document_type='CREDIT_NOTE' AND d.credit_note_id IS NOT NULL)
 OR (d.document_type='REFUND' AND d.refund_id IS NOT NULL)
 OR (d.document_type='OPTICAL_PRESCRIPTION' AND d.prescription_id IS NOT NULL)
 OR (d.document_type='CLINICAL_RECORD' AND (d.clinical_revision_id IS NOT NULL OR d.patient_id IS NOT NULL))
 OR (d.document_type='WORKSHOP' AND d.workshop_order_id IS NOT NULL)
 OR (d.document_type='ACCOUNT_STATEMENT' AND d.patient_id IS NOT NULL)
 OR (d.document_type='QUOTE' AND d.quote_id IS NOT NULL));

-- These diagnostics detect inconsistencies; they do not replace transactional admission checks,
-- cryptographic verification, access policies, payload-hash approvals or local-device recovery.
