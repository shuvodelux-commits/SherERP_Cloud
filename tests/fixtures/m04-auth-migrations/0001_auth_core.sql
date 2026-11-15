-- M04 PROPOSAL: NONDEPLOYABLE LOCAL TEST FIXTURE. NOT A MIGRATION.
-- Exclusive M03 schema owner must review and promote separately.
-- Absolutely no live/legacy SESSIONS token or password values in this file.
CREATE TABLE auth_roles (
  role_name TEXT PRIMARY KEY
    CHECK (length(trim(role_name)) > 0 AND lower(trim(role_name)) <> 'administrator'),
  status TEXT NOT NULL CHECK (status IN ('Active','Inactive')),
  permissions_json TEXT NOT NULL DEFAULT '{}',
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
  status,role_name,password_algo,password_hash,password_salt,
  password_iterations,credential_version ON auth_users
WHEN OLD.status IS NOT NEW.status
  OR OLD.role_name IS NOT NEW.role_name
  OR OLD.password_algo IS NOT NEW.password_algo
  OR OLD.password_hash IS NOT NEW.password_hash
  OR OLD.password_salt IS NOT NEW.password_salt
  OR OLD.password_iterations IS NOT NEW.password_iterations
  OR OLD.credential_version IS NOT NEW.credential_version
BEGIN
  UPDATE auth_users SET auth_version=OLD.auth_version+1 WHERE user_id=NEW.user_id;
END;

CREATE TRIGGER trg_auth_role_version AFTER UPDATE OF
  role_name,status,permissions_json ON auth_roles
WHEN OLD.role_name IS NOT NEW.role_name
  OR OLD.status IS NOT NEW.status
  OR OLD.permissions_json IS NOT NEW.permissions_json
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
