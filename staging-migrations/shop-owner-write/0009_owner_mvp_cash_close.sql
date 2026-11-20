-- M03/M08 clean-Shop Cash Session Close Day. Sequential follow-up to 0008.
-- All expected/counted/variance amounts are exact integer paisa. Source:
-- CashSession.gs records variance as an audit fact, NOT a fictitious Cash Book adjustment.
-- Owner/Shop/lease authorization stays in the SQL UPDATE writer (same row).
-- Only reviewed Shop D1 migration: never run automatically against remote D1.
ALTER TABLE owner_mvp_cash_sessions
  ADD COLUMN expected_paisa INTEGER CHECK(expected_paisa BETWEEN 0 AND 1000000000000);
-- next statement
ALTER TABLE owner_mvp_cash_sessions
  ADD COLUMN counted_paisa INTEGER CHECK(counted_paisa BETWEEN 0 AND 1000000000000);
-- next statement
ALTER TABLE owner_mvp_cash_sessions
  ADD COLUMN variance_paisa INTEGER CHECK(variance_paisa BETWEEN -1000000000000 AND 1000000000000);
-- next statement
ALTER TABLE owner_mvp_cash_sessions
  ADD COLUMN close_intent_hash TEXT CHECK(close_intent_hash IS NULL OR length(close_intent_hash)=64);
-- next statement
ALTER TABLE owner_mvp_cash_sessions
  ADD COLUMN close_actor_id TEXT;
-- next statement
ALTER TABLE owner_mvp_cash_sessions
  ADD COLUMN close_notes TEXT NOT NULL DEFAULT '' CHECK(length(close_notes)<=250);
-- next statement
-- The 0007 pilot denial is superseded ONLY by this guarded cash-count close.
DROP TRIGGER owner_mvp_sale_cash_close_gate;
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
    OR NEW.opening_paisa != OLD.opening_paisa;
  SELECT RAISE(ABORT,'MVP_CLOSE_EXPECTED_CASH_CHANGED')
  WHERE NEW.expected_paisa != OLD.opening_paisa
    + COALESCE((SELECT SUM(b.received_paisa)
      FROM owner_mvp_sale_cash_book b WHERE b.cash_sequence=OLD.sequence),0)
    - COALESCE((SELECT SUM(r.debit_paisa)
      FROM owner_mvp_return_cash_book r WHERE r.cash_sequence=OLD.sequence),0);
  SELECT RAISE(ABORT,'MVP_CLOSE_COUNT_VARIANCE_CHANGED')
  WHERE NEW.variance_paisa != NEW.counted_paisa - NEW.expected_paisa;
END;
-- next statement
-- A previously closed session cannot have its audited financial totals edited.
CREATE TRIGGER owner_mvp_cash_close_immutable
BEFORE UPDATE ON owner_mvp_cash_sessions
WHEN OLD.status='Closed'
BEGIN SELECT RAISE(ABORT,'MVP_CLOSE_IMMUTABLE'); END;
-- next statement
-- No silent drawer reset: the next session's opening must equal the last
-- physical count. Different physical opening needs a future explicit,
-- separately authorized cash reconciliation/withdrawal flow.
CREATE TRIGGER owner_mvp_cash_open_carry_guard
BEFORE INSERT ON owner_mvp_cash_sessions
WHEN NEW.opening_paisa != COALESCE((
  SELECT last.counted_paisa FROM owner_mvp_cash_sessions last
  WHERE last.status='Closed' ORDER BY last.sequence DESC LIMIT 1
),0)
BEGIN SELECT RAISE(ABORT,'MVP_OPEN_CASH_MISMATCH'); END;
-- next statement
CREATE TRIGGER owner_mvp_cash_opening_immutable
BEFORE UPDATE OF opening_paisa ON owner_mvp_cash_sessions
WHEN NEW.opening_paisa != OLD.opening_paisa
BEGIN SELECT RAISE(ABORT,'MVP_CASH_OPENING_IMMUTABLE'); END;
