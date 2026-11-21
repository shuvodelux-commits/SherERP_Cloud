-- M03 Customer master: clean-Shop, original Customer identity, no accounting.
-- Must be applied only after migrations/0002_party_identity.sql and Shop Owner
-- identity/lease migrations. This does NOT migrate historical Customer debt.
-- A separate PTY-CUS namespace avoids Supplier PTY-000001 collisions.
CREATE TABLE owner_customer_preflight (
  historical_customer_identity INTEGER NOT NULL CHECK(historical_customer_identity=0)
) STRICT;
-- next statement
INSERT INTO owner_customer_preflight
SELECT EXISTS(SELECT 1 FROM party_roles WHERE role='Customer')
  OR EXISTS(SELECT 1 FROM party_legacy_links WHERE source_group='CUSTOMERS');
-- next statement
DROP TABLE owner_customer_preflight;
-- next statement
CREATE TABLE owner_customer_master (
  customer_id TEXT PRIMARY KEY NOT NULL CHECK(length(customer_id) BETWEEN 10 AND 24),
  party_id TEXT NOT NULL UNIQUE REFERENCES parties(party_id) ON DELETE RESTRICT,
  father_name TEXT NOT NULL DEFAULT '',
  relation_type TEXT NOT NULL DEFAULT 'Father' CHECK(relation_type IN ('Father','Husband')),
  notes TEXT NOT NULL DEFAULT '',
  opening_paisa INTEGER NOT NULL DEFAULT 0 CHECK(opening_paisa=0),
  current_due_paisa INTEGER NOT NULL DEFAULT 0 CHECK(current_due_paisa=0),
  status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Inactive')),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms>0)
) STRICT;
-- next statement
CREATE TABLE owner_customer_create_receipts (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT CHECK(sequence BETWEEN 1 AND 9007199254740991),
  operation_id TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms>0)
) STRICT;
-- next statement
CREATE TRIGGER owner_customer_receipt_creates_identity
AFTER INSERT ON owner_customer_create_receipts
BEGIN
  INSERT INTO parties(party_id,display_name,party_kind,phone,address,status,created_at)
  VALUES('PTY-CUS-'||printf('%06d',NEW.sequence),json_extract(NEW.payload,'$.name'),
    'UNKNOWN',json_extract(NEW.payload,'$.phone'),
    json_extract(NEW.payload,'$.address'),'ACTIVE',
    strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  INSERT INTO party_roles(party_id,role,status,created_at)
  VALUES('PTY-CUS-'||printf('%06d',NEW.sequence),'Customer','ACTIVE',
    strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  INSERT INTO owner_customer_master(customer_id,party_id,father_name,relation_type,notes,created_at_ms)
  VALUES('CUS-'||printf('%06d',NEW.sequence),
    'PTY-CUS-'||printf('%06d',NEW.sequence),
    json_extract(NEW.payload,'$.fatherName'),json_extract(NEW.payload,'$.relationType'),
    json_extract(NEW.payload,'$.notes'),NEW.created_at_ms);
END;
-- next statement
CREATE TRIGGER owner_customer_receipt_immutable_update
BEFORE UPDATE ON owner_customer_create_receipts
BEGIN SELECT RAISE(ABORT,'Owner Customer create receipt is immutable'); END;
-- next statement
CREATE TRIGGER owner_customer_receipt_immutable_delete
BEFORE DELETE ON owner_customer_create_receipts
BEGIN SELECT RAISE(ABORT,'Owner Customer create receipt is immutable'); END;
-- next statement
CREATE TRIGGER owner_customer_master_no_rekey
BEFORE UPDATE OF customer_id,party_id ON owner_customer_master
BEGIN SELECT RAISE(ABORT,'Customer Party identity is immutable'); END;
-- next statement
CREATE TRIGGER owner_customer_master_no_delete
BEFORE DELETE ON owner_customer_master
BEGIN SELECT RAISE(ABORT,'Customer identities cannot be deleted'); END;
