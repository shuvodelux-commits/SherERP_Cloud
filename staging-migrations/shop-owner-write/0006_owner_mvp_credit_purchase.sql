-- M03 MVP operational clean-Shop credit Purchase + receiving. Source: Mohim_ERP pinned
-- Purchase.gs requires an Open Cash Session even for an unpaid purchase.
-- For now only new clean-Shop Products/Suppliers, single base unit, zero discount,
-- zero paid, date today Dhaka. No fake Cash Book, Bank or historical inventory.
CREATE TABLE owner_mvp_cash_sessions (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('Open','Closed')),
  opening_paisa INTEGER NOT NULL CHECK(opening_paisa=0),
  started_at_ms INTEGER NOT NULL CHECK(started_at_ms>0),
  closed_operation_id TEXT UNIQUE,
  closed_at_ms INTEGER
) STRICT;
-- next statement
CREATE UNIQUE INDEX owner_mvp_one_open_cash_session
ON owner_mvp_cash_sessions(status) WHERE status='Open';
-- next statement
CREATE TABLE owner_mvp_purchase_receipts (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT CHECK(sequence BETWEEN 1 AND 9007199254740991),
  operation_id TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
  supplier_id TEXT NOT NULL REFERENCES owner_supplier_master(supplier_id) ON DELETE RESTRICT,
  cash_sequence INTEGER NOT NULL REFERENCES owner_mvp_cash_sessions(sequence) ON DELETE RESTRICT,
  purchase_date TEXT NOT NULL CHECK(length(purchase_date)=10),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  subtotal_paisa INTEGER NOT NULL CHECK(subtotal_paisa BETWEEN 1 AND 1000000000000),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms>0)
) STRICT;
-- next statement
CREATE TABLE owner_mvp_purchase_lines (
  purchase_sequence INTEGER NOT NULL REFERENCES owner_mvp_purchase_receipts(sequence) ON DELETE RESTRICT,
  line_number INTEGER NOT NULL CHECK(line_number BETWEEN 1 AND 50),
  product_id TEXT NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  unit_name TEXT NOT NULL,
  quantity_micro INTEGER NOT NULL CHECK(quantity_micro BETWEEN 1 AND 1000000000),
  unit_cost_paisa INTEGER NOT NULL CHECK(unit_cost_paisa BETWEEN 0 AND 1000000000),
  unit_sell_paisa INTEGER NOT NULL CHECK(unit_sell_paisa BETWEEN 0 AND 1000000000),
  line_total_paisa INTEGER NOT NULL CHECK(line_total_paisa BETWEEN 0 AND 1000000000000),
  unit_revision INTEGER NOT NULL CHECK(unit_revision=0),
  PRIMARY KEY(purchase_sequence,line_number),
  UNIQUE(purchase_sequence,product_id)
) STRICT;
-- next statement
CREATE TABLE owner_mvp_stock_lots (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_sequence INTEGER NOT NULL,
  line_number INTEGER NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
  received_micro INTEGER NOT NULL CHECK(received_micro>0),
  qty_micro INTEGER NOT NULL CHECK(qty_micro>=0 AND qty_micro<=received_micro),
  unit_cost_paisa INTEGER NOT NULL CHECK(unit_cost_paisa>=0),
  purchased_on TEXT NOT NULL,
  UNIQUE(purchase_sequence,line_number),
  FOREIGN KEY(purchase_sequence,line_number)
    REFERENCES owner_mvp_purchase_lines(purchase_sequence,line_number) ON DELETE RESTRICT
) STRICT;
-- next statement
CREATE INDEX owner_mvp_lots_fifo
ON owner_mvp_stock_lots(product_id,purchased_on,sequence);
-- next statement
CREATE TABLE owner_mvp_product_stock (
  product_id TEXT PRIMARY KEY REFERENCES products(product_id) ON DELETE RESTRICT,
  quantity_micro INTEGER NOT NULL CHECK(quantity_micro BETWEEN 0 AND 9007199254740991)
) STRICT;
-- next statement
CREATE TABLE owner_mvp_supplier_ledger (
  purchase_sequence INTEGER PRIMARY KEY
    REFERENCES owner_mvp_purchase_receipts(sequence) ON DELETE RESTRICT,
  supplier_id TEXT NOT NULL REFERENCES owner_supplier_master(supplier_id) ON DELETE RESTRICT,
  debit_paisa INTEGER NOT NULL CHECK(debit_paisa BETWEEN 1 AND 1000000000000),
  credit_paisa INTEGER NOT NULL DEFAULT 0 CHECK(credit_paisa=0),
  entry_type TEXT NOT NULL DEFAULT 'Purchase' CHECK(entry_type='Purchase')
) STRICT;
-- next statement
CREATE TABLE owner_mvp_purchase_seals (
  purchase_sequence INTEGER PRIMARY KEY REFERENCES owner_mvp_purchase_receipts(sequence) ON DELETE RESTRICT,
  line_count INTEGER NOT NULL CHECK(line_count BETWEEN 1 AND 50),
  total_paisa INTEGER NOT NULL CHECK(total_paisa BETWEEN 1 AND 1000000000000)
) STRICT;
-- next statement
CREATE TRIGGER owner_mvp_purchase_validate BEFORE INSERT ON owner_mvp_purchase_receipts
BEGIN
  SELECT RAISE(ABORT,'MVP_NO_OPEN_CASH_SESSION')
  WHERE NOT EXISTS(SELECT 1 FROM owner_mvp_cash_sessions s
    WHERE s.sequence=NEW.cash_sequence AND s.status='Open');
  SELECT RAISE(ABORT,'MVP_SUPPLIER_NOT_ACTIVE')
  WHERE NOT EXISTS(SELECT 1 FROM owner_supplier_master s
    JOIN parties p ON p.party_id=s.party_id AND p.status='ACTIVE'
    JOIN party_roles r ON r.party_id=s.party_id AND r.role='Supplier' AND r.status='ACTIVE'
    WHERE s.supplier_id=NEW.supplier_id AND s.status='Active');
  SELECT RAISE(ABORT,'MVP_PURCHASE_LINE_INVALID')
  WHERE json_type(NEW.payload,'$.items')!='array'
    OR json_array_length(NEW.payload,'$.items') NOT BETWEEN 1 AND 50
    OR (SELECT count(DISTINCT json_extract(j.value,'$.productId'))
        FROM json_each(NEW.payload,'$.items') j)<>json_array_length(NEW.payload,'$.items')
    OR EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.items') j WHERE
      json_type(j.value,'$.productId')!='text'
      OR json_type(j.value,'$.qtyMicro')!='integer'
      OR json_extract(j.value,'$.qtyMicro') NOT BETWEEN 1 AND 1000000000
      OR json_type(j.value,'$.unitPricePaisa')!='integer'
      OR json_extract(j.value,'$.unitPricePaisa') NOT BETWEEN 0 AND 1000000000
      OR json_type(j.value,'$.sellPricePaisa')!='integer'
      OR json_extract(j.value,'$.sellPricePaisa') NOT BETWEEN 0 AND 1000000000
      OR json_type(j.value,'$.unitRevision')!='integer'
      OR json_extract(j.value,'$.unitRevision')!=0
      OR (json_extract(j.value,'$.qtyMicro')*
          json_extract(j.value,'$.unitPricePaisa'))%1000000!=0)
    OR (SELECT count(*) FROM json_each(NEW.payload,'$.items') j
      JOIN products p ON p.product_id=json_extract(j.value,'$.productId')
        AND p.source_profile='new' AND p.status='Active' AND p.is_deleted=0
        AND p.product_type_text='Standard' AND p.current_unit_revision=0)
      <>json_array_length(NEW.payload,'$.items')
    OR COALESCE((SELECT sum(json_extract(j.value,'$.qtyMicro')*
                   json_extract(j.value,'$.unitPricePaisa')/1000000)
        FROM json_each(NEW.payload,'$.items') j),-1)<>NEW.subtotal_paisa;
END;
-- next statement
CREATE TRIGGER owner_mvp_purchase_post AFTER INSERT ON owner_mvp_purchase_receipts
BEGIN
  INSERT INTO owner_mvp_purchase_lines(
    purchase_sequence,line_number,product_id,product_name,unit_name,
    quantity_micro,unit_cost_paisa,unit_sell_paisa,line_total_paisa,unit_revision)
  SELECT NEW.sequence,CAST(j.key AS INTEGER)+1,p.product_id,p.product_name,p.base_unit_name,
    json_extract(j.value,'$.qtyMicro'),json_extract(j.value,'$.unitPricePaisa'),
    json_extract(j.value,'$.sellPricePaisa'),
    json_extract(j.value,'$.qtyMicro')*json_extract(j.value,'$.unitPricePaisa')/1000000,0
  FROM json_each(NEW.payload,'$.items') j
  JOIN products p ON p.product_id=json_extract(j.value,'$.productId');
  INSERT INTO owner_mvp_stock_lots(
    purchase_sequence,line_number,product_id,received_micro,qty_micro,unit_cost_paisa,purchased_on)
  SELECT purchase_sequence,line_number,product_id,quantity_micro,quantity_micro,
    unit_cost_paisa,NEW.purchase_date FROM owner_mvp_purchase_lines
  WHERE purchase_sequence=NEW.sequence;
  INSERT INTO owner_mvp_product_stock(product_id,quantity_micro)
  SELECT product_id,quantity_micro FROM owner_mvp_purchase_lines
    WHERE purchase_sequence=NEW.sequence AND true
  ON CONFLICT(product_id) DO UPDATE SET quantity_micro=
    owner_mvp_product_stock.quantity_micro+excluded.quantity_micro;
  INSERT INTO owner_mvp_supplier_ledger(purchase_sequence,supplier_id,debit_paisa)
    VALUES(NEW.sequence,NEW.supplier_id,NEW.subtotal_paisa);
  UPDATE owner_supplier_master
    SET current_due_paisa=current_due_paisa+NEW.subtotal_paisa
    WHERE supplier_id=NEW.supplier_id;
  UPDATE products SET selling_price_text=(
    SELECT printf('%d.%02d',l.unit_sell_paisa/100,l.unit_sell_paisa%100)
      FROM owner_mvp_purchase_lines l
      WHERE l.purchase_sequence=NEW.sequence AND l.product_id=products.product_id)
    WHERE product_id IN (SELECT product_id FROM owner_mvp_purchase_lines
      WHERE purchase_sequence=NEW.sequence);
  INSERT INTO owner_mvp_purchase_seals(purchase_sequence,line_count,total_paisa)
    SELECT NEW.sequence,count(*),sum(line_total_paisa) FROM owner_mvp_purchase_lines
    WHERE purchase_sequence=NEW.sequence;
END;
-- next statement
CREATE TRIGGER owner_mvp_receipt_immutable_update BEFORE UPDATE ON owner_mvp_purchase_receipts
BEGIN SELECT RAISE(ABORT,'MVP_PURCHASE_RECEIPT_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_mvp_receipt_immutable_delete BEFORE DELETE ON owner_mvp_purchase_receipts
BEGIN SELECT RAISE(ABORT,'MVP_PURCHASE_RECEIPT_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_mvp_lines_immutable_update BEFORE UPDATE ON owner_mvp_purchase_lines
BEGIN SELECT RAISE(ABORT,'MVP_PURCHASE_LINE_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_mvp_lines_immutable_delete BEFORE DELETE ON owner_mvp_purchase_lines
BEGIN SELECT RAISE(ABORT,'MVP_PURCHASE_LINE_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_mvp_supplier_immutable_update BEFORE UPDATE ON owner_mvp_supplier_ledger
BEGIN SELECT RAISE(ABORT,'MVP_SUPPLIER_LEDGER_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_mvp_supplier_immutable_delete BEFORE DELETE ON owner_mvp_supplier_ledger
BEGIN SELECT RAISE(ABORT,'MVP_SUPPLIER_LEDGER_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_mvp_lot_identity_immutable BEFORE UPDATE OF purchase_sequence,line_number,product_id,received_micro,unit_cost_paisa,purchased_on ON owner_mvp_stock_lots
BEGIN SELECT RAISE(ABORT,'MVP_LOT_IDENTITY_IMMUTABLE'); END;
-- next statement
CREATE TRIGGER owner_mvp_lot_no_delete BEFORE DELETE ON owner_mvp_stock_lots
BEGIN SELECT RAISE(ABORT,'MVP_LOT_IMMUTABLE'); END;
