-- M04 PROPOSAL: NONDEPLOYABLE LOCAL TEST FIXTURE. NOT A MIGRATION.
-- Exclusive M03 schema owner must review and promote separately.
-- Absolutely no live/legacy SESSIONS token or password values in this file.
CREATE TABLE auth_roles (
  role_name TEXT PRIMARY KEY
    CHECK (length(trim(role_name)) > 0 AND lower(trim(role_name)) <> 'administrator'),
  status TEXT NOT NULL CHECK (status IN ('Active','Inactive')),
  permissions_json TEXT NOT NULL DEFAULT '{}',
  -- Source ROLES[Allowed Modules] display metadata; never an authorization proof.
  allowed_modules TEXT NOT NULL DEFAULT '',
  auth_version INTEGER NOT NULL DEFAULT 1 CHECK (auth_version >= 1)
) STRICT;

CREATE TABLE auth_users (
  user_id TEXT PRIMARY KEY CHECK (length(trim(user_id)) > 0),
  full_name TEXT NOT NULL CHECK (length(trim(full_name)) > 0),
  phone_key TEXT NOT NULL UNIQUE
    CHECK (length(phone_key)=11 AND substr(phone_key,1,2)='01'
      AND substr(phone_key,3,1) BETWEEN '3' AND '9'
      AND phone_key NOT GLOB '*[^0-9]*'),
  role_name TEXT NOT NULL CHECK (length(trim(role_name)) > 0),
  status TEXT NOT NULL CHECK (status IN ('Active','Inactive')),
  -- Imported staff may start locked until first source-hash verification.
  credential_state TEXT NOT NULL DEFAULT 'Modern'
    CHECK (credential_state IN ('Modern','LegacyPending')),
  password_algo TEXT NOT NULL DEFAULT 'pbkdf2-sha256'
    CHECK (password_algo='pbkdf2-sha256'),
  password_hash TEXT NOT NULL
    CHECK (length(password_hash)=64 AND password_hash NOT GLOB '*[^0-9a-f]*'),
  password_salt TEXT NOT NULL
    CHECK (length(password_salt)=48 AND password_salt NOT GLOB '*[^0-9a-f]*'),
  password_iterations INTEGER NOT NULL
    CHECK (password_iterations BETWEEN 210000 AND 1000000),
  credential_version INTEGER NOT NULL DEFAULT 1 CHECK (credential_version>=1),
  auth_version INTEGER NOT NULL DEFAULT 1 CHECK (auth_version >= 1)
) STRICT;

-- Offline import staging only: source SHA256 hashes are NEVER inserted into
-- PBKDF2 verifier columns. Synthetic pending users hold random unknown
-- placeholders; real source hashes stay in this separate guarded table.
CREATE TABLE auth_legacy_credentials (
  user_id TEXT PRIMARY KEY REFERENCES auth_users(user_id) ON DELETE RESTRICT,
  legacy_hash TEXT NOT NULL
    CHECK (length(legacy_hash)=64 AND legacy_hash NOT GLOB '*[^0-9a-f]*'),
  legacy_salt TEXT NOT NULL
    CHECK (length(legacy_salt) BETWEEN 1 AND 128)
) STRICT;

CREATE TRIGGER trg_auth_legacy_insert_guard BEFORE INSERT ON auth_legacy_credentials
WHEN NOT EXISTS (SELECT 1 FROM auth_users u WHERE u.user_id=NEW.user_id
  AND u.credential_state='LegacyPending')
BEGIN
  SELECT RAISE(ABORT,'legacy import requires pending staff identity');
END;

-- Never downgrade a modern account to an imported weak hash, even if a
-- future staff-import or management helper makes a mistake.
CREATE TRIGGER trg_auth_credential_downgrade BEFORE UPDATE OF credential_state ON auth_users
WHEN OLD.credential_state='Modern' AND NEW.credential_state='LegacyPending'
BEGIN
  SELECT RAISE(ABORT,'modern credential downgrade forbidden');
END;

-- The old secret disappears in the SAME D1 write that commits new PBKDF2
-- password data. A losing concurrent CAS cannot delete the legacy verifier.
CREATE TRIGGER trg_auth_legacy_purge AFTER UPDATE OF credential_state ON auth_users
WHEN OLD.credential_state='LegacyPending' AND NEW.credential_state='Modern'
BEGIN
  DELETE FROM auth_legacy_credentials WHERE user_id=NEW.user_id;
END;

-- REPLACE deletes conflicting staff identities without ordinary DELETE
-- triggers in some SQLite configurations. Refuse ID/phone-key collisions
-- *before* any REPLACE delete can bypass last-admin or authority epochs.
-- Standard INSERT already fails its UNIQUE constraint; new staff are allowed.
CREATE TRIGGER trg_auth_staff_identity_no_replace BEFORE INSERT ON auth_users
WHEN EXISTS (SELECT 1 FROM auth_users u
  WHERE u.user_id=NEW.user_id OR u.phone_key=NEW.phone_key)
BEGIN
  SELECT RAISE(ABORT,'staff identity replacement forbidden');
END;

-- Active Administrator accounts are intrinsic, not managed through auth_roles.
-- These triggers enforce "the final active Administrator cannot disappear"
-- under SQLite's serialized writes; a JS preflight count alone never can.
CREATE TRIGGER trg_auth_last_admin_delete BEFORE DELETE ON auth_users
WHEN OLD.role_name='Administrator' AND OLD.status='Active'
 AND (SELECT COUNT(*) FROM auth_users
      WHERE role_name='Administrator' AND status='Active') <= 1
BEGIN
  SELECT RAISE(ABORT,'last active administrator');
END;

CREATE TRIGGER trg_auth_last_admin_update BEFORE UPDATE OF role_name,status ON auth_users
WHEN OLD.role_name='Administrator' AND OLD.status='Active'
 AND (NEW.role_name<>'Administrator' OR NEW.status<>'Active')
 AND (SELECT COUNT(*) FROM auth_users
      WHERE role_name='Administrator' AND status='Active') <= 1
BEGIN
  SELECT RAISE(ABORT,'last active administrator');
END;

-- Trigger-owned authority epochs prevent disabled/re-enabled users or roles
-- from resurrecting sessions created before the change. Nonrecursive because
-- the UPDATE inside each trigger touches only auth_version.
CREATE TRIGGER trg_auth_user_version AFTER UPDATE OF
  status,role_name,credential_state,password_algo,password_hash,password_salt,
  password_iterations,credential_version ON auth_users
WHEN OLD.status IS NOT NEW.status
  OR OLD.role_name IS NOT NEW.role_name
  OR OLD.credential_state IS NOT NEW.credential_state
  OR OLD.password_algo IS NOT NEW.password_algo
  OR OLD.password_hash IS NOT NEW.password_hash
  OR OLD.password_salt IS NOT NEW.password_salt
  OR OLD.password_iterations IS NOT NEW.password_iterations
  OR OLD.credential_version IS NOT NEW.credential_version
BEGIN
  UPDATE auth_users SET auth_version=OLD.auth_version+1 WHERE user_id=NEW.user_id;
END;

CREATE TRIGGER trg_auth_role_version AFTER UPDATE OF
  role_name,status,permissions_json,allowed_modules ON auth_roles
WHEN OLD.role_name IS NOT NEW.role_name
  OR OLD.status IS NOT NEW.status
  OR OLD.permissions_json IS NOT NEW.permissions_json
  OR OLD.allowed_modules IS NOT NEW.allowed_modules
BEGIN
  UPDATE auth_roles SET auth_version=OLD.auth_version+1 WHERE role_name=NEW.role_name;
END;

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY
    CHECK (length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  user_id TEXT NOT NULL REFERENCES auth_users(user_id) ON DELETE RESTRICT,
  user_auth_version INTEGER NOT NULL CHECK (user_auth_version>=1),
  role_auth_version INTEGER CHECK (role_auth_version IS NULL OR role_auth_version>=1),
  credential_version INTEGER NOT NULL CHECK (credential_version>=1),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms>=0),
  last_activity_at_ms INTEGER NOT NULL CHECK (last_activity_at_ms>=created_at_ms),
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms>created_at_ms),
  revoked_at_ms INTEGER CHECK (revoked_at_ms IS NULL OR revoked_at_ms>=created_at_ms)
) STRICT;
CREATE INDEX idx_auth_sessions_by_user ON auth_sessions(user_id,revoked_at_ms);

CREATE TABLE auth_login_throttle (
  login_hash TEXT PRIMARY KEY
    CHECK (length(login_hash)=64 AND login_hash NOT GLOB '*[^0-9a-f]*'),
  failure_count INTEGER NOT NULL CHECK (failure_count BETWEEN 1 AND 5),
  locked_until_ms INTEGER NOT NULL DEFAULT 0 CHECK (locked_until_ms>=0),
  reset_at_ms INTEGER NOT NULL CHECK (reset_at_ms>0)
) STRICT;
