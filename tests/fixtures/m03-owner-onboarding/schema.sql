CREATE TABLE fixture_shops (
  shop_id TEXT PRIMARY KEY NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  inviter_subject TEXT NOT NULL,
  invite_hash TEXT NOT NULL UNIQUE CHECK(length(invite_hash)=64),
  recipient_issuer TEXT NOT NULL CHECK(recipient_issuer='https://accounts.google.com'),
  recipient_subject TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  ready INTEGER NOT NULL DEFAULT 0 CHECK(ready IN (0,1))
) STRICT;
-- next statement
CREATE TABLE fixture_shop_memberships (
  shop_id TEXT PRIMARY KEY NOT NULL REFERENCES fixture_shops(shop_id),
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role='Owner')
) STRICT;
