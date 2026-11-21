-- M03/M08 approved *candidate*: the first-ever physical drawer opening is
-- an opening baseline, NOT current-day Cash In or a historical Party payment.
-- Preserve original 0006 opening_paisa=0 and 0009 carried_opening_paisa; do
-- not rebuild the FK-backed Cash Session financial parent or restate history.
-- Requires existing 0009 Close Day and 0011 Supplier reconciliation.
-- Never apply directly to a live D1 without backup, exact schema pin and review.
DROP TRIGGER owner_mvp_cash_open_carry_guard;
-- next statement
CREATE TRIGGER owner_mvp_cash_open_carry_guard
BEFORE INSERT ON owner_mvp_cash_sessions
WHEN EXISTS (SELECT 1 FROM owner_mvp_cash_sessions)
  AND NEW.carried_opening_paisa != COALESCE((
    SELECT last.counted_paisa FROM owner_mvp_cash_sessions last
    WHERE last.status='Closed' ORDER BY last.sequence DESC LIMIT 1
  ),0)
BEGIN SELECT RAISE(ABORT,'MVP_OPEN_CASH_MISMATCH'); END;
-- next statement
-- Preserve the first-session identity and all subsequent counted closes.
CREATE TRIGGER owner_mvp_cash_session_no_delete
BEFORE DELETE ON owner_mvp_cash_sessions
BEGIN SELECT RAISE(ABORT,'MVP_CASH_SESSION_IMMUTABLE'); END;
