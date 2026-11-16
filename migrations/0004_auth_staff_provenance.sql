-- SherERP M04 source provenance: additive, local-only D1 schema proposal.
-- Frozen Mohim_ERP USERS: User ID, Created By, Created At, Last Login.
-- Frozen Mohim_ERP ROLES: Role ID, Created At.
-- DO NOT remotely apply without owner-approved protected export/cutover.
-- The original instant is stored as canonical UTC ISO milliseconds. Never
-- guess Excel/Sheets serial dates, resolve Created By to a Party, or silently
-- overwrite source values when current operational auth data changes.
-- Importers must attach a provenance row to each imported user/role in the
-- SAME authorized atomic D1 batch; existing pre-import users may lack it.

CREATE TABLE auth_user_source_provenance (
  user_id TEXT PRIMARY KEY
    REFERENCES auth_users(user_id) ON DELETE RESTRICT,
  source_created_by TEXT NOT NULL
    CHECK (length(source_created_by)<=1024),
  source_created_at_iso TEXT NOT NULL
    CHECK (length(source_created_at_iso)=24
      AND strftime('%Y-%m-%dT%H:%M:%fZ',source_created_at_iso) IS NOT NULL
      AND strftime('%Y-%m-%dT%H:%M:%fZ',source_created_at_iso)
          =source_created_at_iso),
  source_last_login_at_iso TEXT
    CHECK (source_last_login_at_iso IS NULL OR
      (length(source_last_login_at_iso)=24
       AND strftime('%Y-%m-%dT%H:%M:%fZ',source_last_login_at_iso) IS NOT NULL
       AND strftime('%Y-%m-%dT%H:%M:%fZ',source_last_login_at_iso)
           =source_last_login_at_iso))
) STRICT;

CREATE TABLE auth_role_source_provenance (
  source_role_id TEXT PRIMARY KEY
    REFERENCES auth_roles(source_role_id) ON DELETE RESTRICT,
  source_created_at_iso TEXT NOT NULL
    CHECK (length(source_created_at_iso)=24
      AND strftime('%Y-%m-%dT%H:%M:%fZ',source_created_at_iso) IS NOT NULL
      AND strftime('%Y-%m-%dT%H:%M:%fZ',source_created_at_iso)
          =source_created_at_iso)
) STRICT;

-- INSERT OR REPLACE is never a legitimate way to change historical source
-- evidence. Reject the conflict before SQLite can implicitly delete a row.
CREATE TRIGGER trg_auth_user_provenance_no_replace
BEFORE INSERT ON auth_user_source_provenance
WHEN EXISTS (
  SELECT 1 FROM auth_user_source_provenance p WHERE p.user_id=NEW.user_id
)
BEGIN
  SELECT RAISE(ABORT,'source staff provenance replacement forbidden');
END;

CREATE TRIGGER trg_auth_user_provenance_no_update
BEFORE UPDATE ON auth_user_source_provenance
BEGIN
  SELECT RAISE(ABORT,'source staff provenance immutable');
END;

CREATE TRIGGER trg_auth_user_provenance_no_delete
BEFORE DELETE ON auth_user_source_provenance
BEGIN
  SELECT RAISE(ABORT,'source staff provenance deletion forbidden');
END;

CREATE TRIGGER trg_auth_role_provenance_no_replace
BEFORE INSERT ON auth_role_source_provenance
WHEN EXISTS (
  SELECT 1 FROM auth_role_source_provenance p
  WHERE p.source_role_id=NEW.source_role_id
)
BEGIN
  SELECT RAISE(ABORT,'source role provenance replacement forbidden');
END;

CREATE TRIGGER trg_auth_role_provenance_no_update
BEFORE UPDATE ON auth_role_source_provenance
BEGIN
  SELECT RAISE(ABORT,'source role provenance immutable');
END;

CREATE TRIGGER trg_auth_role_provenance_no_delete
BEFORE DELETE ON auth_role_source_provenance
BEGIN
  SELECT RAISE(ABORT,'source role provenance deletion forbidden');
END;
