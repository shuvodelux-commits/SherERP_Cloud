-- M08/M03 0011: complete the existing *narrow clean-Shop* cash sources
-- (POS Cash Sale, Sales Cash Return and Supplier Cash Pay) in one auditable
-- Cash Session expected/count/variance formula. This is not full enterprise
-- Cash/Bank/Expense/Party accounting. Do not apply to hosted D1 without review.
--
-- Requires 0009 close-count authority and 0010 supplier Cash Out receipts.
-- Restore an exact, trigger-validated Close Day only after the missing payout
-- leg is included. These triggers use no browser-calculated Cash Book totals.
DROP TRIGGER owner_mvp_supplier_cash_pending_close;
-- next statement
DROP TRIGGER owner_mvp_cash_close_guard;
-- next statement
CREATE TRIGGER owner_mvp_cash_close_guard
BEFORE UPDATE OF status ON owner_mvp_cash_sessions
WHEN OLD.status='Open' AND NEW.status='Closed'
BEGIN
  SELECT RAISE(ABORT,'MVP_CLOSE_RECONCILIATION_REQUIRED')
  WHERE NEW.expected_paisa IS NULL OR NEW.counted_paisa IS NULL
    OR NEW.variance_paisa IS NULL OR NEW.close_intent_hash IS NULL
    OR NEW.close_actor_id IS NULL OR length(NEW.close_actor_id)<8
    OR NEW.closed_operation_id IS NULL OR length(NEW.closed_operation_id)!=36
    OR NEW.closed_at_ms IS NULL OR NEW.closed_at_ms<OLD.started_at_ms
    OR NEW.opening_paisa != OLD.opening_paisa
    OR NEW.carried_opening_paisa != OLD.carried_opening_paisa;
  SELECT RAISE(ABORT,'MVP_CLOSE_EXPECTED_CASH_CHANGED')
  WHERE NEW.expected_paisa != OLD.opening_paisa + OLD.carried_opening_paisa
    + COALESCE((SELECT SUM(b.received_paisa)
      FROM owner_mvp_sale_cash_book b WHERE b.cash_sequence=OLD.sequence),0)
    - COALESCE((SELECT SUM(r.debit_paisa)
      FROM owner_mvp_return_cash_book r WHERE r.cash_sequence=OLD.sequence),0)
    - COALESCE((SELECT SUM(p.paid_paisa)
      FROM owner_mvp_supplier_payment_cash_book p
      WHERE p.cash_sequence=OLD.sequence),0);
  SELECT RAISE(ABORT,'MVP_CLOSE_COUNT_VARIANCE_CHANGED')
  WHERE NEW.variance_paisa != NEW.counted_paisa - NEW.expected_paisa;
END;
-- next statement
-- Once Suppliers have been paid, a later Sales Return cannot refund more
-- physical cash than the current session holds. The payment writer from 0010
-- already guards the opposite posting order. All three cash legs are checked
-- at SQL time; never use a stale browser dashboard calculation as authority.
CREATE TRIGGER owner_mvp_cash_return_drawer_guard
BEFORE INSERT ON owner_mvp_sale_return_receipts
BEGIN
  SELECT RAISE(ABORT,'MVP_RETURN_INSUFFICIENT_DRAWER')
  WHERE COALESCE((
    SELECT s.opening_paisa + s.carried_opening_paisa
      + COALESCE((SELECT SUM(b.received_paisa)
        FROM owner_mvp_sale_cash_book b WHERE b.cash_sequence=s.sequence),0)
      - COALESCE((SELECT SUM(r.debit_paisa)
        FROM owner_mvp_return_cash_book r WHERE r.cash_sequence=s.sequence),0)
      - COALESCE((SELECT SUM(p.paid_paisa)
        FROM owner_mvp_supplier_payment_cash_book p
        WHERE p.cash_sequence=s.sequence),0)
    FROM owner_mvp_cash_sessions s
    WHERE s.sequence=NEW.cash_sequence AND s.status='Open'
  ),-1) < NEW.total_paisa;
END;
