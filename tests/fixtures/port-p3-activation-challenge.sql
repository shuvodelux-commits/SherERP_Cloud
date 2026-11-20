-- TEST ONLY. Not a production or staging migration.
-- The M03 schema owner must separately review a live versioned migration.
CREATE TABLE port_p3_activation_challenges (
  challenge_hash TEXT PRIMARY KEY CHECK(length(challenge_hash)=64 AND challenge_hash NOT GLOB '*[^0-9a-f]*'),
  ticket_hash TEXT NOT NULL REFERENCES platform_setup_tickets(token_hash),
  nonce TEXT NOT NULL UNIQUE CHECK(length(nonce)=43),
  issuer TEXT NOT NULL CHECK(issuer='https://accounts.google.com'),
  subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 255),
  issued_at_ms INTEGER NOT NULL CHECK(issued_at_ms>=0),
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>issued_at_ms AND expires_at_ms-issued_at_ms<=120000),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),
  consumed_at_ms INTEGER CHECK(consumed_at_ms>=issued_at_ms),
  revoked_at_ms INTEGER CHECK(revoked_at_ms>=issued_at_ms)
) STRICT;
