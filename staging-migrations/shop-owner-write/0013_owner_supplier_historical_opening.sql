-- M08/M02 signed Supplier historical baseline (candidate, NEVER live auto-migrate).
-- Requires the reviewed original 13 receipts, Supplier Cash overlay 0010+0011
-- and first-day physical opening 0012; never rebuild original Supplier master.
-- Stored opening is an immutable role-scoped checkpoint, not a purchase,
-- payment, Cash Session movement, Bank Book entry or cross-role offset.
CREATE TABLE owner_supplier_opening_checkpoints (
  supplier_id TEXT PRIMARY KEY NOT NULL REFERENCES owner_supplier_master(supplier_id)
    ON DELETE RESTRICT,
  operation_id TEXT NOT NULL UNIQUE CHECK(length(operation_id)=36),
  actor_id TEXT NOT NULL CHECK(length(actor_id)>=8),
  signed_opening_paisa INTEGER NOT NULL
    CHECK(signed_opening_paisa BETWEEN -1000000000000 AND 1000000000000),
  as_of_date TEXT NOT NULL CHECK(length(as_of_date)=10),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms>0)
) STRICT;
-- next statement
-- Do not backdate an opening over real Purchase, return, cash settlement
-- or already-materialized Supplier money, and never silently net advances.
CREATE TRIGGER owner_supplier_opening_clean_history
BEFORE INSERT ON owner_supplier_opening_checkpoints
WHEN NOT EXISTS(SELECT 1 FROM owner_supplier_master m
    JOIN parties p ON p.party_id=m.party_id AND p.status='ACTIVE'
    JOIN party_roles r ON r.party_id=p.party_id
      AND r.role='Supplier' AND r.status='ACTIVE'
    WHERE m.supplier_id=NEW.supplier_id AND m.status='Active'
      AND m.current_due_paisa=0)
  OR EXISTS(SELECT 1 FROM owner_mvp_purchase_receipts
    WHERE supplier_id=NEW.supplier_id)
  OR EXISTS(SELECT 1 FROM owner_mvp_supplier_cash_payment_receipts
    WHERE supplier_id=NEW.supplier_id)
BEGIN SELECT RAISE(ABORT,'MVP_SUPPLIER_OPENING_REQUIRES_CLEAN_HISTORY'); END;
-- next statement
-- Only positive historical payable contributes to live Supplier AP.
-- The negative advance remains an independent gross asset position.
CREATE TRIGGER owner_supplier_opening_post
AFTER INSERT ON owner_supplier_opening_checkpoints
BEGIN
  UPDATE owner_supplier_master
    SET current_due_paisa=current_due_paisa+
      CASE WHEN NEW.signed_opening_paisa>0 THEN NEW.signed_opening_paisa ELSE 0 END
    WHERE supplier_id=NEW.supplier_id;
END;
-- next statement
CREATE TRIGGER owner_supplier_opening_no_update
BEFORE UPDATE ON owner_supplier_opening_checkpoints
BEGIN SELECT RAISE(ABORT,'MVP_SUPPLIER_OPENING_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_supplier_opening_no_delete
BEFORE DELETE ON owner_supplier_opening_checkpoints
BEGIN SELECT RAISE(ABORT,'MVP_SUPPLIER_OPENING_IMMUTABLE'); END;
