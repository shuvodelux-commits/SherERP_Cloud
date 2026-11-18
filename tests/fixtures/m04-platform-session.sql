CREATE TABLE platform_admin_auth (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1) REFERENCES platform_first_superadmin(singleton),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  factor_version INTEGER NOT NULL CHECK(factor_version>0)
) STRICT;
-- next statement
CREATE TRIGGER platform_admin_auth_monotonic BEFORE UPDATE ON platform_admin_auth
WHEN NEW.factor_version<=OLD.factor_version
  AND (NEW.factor_version<>OLD.factor_version OR NEW.enabled<>OLD.enabled)
BEGIN
  SELECT RAISE(ABORT,'platform auth version must increase');
END;
-- next statement
CREATE TRIGGER platform_admin_auth_no_replace BEFORE INSERT ON platform_admin_auth
WHEN EXISTS(SELECT 1 FROM platform_admin_auth WHERE singleton=1)
BEGIN
  SELECT RAISE(ABORT,'platform auth already exists');
END;
-- next statement
CREATE TRIGGER platform_admin_auth_no_delete BEFORE DELETE ON platform_admin_auth
BEGIN
  SELECT RAISE(ABORT,'platform auth cannot be deleted');
END;
-- next statement
CREATE TABLE platform_login_challenges (
  binding_hash TEXT PRIMARY KEY CHECK(length(binding_hash)=64),
  nonce TEXT NOT NULL UNIQUE CHECK(length(nonce)=43),
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>0)
) STRICT;
-- next statement
CREATE TABLE platform_login_attempts (
  binding_hash TEXT PRIMARY KEY REFERENCES platform_login_challenges(binding_hash),
  attempted_at_ms INTEGER NOT NULL CHECK(attempted_at_ms>0)
) STRICT;
-- next statement
CREATE INDEX platform_login_attempt_time ON platform_login_attempts(attempted_at_ms);
-- next statement
CREATE TABLE platform_admin_sessions (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
  binding_hash TEXT NOT NULL UNIQUE REFERENCES platform_login_attempts(binding_hash),
  singleton INTEGER NOT NULL CHECK(singleton=1) REFERENCES platform_admin_auth(singleton),
  factor_version INTEGER NOT NULL CHECK(factor_version>0),
  otp_step INTEGER NOT NULL UNIQUE CHECK(otp_step>=0),
  issued_at_ms INTEGER NOT NULL CHECK(issued_at_ms>0),
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>issued_at_ms),
  revoked_at_ms INTEGER CHECK(revoked_at_ms>=issued_at_ms)
) STRICT;
