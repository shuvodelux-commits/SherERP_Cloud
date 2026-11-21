-- Staged for a separately reviewed Shop D1 release. NEVER run on Control D1.
-- Add only after verified Owner-ready schema, product receipts and M08 checks.
-- This is ONE exact-scoped Support Product operation; never an Owner login.
CREATE TABLE shop_support_product_permits (
  intent_id TEXT PRIMARY KEY CHECK(length(intent_id)=36),
  grant_id TEXT NOT NULL CHECK(length(grant_id)=36),
  operation_id TEXT NOT NULL UNIQUE CHECK(length(operation_id)=36),
  shop_id TEXT NOT NULL CHECK(length(shop_id)=36),
  database_id TEXT NOT NULL CHECK(length(database_id)=36),
  database_marker TEXT NOT NULL CHECK(length(database_marker)=36),
  actor_id TEXT NOT NULL CHECK(actor_id LIKE 'support:%' AND length(actor_id)<=128),
  name_key TEXT NOT NULL CHECK(length(name_key) BETWEEN 1 AND 120),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64 AND intent_hash NOT GLOB '*[^0-9a-f]*'),
  issued_at_ms INTEGER NOT NULL CHECK(issued_at_ms>0),
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>issued_at_ms
    AND expires_at_ms-issued_at_ms<=300000)
) STRICT;
-- next statement
CREATE TRIGGER shop_support_product_permits_no_update
BEFORE UPDATE ON shop_support_product_permits
BEGIN SELECT RAISE(ABORT,'immutable Support Product permit'); END;
-- next statement
CREATE TRIGGER shop_support_product_permits_no_delete
BEFORE DELETE ON shop_support_product_permits
BEGIN SELECT RAISE(ABORT,'immutable Support Product permit'); END;
-- next statement
CREATE TRIGGER shop_support_product_receipt_gate
BEFORE INSERT ON owner_product_create_receipts
WHEN NEW.actor_id LIKE 'support:%' AND NOT EXISTS (
  SELECT 1 FROM shop_support_product_permits p
  JOIN shop_identity i ON i.singleton=1
  WHERE p.operation_id=NEW.operation_id
    AND p.intent_id=NEW.operation_id
    AND p.intent_hash=NEW.intent_hash
    AND p.actor_id=NEW.actor_id
    AND p.name_key=NEW.name_key AND p.payload=NEW.payload
    AND p.shop_id=i.shop_id
    AND p.database_id=i.database_id
    AND p.database_marker=i.database_marker
    AND p.issued_at_ms<=CAST(unixepoch('subsec')*1000 AS INTEGER)
    AND p.expires_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)
)
BEGIN SELECT RAISE(ABORT,'missing exact live Support Product permit'); END;
