-- Option A Task 2. Control D1, not Shop D1: durable, idempotent external D1 create journal.
-- This migration MUST NOT be executed on a live account without a reviewed
-- backup/restore rehearsal and explicit operator release approval.
CREATE TABLE platform_hosted_shop_create_journal (
  operation_id TEXT PRIMARY KEY NOT NULL REFERENCES platform_shop_reservations(operation_id),
  shop_id TEXT NOT NULL UNIQUE REFERENCES platform_shop_reservations(shop_id),
  account_id TEXT NOT NULL CHECK(length(account_id)=32),
  database_name TEXT NOT NULL UNIQUE CHECK(length(database_name) BETWEEN 15 AND 63),
  attempt_id TEXT NOT NULL UNIQUE CHECK(length(attempt_id) BETWEEN 40 AND 80),
  state TEXT NOT NULL CHECK(state IN ('reserved','creating','outcome-unknown','database-created')),
  database_id TEXT UNIQUE CHECK(database_id IS NULL OR length(database_id)=36),
  evidence_ref TEXT,
  failed_stage TEXT CHECK(failed_stage IS NULL OR failed_stage IN ('capacity','database-creation','reconciliation')),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms>0),
  updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms>=created_at_ms),
  CHECK((state='database-created')=(database_id IS NOT NULL)),
  CHECK((database_id IS NULL)=(evidence_ref IS NULL)),
  CHECK(state<>'database-created' OR failed_stage IS NULL)
) STRICT;
-- next statement
CREATE TRIGGER platform_hosted_shop_create_journal_no_delete
BEFORE DELETE ON platform_hosted_shop_create_journal
BEGIN
  SELECT RAISE(ABORT,'hosted shop create history is immutable');
END;
-- next statement
CREATE TRIGGER platform_hosted_shop_create_journal_immutable
BEFORE UPDATE ON platform_hosted_shop_create_journal
WHEN NEW.operation_id IS NOT OLD.operation_id
  OR NEW.shop_id IS NOT OLD.shop_id
  OR NEW.account_id IS NOT OLD.account_id
  OR NEW.database_name IS NOT OLD.database_name
  OR NEW.attempt_id IS NOT OLD.attempt_id
  OR NEW.created_at_ms IS NOT OLD.created_at_ms
  OR (OLD.database_id IS NOT NULL AND NEW.database_id IS NOT OLD.database_id)
  OR (OLD.evidence_ref IS NOT NULL AND NEW.evidence_ref IS NOT OLD.evidence_ref)
  OR (OLD.state='database-created' AND NEW.state<>'database-created')
BEGIN
  SELECT RAISE(ABORT,'hosted shop create intent or receipt is immutable');
END;
