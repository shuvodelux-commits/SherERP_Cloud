CREATE TABLE fixture_shops (
  shop_id TEXT PRIMARY KEY NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  inviter_subject TEXT NOT NULL,
  invite_hash TEXT NOT NULL UNIQUE CHECK(length(invite_hash)=64),
  recipient_issuer TEXT NOT NULL CHECK(recipient_issuer='https://accounts.google.com'),
  recipient_subject TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  database_marker TEXT NOT NULL UNIQUE CHECK(length(database_marker)=36),
  ready INTEGER NOT NULL DEFAULT 0 CHECK(ready IN (0,1))
) STRICT;
-- next statement
CREATE TABLE fixture_shop_memberships (
  shop_id TEXT PRIMARY KEY NOT NULL REFERENCES fixture_shops(shop_id),
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role='Owner')
) STRICT;
-- next statement
CREATE TABLE fixture_invite_consumptions (
  invite_hash TEXT PRIMARY KEY NOT NULL REFERENCES fixture_shops(invite_hash),
  consumed_at_ms INTEGER NOT NULL
) STRICT;
-- next statement
CREATE TRIGGER fixture_record_invite_consumption AFTER INSERT ON fixture_shop_memberships
BEGIN
  INSERT INTO fixture_invite_consumptions(invite_hash,consumed_at_ms)
  SELECT invite_hash,CAST(unixepoch('subsec') * 1000 AS INTEGER)
  FROM fixture_shops WHERE shop_id=NEW.shop_id;
END;
-- next statement
CREATE TRIGGER fixture_invite_consumption_no_replace BEFORE INSERT ON fixture_invite_consumptions
WHEN EXISTS(SELECT 1 FROM fixture_invite_consumptions WHERE invite_hash=NEW.invite_hash)
BEGIN
  SELECT RAISE(ABORT,'invite already consumed');
END;
-- next statement
CREATE TRIGGER fixture_invite_consumption_no_update BEFORE UPDATE ON fixture_invite_consumptions
BEGIN
  SELECT RAISE(ABORT,'invite consumption is immutable');
END;
-- next statement
CREATE TRIGGER fixture_invite_consumption_no_delete BEFORE DELETE ON fixture_invite_consumptions
BEGIN
  SELECT RAISE(ABORT,'invite consumption is immutable');
END;
