-- M03 MVP: One authenticated, cash-paid, whole-unit Standard SKU sale from
-- first eligible FIFO purchase lot. Private Shop D1 only; no hosted apply.
-- Depends on 0005 Supplier + 0006 operational credit Purchase / Cash Session.
-- SQL guards MUST run at the same time as posting: JS preflight is not authority.
CREATE TABLE owner_mvp_sale_receipts (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
  cash_sequence INTEGER NOT NULL REFERENCES owner_mvp_cash_sessions(sequence) ON DELETE RESTRICT,
  lot_sequence INTEGER NOT NULL REFERENCES owner_mvp_stock_lots(sequence) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  unit_name TEXT NOT NULL,
  quantity_micro INTEGER NOT NULL CHECK(quantity_micro BETWEEN 1000000 AND 1000000000 AND quantity_micro%1000000=0),
  unit_price_paisa INTEGER NOT NULL CHECK(unit_price_paisa BETWEEN 1 AND 1000000000),
  subtotal_paisa INTEGER NOT NULL CHECK(subtotal_paisa BETWEEN 1 AND 1000000000000),
  customer_name TEXT NOT NULL CHECK(length(customer_name) BETWEEN 1 AND 180),
  customer_phone TEXT NOT NULL CHECK(length(customer_phone) BETWEEN 1 AND 60),
  customer_father_name TEXT NOT NULL DEFAULT '',
  customer_relation_type TEXT NOT NULL DEFAULT '',
  customer_address TEXT NOT NULL DEFAULT '',
  shop_name TEXT NOT NULL CHECK(length(shop_name) BETWEEN 1 AND 180),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms>0),
  CHECK(subtotal_paisa=(quantity_micro/1000000)*unit_price_paisa)
) STRICT;
-- next statement
CREATE TABLE owner_mvp_sale_fifo_draws (
  sale_sequence INTEGER PRIMARY KEY REFERENCES owner_mvp_sale_receipts(sequence) ON DELETE RESTRICT,
  lot_sequence INTEGER NOT NULL REFERENCES owner_mvp_stock_lots(sequence) ON DELETE RESTRICT,
  quantity_micro INTEGER NOT NULL CHECK(quantity_micro>=1000000 AND quantity_micro%1000000=0),
  unit_cost_paisa INTEGER NOT NULL CHECK(unit_cost_paisa>=0),
  unit_sell_paisa INTEGER NOT NULL CHECK(unit_sell_paisa>0)
) STRICT;
-- next statement
CREATE TABLE owner_mvp_sale_cash_book (
  sale_sequence INTEGER PRIMARY KEY REFERENCES owner_mvp_sale_receipts(sequence) ON DELETE RESTRICT,
  cash_sequence INTEGER NOT NULL REFERENCES owner_mvp_cash_sessions(sequence) ON DELETE RESTRICT,
  received_paisa INTEGER NOT NULL CHECK(received_paisa BETWEEN 1 AND 1000000000000),
  kind TEXT NOT NULL DEFAULT 'Sale' CHECK(kind='Sale')
) STRICT;
-- next statement
CREATE INDEX owner_mvp_sale_cash_session_lookup
ON owner_mvp_sale_cash_book(cash_sequence);
-- next statement
CREATE TRIGGER owner_mvp_sale_validate BEFORE INSERT ON owner_mvp_sale_receipts
BEGIN
  SELECT RAISE(ABORT,'MVP_SALE_CASH_SESSION_REQUIRED')
  WHERE NOT EXISTS(SELECT 1 FROM owner_mvp_cash_sessions s
    WHERE s.sequence=NEW.cash_sequence AND s.status='Open');
  SELECT RAISE(ABORT,'MVP_SALE_STALE_STOCK_OR_PRICE')
  WHERE NOT EXISTS(
    SELECT 1 FROM owner_mvp_stock_lots l
    JOIN owner_mvp_purchase_lines pl
      ON pl.purchase_sequence=l.purchase_sequence AND pl.line_number=l.line_number
    JOIN products p ON p.product_id=l.product_id
    JOIN owner_mvp_product_stock s ON s.product_id=l.product_id
    WHERE l.sequence=NEW.lot_sequence
      AND l.product_id=NEW.product_id
      AND l.qty_micro>=NEW.quantity_micro AND s.quantity_micro>=NEW.quantity_micro
      AND l.qty_micro>0
      AND pl.unit_sell_paisa=NEW.unit_price_paisa
      AND pl.unit_revision=0
      AND p.source_profile='new' AND p.status='Active' AND p.is_deleted=0
      AND p.product_type_text='Standard' AND p.current_unit_revision=0
      AND NEW.lot_sequence=(
        SELECT first_lot.sequence FROM owner_mvp_stock_lots first_lot
        WHERE first_lot.product_id=NEW.product_id AND first_lot.qty_micro>0
        ORDER BY first_lot.purchased_on,first_lot.sequence LIMIT 1
      )
  );
END;
-- next statement
CREATE TRIGGER owner_mvp_sale_post AFTER INSERT ON owner_mvp_sale_receipts
BEGIN
  INSERT INTO owner_mvp_sale_fifo_draws
    (sale_sequence,lot_sequence,quantity_micro,unit_cost_paisa,unit_sell_paisa)
  SELECT NEW.sequence,l.sequence,NEW.quantity_micro,l.unit_cost_paisa,NEW.unit_price_paisa
  FROM owner_mvp_stock_lots l WHERE l.sequence=NEW.lot_sequence;
  UPDATE owner_mvp_stock_lots
    SET qty_micro=qty_micro-NEW.quantity_micro
    WHERE sequence=NEW.lot_sequence AND qty_micro>=NEW.quantity_micro;
  UPDATE owner_mvp_product_stock
    SET quantity_micro=quantity_micro-NEW.quantity_micro
    WHERE product_id=NEW.product_id AND quantity_micro>=NEW.quantity_micro;
  INSERT INTO owner_mvp_sale_cash_book(sale_sequence,cash_sequence,received_paisa)
    VALUES(NEW.sequence,NEW.cash_sequence,NEW.subtotal_paisa);
END;
-- next statement
-- Until a reviewed cash-count settlement is enabled, forbid closing a Session
-- with Sale receipts rather than reporting a false zero variance. This is
-- explicitly a pilot safeguard, NOT a completed cash closing workflow.
CREATE TRIGGER owner_mvp_sale_cash_close_gate
BEFORE UPDATE OF status ON owner_mvp_cash_sessions
WHEN OLD.status='Open' AND NEW.status='Closed' AND
  EXISTS(SELECT 1 FROM owner_mvp_sale_cash_book b WHERE b.cash_sequence=OLD.sequence)
BEGIN SELECT RAISE(ABORT,'MVP_CASH_RECONCILIATION_REQUIRED'); END;
-- next statement
CREATE TRIGGER owner_mvp_sale_immutable_update BEFORE UPDATE ON owner_mvp_sale_receipts
BEGIN SELECT RAISE(ABORT,'MVP_SALE_RECEIPT_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_mvp_sale_immutable_delete BEFORE DELETE ON owner_mvp_sale_receipts
BEGIN SELECT RAISE(ABORT,'MVP_SALE_RECEIPT_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_mvp_sale_draw_immutable_update BEFORE UPDATE ON owner_mvp_sale_fifo_draws
BEGIN SELECT RAISE(ABORT,'MVP_SALE_FIFO_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_mvp_sale_draw_immutable_delete BEFORE DELETE ON owner_mvp_sale_fifo_draws
BEGIN SELECT RAISE(ABORT,'MVP_SALE_FIFO_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_mvp_sale_cash_immutable_update BEFORE UPDATE ON owner_mvp_sale_cash_book
BEGIN SELECT RAISE(ABORT,'MVP_SALE_CASH_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_mvp_sale_cash_immutable_delete BEFORE DELETE ON owner_mvp_sale_cash_book
BEGIN SELECT RAISE(ABORT,'MVP_SALE_CASH_IMMUTABLE'); END;
