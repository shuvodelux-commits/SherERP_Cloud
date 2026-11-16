-- SherERP M04: additive historical source provenance for migrated staff.
-- Only migrate after trusted source export + M04 source-provenance preflight.
-- Existing D1 staff are preserved; nullable values mean no source provenance.
-- NEVER synthesize the original actor, creation date or last login date.
-- This migration is local-Workerd-tested ONLY. Do not change the remote apply
-- count gate or bind public Worker RPC from this schema change.

ALTER TABLE auth_users ADD COLUMN source_created_by TEXT
  CHECK (source_created_by IS NULL OR length(trim(source_created_by))>0);

ALTER TABLE auth_users ADD COLUMN source_created_at_iso TEXT
  CHECK (source_created_at_iso IS NULL OR
    (length(source_created_at_iso)=24 AND
     strftime('%Y-%m-%dT%H:%M:%fZ',source_created_at_iso)=source_created_at_iso));

-- A never-logged-in user has source Last Login='' rather than NULL.
-- NULL remains reserved for D1-native or unprovenanced records.
ALTER TABLE auth_users ADD COLUMN source_last_login_iso TEXT
  CHECK (source_last_login_iso IS NULL OR source_last_login_iso='' OR
    (length(source_last_login_iso)=24 AND
     strftime('%Y-%m-%dT%H:%M:%fZ',source_last_login_iso)=source_last_login_iso));

ALTER TABLE auth_roles ADD COLUMN source_created_at_iso TEXT
  CHECK (source_created_at_iso IS NULL OR
    (length(source_created_at_iso)=24 AND
     strftime('%Y-%m-%dT%H:%M:%fZ',source_created_at_iso)=source_created_at_iso));

-- A source timestamp or source creator becomes immutable once recorded.
-- A NULL provenance slot may be populated only by a separately reviewed,
-- trusted source importer (not by any currently deployed/public RPC).
-- SQL UPDATE OF allows unrelated staff status/password/role edits as before.
CREATE TRIGGER trg_auth_user_provenance_immutable
BEFORE UPDATE OF source_created_by,source_created_at_iso,source_last_login_iso
ON auth_users
WHEN (OLD.source_created_by IS NOT NULL
      AND NEW.source_created_by IS NOT OLD.source_created_by)
   OR (OLD.source_created_at_iso IS NOT NULL
      AND NEW.source_created_at_iso IS NOT OLD.source_created_at_iso)
   OR (OLD.source_last_login_iso IS NOT NULL
      AND NEW.source_last_login_iso IS NOT OLD.source_last_login_iso)
BEGIN
  SELECT RAISE(ABORT,'staff source provenance immutable');
END;

CREATE TRIGGER trg_auth_role_provenance_immutable
BEFORE UPDATE OF source_created_at_iso ON auth_roles
WHEN OLD.source_created_at_iso IS NOT NULL
 AND NEW.source_created_at_iso IS NOT OLD.source_created_at_iso
BEGIN
  SELECT RAISE(ABORT,'role source provenance immutable');
END;
