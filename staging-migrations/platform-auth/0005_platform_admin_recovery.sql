-- M04: Optional Super Admin recovery. Apply only to backed-up Control D1
-- after an approved release; never to a Shop D1 or public preview.
CREATE TABLE platform_admin_recovery_generation (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1)
    REFERENCES platform_admin_auth(singleton),
  generation INTEGER NOT NULL CHECK(generation>0),
  factor_version INTEGER NOT NULL CHECK(factor_version>0),
  updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms>0)
) STRICT;
-- next statement
CREATE TABLE platform_admin_recovery_codes (
  code_hash TEXT PRIMARY KEY CHECK(length(code_hash)=64 AND code_hash NOT GLOB '*[^0-9a-f]*'),
  singleton INTEGER NOT NULL DEFAULT 1 CHECK(singleton=1)
    REFERENCES platform_admin_auth(singleton),
  generation INTEGER NOT NULL CHECK(generation>0),
  factor_version INTEGER NOT NULL CHECK(factor_version>0),
  issued_at_ms INTEGER NOT NULL CHECK(issued_at_ms>0),
  consumed_at_ms INTEGER CHECK(consumed_at_ms>=issued_at_ms),
  consumed_by_binding TEXT REFERENCES platform_login_attempts(binding_hash),
  CHECK((consumed_at_ms IS NULL)=(consumed_by_binding IS NULL))
) STRICT;
-- next statement
CREATE INDEX platform_admin_recovery_active
ON platform_admin_recovery_codes(singleton,generation,factor_version,consumed_at_ms);
-- next statement
CREATE TABLE platform_admin_recovery_pending (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  binding_hash TEXT NOT NULL UNIQUE REFERENCES platform_login_attempts(binding_hash),
  subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 255),
  encrypted_secret TEXT NOT NULL CHECK(length(encrypted_secret)>32),
  factor_version INTEGER NOT NULL CHECK(factor_version>0),
  issued_at_ms INTEGER NOT NULL CHECK(issued_at_ms>0),
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>issued_at_ms AND expires_at_ms-issued_at_ms<=600000),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5)
) STRICT;
-- next statement
CREATE TABLE platform_admin_recovery_rotation_audit (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 255),
  from_version INTEGER NOT NULL CHECK(from_version>0),
  to_version INTEGER NOT NULL CHECK(to_version=from_version+1),
  rotated_at_ms INTEGER NOT NULL CHECK(rotated_at_ms>0)
) STRICT;
-- next statement
CREATE TRIGGER platform_admin_recovery_rotation_guard
BEFORE INSERT ON platform_admin_recovery_rotation_audit
WHEN NOT EXISTS(
  SELECT 1 FROM platform_admin_recovery_pending p
  JOIN platform_first_superadmin f ON f.subject=p.subject
  JOIN platform_admin_auth a ON a.singleton=1 AND a.enabled=1
  WHERE p.token_hash=NEW.token_hash
    AND p.subject=NEW.subject
    AND p.factor_version=NEW.from_version
    AND a.factor_version=NEW.from_version
    AND p.expires_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)
    AND NEW.to_version=NEW.from_version+1
)
BEGIN SELECT RAISE(ABORT,'recovery authorization expired or changed'); END;
-- next statement
CREATE TRIGGER platform_admin_recovery_codes_no_replace
BEFORE INSERT ON platform_admin_recovery_codes
WHEN EXISTS(SELECT 1 FROM platform_admin_recovery_codes WHERE code_hash=NEW.code_hash)
BEGIN SELECT RAISE(ABORT,'duplicate recovery code'); END;
