-- M03/M07 MVP operational Cash Sales Return for the immutable 0007 Sale.
-- One Standard SKU, original owned FIFO lot, whole units and original
-- unit price. Exact Cash refund, append-only, same Shop DB, no remote apply.
-- The parent INSERT enforces actor/Shop/lease; these triggers enforce the
-- current Cash Session, original Sale allocation and cumulative ceilings.
CREATE TABLE owner_mvp_sale_return_receipts (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT CHECK(sequence BETWEEN 1 AND 9007199254740991),
  operation_id TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
  sale_sequence INTEGER NOT NULL REFERENCES owner_mvp_sale_receipts(sequence) ON DELETE RESTRICT,
  cash_sequence INTEGER NOT NULL REFERENCES owner_mvp_cash_sessions(sequence) ON DELETE RESTRICT,
  lot_sequence INTEGER NOT NULL REFERENCES owner_mvp_stock_lots(sequence) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
  quantity_micro INTEGER NOT NULL CHECK(quantity_micro BETWEEN 1000000 AND 1000000000 AND quantity_micro%1000000=0),
  unit_refund_paisa INTEGER NOT NULL CHECK(unit_refund_paisa BETWEEN 1 AND 1000000000),
  total_paisa INTEGER NOT NULL CHECK(total_paisa BETWEEN 1 AND 1000000000000),
  return_date TEXT NOT NULL CHECK(length(return_date)=10),
  reason_text TEXT NOT NULL,
  notes_text TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms>0),
  CHECK(total_paisa=(quantity_micro/1000000)*unit_refund_paisa)
) STRICT;
-- next statement
CREATE INDEX owner_mvp_return_sale_lookup
  ON owner_mvp_sale_return_receipts(sale_sequence,sequence);
-- next statement
CREATE TABLE owner_mvp_return_stock_movements (
  return_sequence INTEGER PRIMARY KEY REFERENCES owner_mvp_sale_return_receipts(sequence) ON DELETE RESTRICT,
  lot_sequence INTEGER NOT NULL REFERENCES owner_mvp_stock_lots(sequence) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
  quantity_micro INTEGER NOT NULL CHECK(quantity_micro>=1000000 AND quantity_micro%1000000=0),
  kind TEXT NOT NULL DEFAULT 'Sales Return' CHECK(kind='Sales Return')
) STRICT;
-- next statement
CREATE TABLE owner_mvp_return_cash_book (
  return_sequence INTEGER PRIMARY KEY REFERENCES owner_mvp_sale_return_receipts(sequence) ON DELETE RESTRICT,
  cash_sequence INTEGER NOT NULL REFERENCES owner_mvp_cash_sessions(sequence) ON DELETE RESTRICT,
  debit_paisa INTEGER NOT NULL CHECK(debit_paisa BETWEEN 1 AND 1000000000000),
  kind TEXT NOT NULL DEFAULT 'Sales Return' CHECK(kind='Sales Return')
) STRICT;
-- next statement
CREATE INDEX owner_mvp_return_cash_session_lookup
  ON owner_mvp_return_cash_book(cash_sequence);
-- next statement
CREATE TRIGGER owner_mvp_return_validate BEFORE INSERT ON owner_mvp_sale_return_receipts
BEGIN
  SELECT RAISE(ABORT,'MVP_RETURN_CASH_SESSION_REQUIRED')
  WHERE NOT EXISTS(SELECT 1 FROM owner_mvp_cash_sessions s
    WHERE s.sequence=NEW.cash_sequence AND s.status='Open');
  SELECT RAISE(ABORT,'MVP_RETURN_ORIGINAL_LINEAGE')
  WHERE NOT EXISTS(
    SELECT 1 FROM owner_mvp_sale_receipts sale
    JOIN owner_mvp_sale_fifo_draws draw ON draw.sale_sequence=sale.sequence
    JOIN owner_mvp_sale_cash_book cash ON cash.sale_sequence=sale.sequence
    JOIN owner_mvp_stock_lots lot ON lot.sequence=draw.lot_sequence
    JOIN owner_mvp_product_stock stock ON stock.product_id=lot.product_id
    WHERE sale.sequence=NEW.sale_sequence
      AND sale.lot_sequence=NEW.lot_sequence
      AND draw.lot_sequence=NEW.lot_sequence
      AND sale.product_id=NEW.product_id
      AND lot.product_id=NEW.product_id
      AND sale.quantity_micro>=NEW.quantity_micro
      AND sale.unit_price_paisa=NEW.unit_refund_paisa
      AND draw.unit_sell_paisa=NEW.unit_refund_paisa
      AND cash.received_paisa=sale.subtotal_paisa
      AND lot.qty_micro+NEW.quantity_micro<=lot.received_micro
      AND stock.quantity_micro+NEW.quantity_micro<=9007199254740991
      AND NEW.return_date>=date(sale.created_at_ms/1000,'unixepoch','+6 hours')
      AND NEW.return_date<=date('now','+6 hours')
  );
  SELECT RAISE(ABORT,'MVP_RETURN_QUANTITY_EXCEEDED')
  WHERE (SELECT COALESCE(SUM(r.quantity_micro),0)
    FROM owner_mvp_sale_return_receipts r
    WHERE r.sale_sequence=NEW.sale_sequence)+NEW.quantity_micro>
    (SELECT sale.quantity_micro FROM owner_mvp_sale_receipts sale
      WHERE sale.sequence=NEW.sale_sequence);
  SELECT RAISE(ABORT,'MVP_RETURN_CASH_REFUND_EXCEEDED')
  WHERE (SELECT COALESCE(SUM(r.total_paisa),0)
    FROM owner_mvp_sale_return_receipts r
    WHERE r.sale_sequence=NEW.sale_sequence)+NEW.total_paisa>
    (SELECT paid.received_paisa FROM owner_mvp_sale_cash_book paid
      WHERE paid.sale_sequence=NEW.sale_sequence);
END;
-- next statement
CREATE TRIGGER owner_mvp_return_post AFTER INSERT ON owner_mvp_sale_return_receipts
BEGIN
  UPDATE owner_mvp_stock_lots SET qty_micro=qty_micro+NEW.quantity_micro
    WHERE sequence=NEW.lot_sequence
      AND product_id=NEW.product_id
      AND qty_micro+NEW.quantity_micro<=received_micro;
  SELECT RAISE(ABORT,'MVP_RETURN_LOT_CHANGED') WHERE changes()!=1;
  UPDATE owner_mvp_product_stock SET quantity_micro=quantity_micro+NEW.quantity_micro
    WHERE product_id=NEW.product_id AND quantity_micro+NEW.quantity_micro<=9007199254740991;
  SELECT RAISE(ABORT,'MVP_RETURN_STOCK_CHANGED') WHERE changes()!=1;
  INSERT INTO owner_mvp_return_stock_movements
    (return_sequence,lot_sequence,product_id,quantity_micro)
    VALUES(NEW.sequence,NEW.lot_sequence,NEW.product_id,NEW.quantity_micro);
  INSERT INTO owner_mvp_return_cash_book
    (return_sequence,cash_sequence,debit_paisa)
    VALUES(NEW.sequence,NEW.cash_sequence,NEW.total_paisa);
END;
-- next statement
CREATE TRIGGER owner_mvp_return_receipt_update_gate BEFORE UPDATE ON owner_mvp_sale_return_receipts
BEGIN SELECT RAISE(ABORT,'MVP_RETURN_RECEIPT_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_mvp_return_receipt_delete_gate BEFORE DELETE ON owner_mvp_sale_return_receipts
BEGIN SELECT RAISE(ABORT,'MVP_RETURN_RECEIPT_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_mvp_return_move_update_gate BEFORE UPDATE ON owner_mvp_return_stock_movements
BEGIN SELECT RAISE(ABORT,'MVP_RETURN_STOCK_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_mvp_return_move_delete_gate BEFORE DELETE ON owner_mvp_return_stock_movements
BEGIN SELECT RAISE(ABORT,'MVP_RETURN_STOCK_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_mvp_return_cash_update_gate BEFORE UPDATE ON owner_mvp_return_cash_book
BEGIN SELECT RAISE(ABORT,'MVP_RETURN_CASH_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_mvp_return_cash_delete_gate BEFORE DELETE ON owner_mvp_return_cash_book
BEGIN SELECT RAISE(ABORT,'MVP_RETURN_CASH_IMMUTABLE'); END;
