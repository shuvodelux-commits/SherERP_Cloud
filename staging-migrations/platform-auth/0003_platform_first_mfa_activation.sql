-- Control D1 only. Review the target and backup before remote application.
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
-- next statement
CREATE INDEX port_p3_activation_ticket ON port_p3_activation_challenges(ticket_hash);
-- next statement
CREATE TABLE platform_first_mfa_activation_audit (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1) REFERENCES platform_admin_auth(singleton),
  challenge_hash TEXT NOT NULL UNIQUE REFERENCES port_p3_activation_challenges(challenge_hash),
  operator_id TEXT NOT NULL CHECK(length(operator_id) BETWEEN 1 AND 128),
  factor_version INTEGER NOT NULL CHECK(factor_version=1),
  activated_at_ms INTEGER NOT NULL CHECK(activated_at_ms>0)
) STRICT;
-- next statement
CREATE TRIGGER platform_first_mfa_audit_check_insert
BEFORE INSERT ON platform_first_mfa_activation_audit
WHEN EXISTS(SELECT 1 FROM platform_first_mfa_activation_audit)
  OR NOT EXISTS(
    SELECT 1 FROM port_p3_activation_challenges c
    JOIN platform_admin_auth a ON a.singleton=NEW.singleton
    WHERE c.challenge_hash=NEW.challenge_hash AND c.consumed_at_ms=NEW.activated_at_ms
      AND c.revoked_at_ms IS NULL AND a.enabled=1 AND a.factor_version=NEW.factor_version
  )
BEGIN
  SELECT RAISE(ABORT,'invalid or duplicate initial MFA audit record');
END;
-- next statement
CREATE TRIGGER platform_first_mfa_audit_no_update
BEFORE UPDATE ON platform_first_mfa_activation_audit
BEGIN
  SELECT RAISE(ABORT,'initial MFA audit record is immutable');
END;
-- next statement
CREATE TRIGGER platform_first_mfa_audit_no_delete
BEFORE DELETE ON platform_first_mfa_activation_audit
BEGIN
  SELECT RAISE(ABORT,'initial MFA audit record is immutable');
END;
