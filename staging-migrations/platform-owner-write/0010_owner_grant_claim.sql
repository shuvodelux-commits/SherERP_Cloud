-- Install only after 0009. A claim reserves this Control generation before
-- publication to Shop D1. Release it only after a verified durable Shop fence.
CREATE TABLE platform_owner_grant_claim (
  shop_id TEXT PRIMARY KEY REFERENCES platform_shop_owner_sessions(shop_id),
  token_hash TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation BETWEEN 1 AND 9007199254740991)
) STRICT;
-- next statement
CREATE TRIGGER platform_owner_claim_blocks_rotation
BEFORE UPDATE OF token_hash ON platform_shop_owner_sessions
WHEN OLD.token_hash<>NEW.token_hash AND EXISTS(
  SELECT 1 FROM platform_owner_grant_claim WHERE shop_id=OLD.shop_id)
BEGIN
  SELECT RAISE(ABORT,'Fence Owner write grant before replacing session');
END;
-- next statement
CREATE TRIGGER platform_owner_claim_blocks_revocation
BEFORE DELETE ON platform_shop_owner_sessions
WHEN EXISTS(SELECT 1 FROM platform_owner_grant_claim WHERE shop_id=OLD.shop_id)
BEGIN
  SELECT RAISE(ABORT,'Fence Owner write grant before removing access');
END;
-- next statement
CREATE TRIGGER platform_owner_claim_blocks_replace
AFTER INSERT ON platform_shop_owner_sessions
WHEN EXISTS(SELECT 1 FROM platform_owner_grant_claim WHERE shop_id=NEW.shop_id)
BEGIN
  SELECT RAISE(ABORT,'Fence Owner write grant before replacing session');
END;
