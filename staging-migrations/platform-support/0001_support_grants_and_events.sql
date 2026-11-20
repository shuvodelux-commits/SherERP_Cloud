CREATE TABLE m03_local_support_grants (
    operation_id TEXT PRIMARY KEY CHECK(length(operation_id)=36),
    token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
    shop_id TEXT NOT NULL REFERENCES platform_shop_bindings(shop_id),
    database_id TEXT NOT NULL CHECK(length(database_id)=36),
    database_marker TEXT NOT NULL CHECK(length(database_marker)=36),
    admin_session_hash TEXT NOT NULL CHECK(length(admin_session_hash)=64),
    actor_subject TEXT NOT NULL CHECK(length(actor_subject) BETWEEN 1 AND 255),
    reason TEXT NOT NULL CHECK(length(reason) BETWEEN 12 AND 180),
    issued_at_ms INTEGER NOT NULL CHECK(issued_at_ms>0),
    expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms=issued_at_ms+300000),
    revoked_at_ms INTEGER CHECK(revoked_at_ms IS NULL OR revoked_at_ms>=issued_at_ms)
  ) STRICT;
-- next statement
CREATE TABLE m03_local_support_events (
    event_id TEXT PRIMARY KEY,
    grant_operation_id TEXT NOT NULL REFERENCES m03_local_support_grants(operation_id),
    event_type TEXT NOT NULL CHECK(event_type IN ('START','READ','END')),
    shop_id TEXT NOT NULL,
    actor_subject TEXT NOT NULL,
    event_at_ms INTEGER NOT NULL CHECK(event_at_ms>0)
  ) STRICT;
-- next statement
CREATE TRIGGER m03_local_support_start
    AFTER INSERT ON m03_local_support_grants
    BEGIN
      INSERT INTO m03_local_support_events
        (event_id,grant_operation_id,event_type,shop_id,actor_subject,event_at_ms)
      VALUES (NEW.operation_id||':START',NEW.operation_id,'START',NEW.shop_id,NEW.actor_subject,NEW.issued_at_ms);
    END;
-- next statement
CREATE TRIGGER m03_local_support_revoke
    AFTER UPDATE OF revoked_at_ms ON m03_local_support_grants
    WHEN OLD.revoked_at_ms IS NULL AND NEW.revoked_at_ms IS NOT NULL
    BEGIN
      INSERT INTO m03_local_support_events
        (event_id,grant_operation_id,event_type,shop_id,actor_subject,event_at_ms)
      VALUES (NEW.operation_id||':END',NEW.operation_id,'END',NEW.shop_id,NEW.actor_subject,NEW.revoked_at_ms);
    END;
-- next statement
CREATE TRIGGER m03_local_support_grant_immutable
    BEFORE UPDATE ON m03_local_support_grants
    WHEN OLD.revoked_at_ms IS NOT NULL OR NEW.revoked_at_ms IS NULL
      OR NEW.revoked_at_ms<OLD.issued_at_ms
      OR NEW.operation_id IS NOT OLD.operation_id
      OR NEW.token_hash IS NOT OLD.token_hash
      OR NEW.shop_id IS NOT OLD.shop_id
      OR NEW.database_id IS NOT OLD.database_id
      OR NEW.database_marker IS NOT OLD.database_marker
      OR NEW.admin_session_hash IS NOT OLD.admin_session_hash
      OR NEW.actor_subject IS NOT OLD.actor_subject
      OR NEW.reason IS NOT OLD.reason
      OR NEW.issued_at_ms IS NOT OLD.issued_at_ms
      OR NEW.expires_at_ms IS NOT OLD.expires_at_ms
    BEGIN SELECT RAISE(ABORT,'immutable support grant'); END;
-- next statement
CREATE TRIGGER m03_local_support_grant_no_delete
    BEFORE DELETE ON m03_local_support_grants
    BEGIN SELECT RAISE(ABORT,'immutable support grant'); END;
-- next statement
CREATE TRIGGER m03_local_support_event_no_update
    BEFORE UPDATE ON m03_local_support_events
    BEGIN SELECT RAISE(ABORT,'immutable support audit'); END;
-- next statement
CREATE TRIGGER m03_local_support_event_no_delete
    BEFORE DELETE ON m03_local_support_events
    BEGIN SELECT RAISE(ABORT,'immutable support audit'); END;
-- next statement
CREATE INDEX m03_local_support_event_shop_order ON m03_local_support_events(shop_id,event_at_ms,event_id);
