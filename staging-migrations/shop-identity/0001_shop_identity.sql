CREATE TABLE shop_identity (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  shop_id TEXT NOT NULL CHECK(length(shop_id)=36),
  database_id TEXT NOT NULL CHECK(length(database_id)=36),
  database_marker TEXT NOT NULL CHECK(length(database_marker)=36)
) STRICT;
-- next statement
CREATE TRIGGER shop_identity_no_replace
BEFORE INSERT ON shop_identity WHEN EXISTS(SELECT 1 FROM shop_identity)
BEGIN
  SELECT RAISE(ABORT,'shop identity is immutable');
END;
-- next statement
CREATE TRIGGER shop_identity_no_update BEFORE UPDATE ON shop_identity
BEGIN
  SELECT RAISE(ABORT,'shop identity is immutable');
END;
-- next statement
CREATE TRIGGER shop_identity_no_delete BEFORE DELETE ON shop_identity
BEGIN
  SELECT RAISE(ABORT,'shop identity is immutable');
END;
