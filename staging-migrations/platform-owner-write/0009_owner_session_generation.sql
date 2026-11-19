-- Isolated Control D1 candidate. Apply after platform-onboarding 0001–0008.
-- Existing sessions receive no generation until explicitly replaced or revoked.
CREATE TABLE platform_owner_session_generation (
  shop_id TEXT PRIMARY KEY NOT NULL REFERENCES platform_shop_owner_access(shop_id),
  generation INTEGER NOT NULL CHECK(generation BETWEEN 1 AND 9007199254740991)
) STRICT;
-- next statement
CREATE TRIGGER platform_owner_generation_on_session_insert
AFTER INSERT ON platform_shop_owner_sessions
BEGIN
  INSERT INTO platform_owner_session_generation(shop_id,generation) VALUES(NEW.shop_id,1)
  ON CONFLICT(shop_id) DO UPDATE SET generation=generation+1;
END;
-- next statement
CREATE TRIGGER platform_owner_generation_on_session_rotation
AFTER UPDATE OF token_hash ON platform_shop_owner_sessions
WHEN NEW.token_hash<>OLD.token_hash
BEGIN
  INSERT INTO platform_owner_session_generation(shop_id,generation) VALUES(NEW.shop_id,1)
  ON CONFLICT(shop_id) DO UPDATE SET generation=generation+1;
END;
-- next statement
CREATE TRIGGER platform_owner_generation_on_session_delete
AFTER DELETE ON platform_shop_owner_sessions
BEGIN
  INSERT INTO platform_owner_session_generation(shop_id,generation) VALUES(OLD.shop_id,1)
  ON CONFLICT(shop_id) DO UPDATE SET generation=generation+1;
END;
