CREATE TABLE platform_shop_reservations (
  shop_id TEXT PRIMARY KEY NOT NULL CHECK(length(shop_id)=36),
  operation_id TEXT NOT NULL UNIQUE CHECK(length(operation_id)=36),
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),
  created_by_subject TEXT NOT NULL CHECK(length(created_by_subject) BETWEEN 1 AND 255),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms>0)
) STRICT;
-- next statement
CREATE TRIGGER platform_shop_reservations_no_replace
BEFORE INSERT ON platform_shop_reservations
WHEN EXISTS(SELECT 1 FROM platform_shop_reservations
  WHERE shop_id=NEW.shop_id OR operation_id=NEW.operation_id)
BEGIN
  SELECT RAISE(ABORT,'shop reservation is immutable');
END;
-- next statement
CREATE TRIGGER platform_shop_reservations_no_update
BEFORE UPDATE ON platform_shop_reservations
BEGIN
  SELECT RAISE(ABORT,'shop reservation is immutable');
END;
-- next statement
CREATE TRIGGER platform_shop_reservations_no_delete
BEFORE DELETE ON platform_shop_reservations
BEGIN
  SELECT RAISE(ABORT,'shop reservation is immutable');
END;
