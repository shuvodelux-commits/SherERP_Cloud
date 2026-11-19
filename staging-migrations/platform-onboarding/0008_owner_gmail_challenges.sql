CREATE TABLE platform_owner_gmail_challenges (
  challenge_hash TEXT PRIMARY KEY NOT NULL CHECK(length(challenge_hash)=64),
  shop_id TEXT NOT NULL REFERENCES platform_owner_gmail_approvals(shop_id),
  nonce TEXT NOT NULL UNIQUE CHECK(length(nonce)=43),
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>0)
) STRICT;
-- next statement
CREATE INDEX platform_owner_gmail_challenge_expiry ON platform_owner_gmail_challenges(expires_at_ms);
