CREATE TABLE platform_first_shop_owners (
  shop_id TEXT PRIMARY KEY NOT NULL REFERENCES platform_shop_bindings(shop_id),
  invite_hash TEXT NOT NULL UNIQUE REFERENCES platform_owner_invitations(token_hash),
  issuer TEXT NOT NULL CHECK(issuer='https://accounts.google.com'),
  subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 255),
  accepted_at_ms INTEGER NOT NULL CHECK(accepted_at_ms>0)
) STRICT;
-- next statement
CREATE TRIGGER platform_first_shop_owners_no_replace BEFORE INSERT ON platform_first_shop_owners
WHEN EXISTS(SELECT 1 FROM platform_first_shop_owners WHERE shop_id=NEW.shop_id OR invite_hash=NEW.invite_hash)
BEGIN
  SELECT RAISE(ABORT,'first Owner record is immutable');
END;
-- next statement
CREATE TRIGGER platform_first_shop_owners_no_update BEFORE UPDATE ON platform_first_shop_owners
BEGIN
  SELECT RAISE(ABORT,'first Owner record is immutable');
END;
-- next statement
CREATE TRIGGER platform_first_shop_owners_no_delete BEFORE DELETE ON platform_first_shop_owners
BEGIN
  SELECT RAISE(ABORT,'first Owner record is immutable');
END;
