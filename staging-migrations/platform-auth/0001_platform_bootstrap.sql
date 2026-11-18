CREATE TABLE platform_setup_tickets (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  nonce TEXT NOT NULL UNIQUE CHECK(length(nonce)=43),
  issuer TEXT NOT NULL CHECK(issuer='https://accounts.google.com'),
  subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 255),
  issued_at_ms INTEGER NOT NULL CHECK(issued_at_ms>=0),
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>issued_at_ms AND expires_at_ms-issued_at_ms<=600000),
  revoked_at_ms INTEGER CHECK(revoked_at_ms>=issued_at_ms)
) STRICT;
-- next statement
CREATE TABLE platform_first_superadmin (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  issuer TEXT NOT NULL CHECK(issuer='https://accounts.google.com'),
  subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 255),
  setup_token_hash TEXT NOT NULL UNIQUE REFERENCES platform_setup_tickets(token_hash),
  enrolled_at_ms INTEGER NOT NULL CHECK(enrolled_at_ms>=0)
) STRICT;
-- next statement
CREATE TRIGGER platform_first_superadmin_no_replace
BEFORE INSERT ON platform_first_superadmin
WHEN EXISTS(SELECT 1 FROM platform_first_superadmin WHERE singleton=1)
BEGIN
  SELECT RAISE(ABORT,'first platform admin enrollment already recorded');
END;
-- next statement
CREATE TRIGGER platform_first_superadmin_no_update
BEFORE UPDATE ON platform_first_superadmin
BEGIN
  SELECT RAISE(ABORT,'first platform admin enrollment is immutable');
END;
-- next statement
CREATE TRIGGER platform_first_superadmin_no_delete
BEFORE DELETE ON platform_first_superadmin
BEGIN
  SELECT RAISE(ABORT,'first platform admin enrollment is immutable');
END;
