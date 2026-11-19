CREATE TABLE platform_shop_owner_access (
  shop_id TEXT PRIMARY KEY NOT NULL REFERENCES platform_first_shop_owners(shop_id),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1))
) STRICT;
-- next statement
CREATE TABLE platform_shop_owner_sessions (
  shop_id TEXT PRIMARY KEY NOT NULL REFERENCES platform_shop_owner_access(shop_id),
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  issued_at_ms INTEGER NOT NULL CHECK(issued_at_ms>0)
) STRICT;
-- next statement
CREATE TRIGGER platform_shop_owner_access_on_acceptance AFTER INSERT ON platform_first_shop_owners
BEGIN
  INSERT INTO platform_shop_owner_access(shop_id,enabled) VALUES (NEW.shop_id,1);
END;
-- next statement
CREATE TRIGGER platform_shop_owner_access_revoke AFTER UPDATE OF enabled ON platform_shop_owner_access
WHEN NEW.enabled=0
BEGIN
  DELETE FROM platform_shop_owner_sessions WHERE shop_id=NEW.shop_id;
END;
-- next statement
CREATE TRIGGER platform_shop_owner_access_no_replace BEFORE INSERT ON platform_shop_owner_access
WHEN EXISTS(SELECT 1 FROM platform_shop_owner_access WHERE shop_id=NEW.shop_id)
BEGIN
  SELECT RAISE(ABORT,'update existing Owner access explicitly');
END;
-- next statement
CREATE TRIGGER platform_shop_owner_access_no_rekey BEFORE UPDATE OF shop_id ON platform_shop_owner_access
BEGIN
  SELECT RAISE(ABORT,'Owner access shop ID is immutable');
END;
-- next statement
CREATE TRIGGER platform_shop_owner_access_no_delete BEFORE DELETE ON platform_shop_owner_access
BEGIN
  SELECT RAISE(ABORT,'disable Owner access explicitly');
END;
