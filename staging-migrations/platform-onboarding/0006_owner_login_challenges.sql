CREATE TABLE platform_shop_owner_login_challenges (
  challenge_hash TEXT PRIMARY KEY NOT NULL CHECK(length(challenge_hash)=64),
  shop_id TEXT NOT NULL REFERENCES platform_shop_owner_access(shop_id),
  nonce TEXT NOT NULL UNIQUE CHECK(length(nonce)=43),
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>0)
) STRICT;
-- next statement
CREATE INDEX platform_shop_owner_challenge_expiry ON platform_shop_owner_login_challenges(expires_at_ms);
-- next statement
ALTER TABLE platform_shop_owner_sessions ADD COLUMN challenge_hash TEXT CHECK(challenge_hash IS NULL OR length(challenge_hash)=64);
-- next statement
CREATE TRIGGER platform_shop_owner_consume_on_insert AFTER INSERT ON platform_shop_owner_sessions
WHEN NEW.challenge_hash IS NOT NULL
BEGIN
  DELETE FROM platform_shop_owner_login_challenges WHERE challenge_hash=NEW.challenge_hash AND shop_id=NEW.shop_id;
END;
-- next statement
CREATE TRIGGER platform_shop_owner_consume_on_rotation AFTER UPDATE OF challenge_hash ON platform_shop_owner_sessions
WHEN NEW.challenge_hash IS NOT NULL
BEGIN
  DELETE FROM platform_shop_owner_login_challenges WHERE challenge_hash=NEW.challenge_hash AND shop_id=NEW.shop_id;
END;
-- next statement
CREATE TRIGGER platform_shop_owner_cancel_on_disable AFTER UPDATE OF enabled ON platform_shop_owner_access
WHEN NEW.enabled=0
BEGIN
  DELETE FROM platform_shop_owner_login_challenges WHERE shop_id=NEW.shop_id;
END;
