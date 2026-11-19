-- Apply only to a verified Shop D1 after its shop_identity row is established.
CREATE TABLE shop_owner_write_grant (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1)
    REFERENCES shop_identity(singleton) ON DELETE RESTRICT,
  token_hash TEXT,
  generation INTEGER NOT NULL CHECK(generation BETWEEN 0 AND 9007199254740991),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  CHECK ((generation=0 AND token_hash IS NULL AND enabled=0) OR
    (generation>0 AND token_hash IS NOT NULL AND length(token_hash)=64
      AND token_hash NOT GLOB '*[^0-9a-f]*'))
) STRICT;
-- next statement
INSERT INTO shop_owner_write_grant(singleton,token_hash,generation,enabled) VALUES (1,NULL,0,0);
-- next statement
CREATE TRIGGER shop_owner_write_grant_no_replace
BEFORE INSERT ON shop_owner_write_grant WHEN EXISTS(SELECT 1 FROM shop_owner_write_grant)
BEGIN
  SELECT RAISE(ABORT,'Owner write grant cannot be replaced');
END;
-- next statement
CREATE TRIGGER shop_owner_write_grant_no_delete
BEFORE DELETE ON shop_owner_write_grant
BEGIN
  SELECT RAISE(ABORT,'Owner write grant must retain its generation');
END;
-- next statement
CREATE TRIGGER shop_owner_write_grant_transition
BEFORE UPDATE ON shop_owner_write_grant
WHEN NEW.singleton<>OLD.singleton OR NEW.generation<OLD.generation
  OR (NEW.generation=OLD.generation AND
    (NEW.token_hash IS NOT OLD.token_hash OR NEW.enabled>OLD.enabled))
  OR (NEW.generation>OLD.generation AND NEW.token_hash IS OLD.token_hash)
BEGIN
  SELECT RAISE(ABORT,'Owner write grant transition refused');
END;
