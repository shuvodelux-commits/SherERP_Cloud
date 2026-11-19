CREATE TABLE platform_owner_invitations (
  token_hash TEXT PRIMARY KEY NOT NULL CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  shop_id TEXT NOT NULL REFERENCES platform_shop_bindings(shop_id),
  recipient_issuer TEXT NOT NULL CHECK(recipient_issuer='https://accounts.google.com'),
  recipient_subject TEXT NOT NULL CHECK(length(recipient_subject) BETWEEN 1 AND 255),
  issued_by_subject TEXT NOT NULL CHECK(length(issued_by_subject) BETWEEN 1 AND 255),
  issued_at_ms INTEGER NOT NULL CHECK(issued_at_ms>0),
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>issued_at_ms AND expires_at_ms-issued_at_ms<=600000)
) STRICT;
-- next statement
CREATE INDEX platform_owner_invites_by_shop_expiry ON platform_owner_invitations(shop_id,expires_at_ms);
-- next statement
CREATE TRIGGER platform_owner_invitations_no_replace BEFORE INSERT ON platform_owner_invitations
WHEN EXISTS(SELECT 1 FROM platform_owner_invitations WHERE token_hash=NEW.token_hash)
BEGIN
  SELECT RAISE(ABORT,'Owner invitation is immutable');
END;
-- next statement
CREATE TRIGGER platform_owner_invitations_no_update BEFORE UPDATE ON platform_owner_invitations
BEGIN
  SELECT RAISE(ABORT,'Owner invitation is immutable');
END;
-- next statement
CREATE TRIGGER platform_owner_invitations_no_delete BEFORE DELETE ON platform_owner_invitations
BEGIN
  SELECT RAISE(ABORT,'Owner invitation is immutable');
END;
