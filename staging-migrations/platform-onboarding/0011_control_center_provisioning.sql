CREATE TABLE platform_shop_provisioning (
  shop_id TEXT PRIMARY KEY REFERENCES platform_shop_reservations(shop_id),
  owner_email TEXT NOT NULL CHECK(length(owner_email) BETWEEN 11 AND 74 AND owner_email=lower(owner_email) AND owner_email LIKE '%@gmail.com'),
  database_marker TEXT NOT NULL UNIQUE CHECK(length(database_marker)=36),
  stage TEXT NOT NULL CHECK(stage IN ('reserved','allocating','allocated','ready')),
  database_id TEXT UNIQUE CHECK(database_id IS NULL OR length(database_id)=36),
  binding_key TEXT UNIQUE,
  allocation_evidence TEXT,
  failed_stage TEXT CHECK(failed_stage IS NULL OR failed_stage IN ('database-creation','binding-verification','schema-migrations','owner-readiness')),
  CHECK ((stage IN ('allocated','ready'))=(database_id IS NOT NULL)),
  CHECK ((database_id IS NULL)=(binding_key IS NULL) AND (database_id IS NULL)=(allocation_evidence IS NULL)),
  CHECK (stage<>'ready' OR failed_stage IS NULL)
) STRICT;
-- next statement
CREATE TRIGGER platform_shop_provisioning_no_replace
BEFORE INSERT ON platform_shop_provisioning
WHEN EXISTS(SELECT 1 FROM platform_shop_provisioning
  WHERE shop_id=NEW.shop_id OR database_marker=NEW.database_marker
    OR database_id=NEW.database_id OR binding_key=NEW.binding_key)
BEGIN SELECT RAISE(ABORT,'provisioning intent or receipt already exists'); END;
-- next statement
CREATE TRIGGER platform_shop_provisioning_immutable
BEFORE UPDATE ON platform_shop_provisioning
WHEN NEW.shop_id<>OLD.shop_id OR NEW.owner_email<>OLD.owner_email OR NEW.database_marker<>OLD.database_marker
  OR (OLD.database_id IS NOT NULL AND (
    NEW.database_id IS NOT OLD.database_id OR NEW.binding_key IS NOT OLD.binding_key
    OR NEW.allocation_evidence IS NOT OLD.allocation_evidence
  )) OR OLD.stage='ready'
BEGIN SELECT RAISE(ABORT,'provisioning intent or receipt is immutable'); END;
-- next statement
CREATE TRIGGER platform_shop_provisioning_no_delete
BEFORE DELETE ON platform_shop_provisioning
BEGIN SELECT RAISE(ABORT,'provisioning history is immutable'); END;
-- next statement
CREATE TRIGGER platform_shop_provisioning_ready
AFTER UPDATE OF stage ON platform_shop_provisioning
WHEN NEW.stage='ready'
BEGIN
  INSERT INTO platform_shop_bindings (shop_id,database_id,database_marker,verified_by_subject,verified_at_ms)
  SELECT NEW.shop_id,NEW.database_id,NEW.database_marker,created_by_subject,CAST(unixepoch('subsec')*1000 AS INTEGER)
  FROM platform_shop_reservations WHERE shop_id=NEW.shop_id;
  INSERT INTO platform_owner_gmail_approvals (shop_id,email,approved_by_subject,approved_at_ms)
  SELECT NEW.shop_id,NEW.owner_email,created_by_subject,CAST(unixepoch('subsec')*1000 AS INTEGER)
  FROM platform_shop_reservations WHERE shop_id=NEW.shop_id;
  SELECT RAISE(ABORT,'provisioning approval incomplete') WHERE NOT EXISTS(
    SELECT 1 FROM platform_shop_bindings b JOIN platform_owner_gmail_approvals a ON a.shop_id=b.shop_id
    WHERE b.shop_id=NEW.shop_id AND b.database_id=NEW.database_id
      AND b.database_marker=NEW.database_marker AND a.email=NEW.owner_email
  );
END;
