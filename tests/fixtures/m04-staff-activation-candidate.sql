-- M04 TEST-ONLY contract candidate. Not a production D1 migration.
-- M03 must approve the final Shop schema, identity/provenance and release gate.
CREATE TABLE auth_staff_activation_tickets (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  shop_id TEXT NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES auth_users(user_id) ON DELETE RESTRICT,
  issuer_user_id TEXT NOT NULL REFERENCES auth_users(user_id) ON DELETE RESTRICT,
  issuer_auth_version INTEGER NOT NULL CHECK(issuer_auth_version>=1),
  target_auth_version INTEGER NOT NULL CHECK(target_auth_version>=1),
  target_credential_version INTEGER NOT NULL CHECK(target_credential_version>=1),
  role_name TEXT NOT NULL,
  role_auth_version INTEGER NOT NULL CHECK(role_auth_version>=1),
  issued_at_ms INTEGER NOT NULL CHECK(issued_at_ms>0),
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>issued_at_ms AND expires_at_ms-issued_at_ms<=900000),
  consumed_at_ms INTEGER CHECK(consumed_at_ms IS NULL OR consumed_at_ms>=issued_at_ms),
  consumed_nonce TEXT UNIQUE CHECK(consumed_nonce IS NULL OR (length(consumed_nonce)=64 AND consumed_nonce NOT GLOB '*[^0-9a-f]*')),
  CHECK((consumed_at_ms IS NULL)=(consumed_nonce IS NULL))
) STRICT;
