-- M03 MVP: clean-shop Supplier Quick Add, with immutable source-compatible Supplier IDs.
-- Additive Shop D1 only. Requires reviewed 0002_party_identity and active Owner grant.
-- Block nonempty Party history before generating any new source ID floor.
CREATE TABLE owner_supplier_preflight (
  existing_identity INTEGER NOT NULL CHECK(existing_identity=0)
) STRICT;
-- next statement
INSERT INTO owner_supplier_preflight
SELECT EXISTS(SELECT 1 FROM parties) OR EXISTS(SELECT 1 FROM party_roles)
  OR EXISTS(SELECT 1 FROM party_legacy_links);
-- next statement
DROP TABLE owner_supplier_preflight;
-- next statement
CREATE TABLE owner_supplier_master (
  supplier_id TEXT PRIMARY KEY NOT NULL,
  party_id TEXT NOT NULL UNIQUE REFERENCES parties(party_id) ON DELETE RESTRICT,
  name_key TEXT NOT NULL CHECK(length(name_key)>0),
  notes TEXT NOT NULL DEFAULT '',
  opening_paisa INTEGER NOT NULL DEFAULT 0 CHECK(opening_paisa=0),
  current_due_paisa INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Inactive')),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms>0)
) STRICT;
-- next statement
CREATE UNIQUE INDEX owner_supplier_active_name
ON owner_supplier_master(name_key) WHERE status='Active';
-- next statement
CREATE TABLE owner_supplier_create_receipts (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT CHECK(sequence BETWEEN 1 AND 9007199254740991),
  operation_id TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
  name_key TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms>0)
) STRICT;
-- next statement
CREATE TRIGGER owner_supplier_receipt_creates_identity
AFTER INSERT ON owner_supplier_create_receipts
BEGIN
  INSERT INTO parties(party_id,display_name,party_kind,phone,address,status,created_at)
  VALUES ('PTY-'||printf('%06d',NEW.sequence),json_extract(NEW.payload,'$.name'),
    'UNKNOWN',json_extract(NEW.payload,'$.phone'),
    json_extract(NEW.payload,'$.address'),'ACTIVE',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  INSERT INTO party_roles(party_id,role,status,created_at)
  VALUES ('PTY-'||printf('%06d',NEW.sequence),'Supplier','ACTIVE',
    strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  INSERT INTO owner_supplier_master(supplier_id,party_id,name_key,notes,created_at_ms)
  VALUES ('SUP-'||printf('%06d',NEW.sequence),'PTY-'||printf('%06d',NEW.sequence),
    NEW.name_key,json_extract(NEW.payload,'$.notes'),NEW.created_at_ms);
END;
-- next statement
CREATE TRIGGER owner_supplier_receipt_no_update
BEFORE UPDATE ON owner_supplier_create_receipts
BEGIN SELECT RAISE(ABORT,'Owner supplier receipt is immutable'); END;
-- next statement
CREATE TRIGGER owner_supplier_receipt_no_delete
BEFORE DELETE ON owner_supplier_create_receipts
BEGIN SELECT RAISE(ABORT,'Owner supplier receipt is immutable'); END;
-- next statement
CREATE TRIGGER owner_supplier_master_no_rekey
BEFORE UPDATE OF supplier_id,party_id ON owner_supplier_master
BEGIN SELECT RAISE(ABORT,'Supplier and Party identities are immutable'); END;
-- next statement
CREATE TRIGGER owner_supplier_master_no_delete
BEFORE DELETE ON owner_supplier_master
BEGIN SELECT RAISE(ABORT,'Supplier records cannot be deleted'); END;
