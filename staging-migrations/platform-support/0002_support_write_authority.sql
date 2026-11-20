-- M03 support edit authorization; Control D1 only, additive, NOT deployed.
-- This schema creates NO Owner business writer or Owner session.
CREATE TABLE m03_support_write_attempts (
  attempt_id TEXT PRIMARY KEY CHECK(length(attempt_id)=36),
  read_grant_operation_id TEXT NOT NULL REFERENCES m03_local_support_grants(operation_id),
  admin_session_hash TEXT NOT NULL CHECK(length(admin_session_hash)=64),
  attempted_at_ms INTEGER NOT NULL CHECK(attempted_at_ms>0)
) STRICT;
-- next statement
CREATE INDEX m03_support_write_attempt_window
ON m03_support_write_attempts(admin_session_hash,attempted_at_ms);
-- next statement
CREATE TABLE m03_support_write_grants (
  operation_id TEXT PRIMARY KEY CHECK(length(operation_id)=36),
  read_grant_operation_id TEXT NOT NULL REFERENCES m03_local_support_grants(operation_id),
  shop_id TEXT NOT NULL REFERENCES platform_shop_bindings(shop_id),
  database_id TEXT NOT NULL CHECK(length(database_id)=36),
  database_marker TEXT NOT NULL CHECK(length(database_marker)=36),
  admin_session_hash TEXT NOT NULL CHECK(length(admin_session_hash)=64),
  actor_subject TEXT NOT NULL CHECK(length(actor_subject) BETWEEN 1 AND 255),
  scope TEXT NOT NULL CHECK(scope IN ('products','parties','purchases','pos','returns','finance')),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 12 AND 180),
  factor_version INTEGER NOT NULL CHECK(factor_version>0),
  otp_step INTEGER NOT NULL CHECK(otp_step>0),
  issued_at_ms INTEGER NOT NULL CHECK(issued_at_ms>0),
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>issued_at_ms AND expires_at_ms-issued_at_ms<=300000),
  revoked_at_ms INTEGER CHECK(revoked_at_ms IS NULL OR revoked_at_ms>=issued_at_ms),
  UNIQUE(admin_session_hash,otp_step),
  UNIQUE(read_grant_operation_id,scope)
) STRICT;
-- next statement
CREATE TABLE m03_support_write_intents (
  intent_id TEXT PRIMARY KEY CHECK(length(intent_id)=36),
  write_grant_operation_id TEXT NOT NULL REFERENCES m03_support_write_grants(operation_id),
  shop_id TEXT NOT NULL REFERENCES platform_shop_bindings(shop_id),
  action TEXT NOT NULL CHECK(action IN
    ('products.add','parties.add','purchases.post','pos.sale','returns.post','finance.post')),
  intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64 AND intent_hash NOT GLOB '*[^0-9a-f]*'),
  actor_subject TEXT NOT NULL CHECK(length(actor_subject) BETWEEN 1 AND 255),
  authorized_at_ms INTEGER NOT NULL CHECK(authorized_at_ms>0)
) STRICT;
-- next statement
CREATE TABLE m03_support_write_events (
  event_id TEXT PRIMARY KEY CHECK(length(event_id)>=36),
  write_grant_operation_id TEXT NOT NULL REFERENCES m03_support_write_grants(operation_id),
  shop_id TEXT NOT NULL REFERENCES platform_shop_bindings(shop_id),
  actor_subject TEXT NOT NULL CHECK(length(actor_subject) BETWEEN 1 AND 255),
  event_type TEXT NOT NULL CHECK(event_type IN ('GRANT','INTENT','RESULT','REVOKE')),
  intent_id TEXT,
  event_at_ms INTEGER NOT NULL CHECK(event_at_ms>0)
) STRICT;
-- next statement
CREATE TRIGGER m03_support_write_grant_issued
AFTER INSERT ON m03_support_write_grants
BEGIN
  INSERT INTO m03_support_write_events
    (event_id,write_grant_operation_id,shop_id,actor_subject,event_type,event_at_ms)
  VALUES (NEW.operation_id||':GRANT',NEW.operation_id,NEW.shop_id,NEW.actor_subject,'GRANT',NEW.issued_at_ms);
END;
-- next statement
CREATE TRIGGER m03_support_write_intent_added
AFTER INSERT ON m03_support_write_intents
BEGIN
  INSERT INTO m03_support_write_events
    (event_id,write_grant_operation_id,shop_id,actor_subject,event_type,intent_id,event_at_ms)
  VALUES (NEW.intent_id||':INTENT',NEW.write_grant_operation_id,NEW.shop_id,NEW.actor_subject,
    'INTENT',NEW.intent_id,NEW.authorized_at_ms);
END;
-- next statement
CREATE TRIGGER m03_support_write_grants_no_mutation
BEFORE UPDATE ON m03_support_write_grants
WHEN OLD.revoked_at_ms IS NOT NULL OR NEW.revoked_at_ms IS NULL
  OR NEW.operation_id IS NOT OLD.operation_id
  OR NEW.read_grant_operation_id IS NOT OLD.read_grant_operation_id
  OR NEW.shop_id IS NOT OLD.shop_id
  OR NEW.database_id IS NOT OLD.database_id
  OR NEW.database_marker IS NOT OLD.database_marker
  OR NEW.admin_session_hash IS NOT OLD.admin_session_hash
  OR NEW.actor_subject IS NOT OLD.actor_subject
  OR NEW.scope IS NOT OLD.scope
  OR NEW.reason IS NOT OLD.reason
  OR NEW.factor_version IS NOT OLD.factor_version
  OR NEW.otp_step IS NOT OLD.otp_step
  OR NEW.issued_at_ms IS NOT OLD.issued_at_ms
  OR NEW.expires_at_ms IS NOT OLD.expires_at_ms
BEGIN SELECT RAISE(ABORT,'immutable support edit grant'); END;
-- next statement
CREATE TRIGGER m03_support_write_grant_revoked
AFTER UPDATE OF revoked_at_ms ON m03_support_write_grants
WHEN OLD.revoked_at_ms IS NULL AND NEW.revoked_at_ms IS NOT NULL
BEGIN
  INSERT INTO m03_support_write_events
    (event_id,write_grant_operation_id,shop_id,actor_subject,event_type,event_at_ms)
  VALUES (NEW.operation_id||':REVOKE',NEW.operation_id,NEW.shop_id,NEW.actor_subject,'REVOKE',NEW.revoked_at_ms);
END;
-- next statement
CREATE TRIGGER m03_support_write_grants_no_delete
BEFORE DELETE ON m03_support_write_grants
BEGIN SELECT RAISE(ABORT,'immutable support edit grant'); END;
-- next statement
CREATE TRIGGER m03_support_write_intents_no_update
BEFORE UPDATE ON m03_support_write_intents
BEGIN SELECT RAISE(ABORT,'immutable support edit intent'); END;
-- next statement
CREATE TRIGGER m03_support_write_intents_no_delete
BEFORE DELETE ON m03_support_write_intents
BEGIN SELECT RAISE(ABORT,'immutable support edit intent'); END;
-- next statement
CREATE TRIGGER m03_support_write_events_no_update
BEFORE UPDATE ON m03_support_write_events
BEGIN SELECT RAISE(ABORT,'immutable support edit audit'); END;
-- next statement
CREATE TRIGGER m03_support_write_events_no_delete
BEFORE DELETE ON m03_support_write_events
BEGIN SELECT RAISE(ABORT,'immutable support edit audit'); END;
