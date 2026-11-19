CREATE TABLE platform_shop_bindings (
  shop_id TEXT PRIMARY KEY NOT NULL REFERENCES platform_shop_reservations(shop_id),
  database_id TEXT NOT NULL UNIQUE CHECK(length(database_id)=36),
  database_marker TEXT NOT NULL UNIQUE CHECK(length(database_marker)=36),
  verified_by_subject TEXT NOT NULL CHECK(length(verified_by_subject) BETWEEN 1 AND 255),
  verified_at_ms INTEGER NOT NULL CHECK(verified_at_ms>0)
) STRICT;
-- next statement
CREATE TRIGGER platform_shop_bindings_no_replace
BEFORE INSERT ON platform_shop_bindings
WHEN EXISTS(SELECT 1 FROM platform_shop_bindings
  WHERE shop_id=NEW.shop_id OR database_id=NEW.database_id OR database_marker=NEW.database_marker)
BEGIN
  SELECT RAISE(ABORT,'shop binding verification is immutable');
END;
-- next statement
CREATE TRIGGER platform_shop_bindings_no_update
BEFORE UPDATE ON platform_shop_bindings
BEGIN
  SELECT RAISE(ABORT,'shop binding verification is immutable');
END;
-- next statement
CREATE TRIGGER platform_shop_bindings_no_delete
BEFORE DELETE ON platform_shop_bindings
BEGIN
  SELECT RAISE(ABORT,'shop binding verification is immutable');
END;
