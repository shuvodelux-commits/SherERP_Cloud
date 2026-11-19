-- Apply after operational Products (0013) and the verified Shop grant (0002).
-- This sequence starts at 1 for a clean business. Abort if a shop already
-- contains Products or backup history, which require a reviewed source floor.
CREATE TABLE owner_product_create_receipts (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT CHECK(sequence BETWEEN 1 AND 9007199254740991),
  operation_id TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  intent_hash TEXT NOT NULL,
  name_key TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  created_at_ms INTEGER NOT NULL
) STRICT;
-- next statement
CREATE TABLE owner_product_clean_shop_preflight (
  existing_products INTEGER NOT NULL CHECK(existing_products=0)
) STRICT;
-- next statement
INSERT INTO owner_product_clean_shop_preflight
SELECT EXISTS(SELECT 1 FROM products) OR EXISTS(SELECT 1 FROM legacy_product_snapshots);
-- next statement
DROP TABLE owner_product_clean_shop_preflight;
-- next statement
CREATE INDEX owner_product_create_name ON owner_product_create_receipts(name_key);
-- next statement
CREATE TRIGGER owner_product_create_receipt_insert_product
AFTER INSERT ON owner_product_create_receipts
BEGIN
  INSERT INTO products (
    product_id, source_profile, product_name, brand_text, category_name, base_unit_name, barcode_text,
    purchase_price_text, selling_price_text, opening_stock_text, minimum_stock_text, product_type_text
  ) VALUES (
    'PRD-' || printf('%06d',NEW.sequence),'new',NEW.payload->>'name',NEW.payload->>'brand',
    NEW.payload->>'category',NEW.payload->>'unit',NEW.payload->>'barcode',NEW.payload->>'purchasePrice',
    NEW.payload->>'sellingPrice','0',NEW.payload->>'minStock','Standard'
  );
END;
-- next statement
CREATE TRIGGER owner_product_create_receipt_no_update
BEFORE UPDATE ON owner_product_create_receipts
BEGIN
  SELECT RAISE(ABORT,'Owner product receipt is immutable');
END;
-- next statement
CREATE TRIGGER owner_product_create_receipt_no_delete
BEFORE DELETE ON owner_product_create_receipts
BEGIN
  SELECT RAISE(ABORT,'Owner product receipt is immutable');
END;
-- next statement
CREATE TRIGGER owner_product_create_receipt_no_replace
BEFORE INSERT ON owner_product_create_receipts
WHEN EXISTS(SELECT 1 FROM owner_product_create_receipts
  WHERE operation_id=NEW.operation_id OR sequence=NEW.sequence)
BEGIN
  SELECT RAISE(ABORT,'Owner product receipt is immutable');
END;
