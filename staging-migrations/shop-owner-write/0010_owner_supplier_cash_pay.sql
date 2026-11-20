-- M08 MVP Counter Supplier Pay: exact cash-only payment against an existing
-- clean-Shop credit Purchase balance. Additive Shop D1 migration, not applied
-- remotely here. Requires 0002 Party, 0005 Supplier, 0006 credit Purchase,
-- 0007 Sale, 0008 Return and reviewed 0009 Cash Session Close.
--
-- IMPORTANT: The existing M03 Cash Session close/read views are still limited
-- to Sale/Return cash. Prevent closing a session containing Supplier Pay until
-- the separately reviewed complete Cash Session formula includes all cash
-- movements. Never conceal payouts or invent a zero cash adjustment.
CREATE TABLE owner_mvp_supplier_cash_payment_receipts (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT
    CHECK(sequence BETWEEN 1 AND 9007199254740991),
  operation_id TEXT NOT NULL UNIQUE CHECK(length(operation_id)=36),
  actor_id TEXT NOT NULL,
  intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
  shop_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  database_marker TEXT NOT NULL,
  token_hash TEXT NOT NULL CHECK(length(token_hash)=64),
  supplier_id TEXT NOT NULL REFERENCES owner_supplier_master(supplier_id)
    ON DELETE RESTRICT,
  cash_sequence INTEGER NOT NULL REFERENCES owner_mvp_cash_sessions(sequence)
    ON DELETE RESTRICT,
  paid_paisa INTEGER NOT NULL CHECK(paid_paisa BETWEEN 1 AND 1000000000000),
  note_text TEXT NOT NULL DEFAULT '' CHECK(length(note_text)<=250),
  paid_date TEXT NOT NULL CHECK(length(paid_date)=10),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms>0)
) STRICT;
-- next statement
CREATE INDEX owner_mvp_supplier_cash_payment_supplier_idx
  ON owner_mvp_supplier_cash_payment_receipts(supplier_id,sequence);
-- next statement
CREATE TABLE owner_mvp_supplier_payment_ledger (
  payment_sequence INTEGER PRIMARY KEY
    REFERENCES owner_mvp_supplier_cash_payment_receipts(sequence) ON DELETE RESTRICT,
  supplier_id TEXT NOT NULL REFERENCES owner_supplier_master(supplier_id)
    ON DELETE RESTRICT,
  debit_paisa INTEGER NOT NULL DEFAULT 0 CHECK(debit_paisa=0),
  credit_paisa INTEGER NOT NULL CHECK(credit_paisa BETWEEN 1 AND 1000000000000),
  kind TEXT NOT NULL DEFAULT 'Supplier Payment' CHECK(kind='Supplier Payment')
) STRICT;
-- next statement
CREATE TABLE owner_mvp_supplier_payment_cash_book (
  payment_sequence INTEGER PRIMARY KEY
    REFERENCES owner_mvp_supplier_cash_payment_receipts(sequence) ON DELETE RESTRICT,
  cash_sequence INTEGER NOT NULL REFERENCES owner_mvp_cash_sessions(sequence)
    ON DELETE RESTRICT,
  paid_paisa INTEGER NOT NULL CHECK(paid_paisa BETWEEN 1 AND 1000000000000),
  kind TEXT NOT NULL DEFAULT 'Supplier Payment' CHECK(kind='Supplier Payment')
) STRICT;
-- next statement
CREATE INDEX owner_mvp_supplier_payment_cash_session_idx
  ON owner_mvp_supplier_payment_cash_book(cash_sequence);
-- next statement
CREATE TRIGGER owner_mvp_supplier_cash_validate
BEFORE INSERT ON owner_mvp_supplier_cash_payment_receipts
BEGIN
  SELECT RAISE(ABORT,'MVP_SUPPLIER_CASH_OWNER_REQUIRED')
  WHERE NOT EXISTS(
    SELECT 1 FROM shop_identity i
      JOIN shop_owner_write_grant g ON g.singleton=i.singleton
    WHERE i.singleton=1 AND i.shop_id=NEW.shop_id
      AND i.database_id=NEW.database_id
      AND i.database_marker=NEW.database_marker
      AND g.enabled=1 AND g.token_hash=NEW.token_hash
      AND g.expires_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)
  );
  SELECT RAISE(ABORT,'MVP_SUPPLIER_CASH_SESSION_REQUIRED')
  WHERE NOT EXISTS(SELECT 1 FROM owner_mvp_cash_sessions s
    WHERE s.sequence=NEW.cash_sequence AND s.status='Open');
  SELECT RAISE(ABORT,'MVP_SUPPLIER_CASH_SUPPLIER_INVALID')
  WHERE NOT EXISTS(
    SELECT 1 FROM owner_supplier_master s
      JOIN parties p ON p.party_id=s.party_id AND p.status='ACTIVE'
      JOIN party_roles r ON r.party_id=s.party_id
        AND r.role='Supplier' AND r.status='ACTIVE'
    WHERE s.supplier_id=NEW.supplier_id AND s.status='Active'
      AND s.current_due_paisa>=NEW.paid_paisa
  );
  SELECT RAISE(ABORT,'MVP_SUPPLIER_CASH_NOT_CURRENT_DAY')
  WHERE NEW.paid_date!=date('now','+6 hours');
END;
-- next statement
CREATE TRIGGER owner_mvp_supplier_cash_post
AFTER INSERT ON owner_mvp_supplier_cash_payment_receipts
BEGIN
  UPDATE owner_supplier_master
    SET current_due_paisa=current_due_paisa-NEW.paid_paisa
    WHERE supplier_id=NEW.supplier_id AND current_due_paisa>=NEW.paid_paisa;
  SELECT RAISE(ABORT,'MVP_SUPPLIER_CASH_DUE_CHANGED') WHERE changes()!=1;
  INSERT INTO owner_mvp_supplier_payment_ledger(
    payment_sequence,supplier_id,credit_paisa)
    VALUES(NEW.sequence,NEW.supplier_id,NEW.paid_paisa);
  INSERT INTO owner_mvp_supplier_payment_cash_book(
    payment_sequence,cash_sequence,paid_paisa)
    VALUES(NEW.sequence,NEW.cash_sequence,NEW.paid_paisa);
END;
-- next statement
CREATE TRIGGER owner_mvp_supplier_cash_receipt_no_update
BEFORE UPDATE ON owner_mvp_supplier_cash_payment_receipts
BEGIN SELECT RAISE(ABORT,'MVP_SUPPLIER_CASH_RECEIPT_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_mvp_supplier_cash_receipt_no_delete
BEFORE DELETE ON owner_mvp_supplier_cash_payment_receipts
BEGIN SELECT RAISE(ABORT,'MVP_SUPPLIER_CASH_RECEIPT_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_mvp_supplier_cash_ledger_no_update
BEFORE UPDATE ON owner_mvp_supplier_payment_ledger
BEGIN SELECT RAISE(ABORT,'MVP_SUPPLIER_CASH_LEDGER_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_mvp_supplier_cash_ledger_no_delete
BEFORE DELETE ON owner_mvp_supplier_payment_ledger
BEGIN SELECT RAISE(ABORT,'MVP_SUPPLIER_CASH_LEDGER_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_mvp_supplier_cash_book_no_update
BEFORE UPDATE ON owner_mvp_supplier_payment_cash_book
BEGIN SELECT RAISE(ABORT,'MVP_SUPPLIER_CASH_BOOK_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_mvp_supplier_cash_book_no_delete
BEFORE DELETE ON owner_mvp_supplier_payment_cash_book
BEGIN SELECT RAISE(ABORT,'MVP_SUPPLIER_CASH_BOOK_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_mvp_supplier_cash_pending_close
BEFORE UPDATE OF status ON owner_mvp_cash_sessions
WHEN OLD.status='Open' AND NEW.status='Closed' AND
 EXISTS(SELECT 1 FROM owner_mvp_supplier_payment_cash_book b
   WHERE b.cash_sequence=OLD.sequence)
BEGIN SELECT RAISE(ABORT,'MVP_CLOSE_RECONCILIATION_REQUIRED'); END;
