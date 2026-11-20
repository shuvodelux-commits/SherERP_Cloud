CREATE TABLE platform_browser_first_factor (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1)
    REFERENCES platform_admin_auth(singleton),
  encrypted_secret TEXT NOT NULL
) STRICT;
-- next statement
CREATE TABLE platform_browser_setup (
  token_hash TEXT PRIMARY KEY,
  nonce TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  subject TEXT,
  encrypted_secret TEXT,
  expires_at_ms INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5)
) STRICT;
