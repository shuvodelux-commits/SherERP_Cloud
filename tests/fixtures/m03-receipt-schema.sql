-- M03 test fixture ONLY. Not a deployable migration or approved ERP ledger.
-- Receipts represent *committed* operations; never write pending/failed intents.
CREATE TABLE operation_receipts (
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) BETWEEN 1 AND 128 AND tenant_id NOT GLOB '*[^A-Za-z0-9_.:-]*'),
  operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 64 AND operation_id NOT GLOB '*[^A-Z0-9_-]*'),
  actor_id TEXT NOT NULL CHECK(length(actor_id) BETWEEN 1 AND 128 AND actor_id NOT GLOB '*[^A-Za-z0-9_.:-]*'),
  operation_type TEXT NOT NULL CHECK(length(operation_type) BETWEEN 2 AND 64 AND operation_type NOT GLOB '*[^a-z0-9._-]*'),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64 AND payload_hash NOT GLOB '*[^a-f0-9]*'),
  result_ref TEXT NOT NULL CHECK(length(trim(result_ref))>0),
  committed_at TEXT NOT NULL CHECK(length(trim(committed_at))>0),
  PRIMARY KEY(tenant_id,operation_id)
) STRICT;
CREATE TRIGGER receipt_no_update BEFORE UPDATE ON operation_receipts
BEGIN SELECT RAISE(ABORT,'Committed receipt is immutable'); END;
CREATE TRIGGER receipt_no_delete BEFORE DELETE ON operation_receipts
BEGIN SELECT RAISE(ABORT,'Committed receipt is immutable'); END;
