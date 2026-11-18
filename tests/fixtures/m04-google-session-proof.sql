-- Local test fixture, outside the deployable migrations directory.
CREATE TABLE auth_google_links (
  issuer TEXT NOT NULL CHECK (issuer='https://accounts.google.com'),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
  user_id TEXT NOT NULL UNIQUE REFERENCES auth_users(user_id) ON DELETE RESTRICT,
  revoked_at_ms INTEGER,
  PRIMARY KEY (issuer,subject)
) STRICT;
-- next statement
CREATE TABLE auth_google_challenges (
  binding_hash TEXT PRIMARY KEY,
  nonce TEXT NOT NULL UNIQUE,
  expires_at_ms INTEGER NOT NULL
) STRICT;
-- next statement
CREATE TABLE auth_google_sessions (
  token_hash TEXT PRIMARY KEY,
  binding_hash TEXT NOT NULL UNIQUE REFERENCES auth_google_challenges(binding_hash) ON DELETE RESTRICT,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES auth_users(user_id) ON DELETE RESTRICT,
  user_auth_version INTEGER NOT NULL,
  credential_version INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms>created_at_ms),
  revoked_at_ms INTEGER CHECK (revoked_at_ms>=created_at_ms),
  FOREIGN KEY (issuer,subject) REFERENCES auth_google_links(issuer,subject) ON DELETE RESTRICT
) STRICT;
-- next statement
CREATE TRIGGER google_link_seal BEFORE UPDATE ON auth_google_links
WHEN OLD.issuer IS NOT NEW.issuer OR OLD.subject IS NOT NEW.subject
  OR OLD.user_id IS NOT NEW.user_id OR OLD.revoked_at_ms IS NOT NULL
  OR NEW.revoked_at_ms IS NULL
BEGIN
  SELECT RAISE(ABORT,'Google link is immutable after creation except first revocation');
END;
-- next statement
CREATE TRIGGER google_link_no_delete BEFORE DELETE ON auth_google_links
BEGIN
  SELECT RAISE(ABORT,'Google link revocation evidence cannot be deleted');
END;
-- next statement
CREATE TRIGGER google_link_no_replace BEFORE INSERT ON auth_google_links
WHEN EXISTS(SELECT 1 FROM auth_google_links
  WHERE (issuer=NEW.issuer AND subject=NEW.subject) OR user_id=NEW.user_id)
BEGIN
  SELECT RAISE(ABORT,'Google link replacement forbidden');
END;
-- next statement
CREATE TRIGGER google_session_seal BEFORE UPDATE ON auth_google_sessions
WHEN OLD.token_hash IS NOT NEW.token_hash OR OLD.binding_hash IS NOT NEW.binding_hash
  OR OLD.issuer IS NOT NEW.issuer OR OLD.subject IS NOT NEW.subject
  OR OLD.user_id IS NOT NEW.user_id OR OLD.user_auth_version IS NOT NEW.user_auth_version
  OR OLD.credential_version IS NOT NEW.credential_version
  OR OLD.created_at_ms IS NOT NEW.created_at_ms OR OLD.expires_at_ms IS NOT NEW.expires_at_ms
  OR OLD.revoked_at_ms IS NOT NULL OR NEW.revoked_at_ms IS NULL
BEGIN
  SELECT RAISE(ABORT,'Google session is immutable after creation except first revocation');
END;
-- next statement
CREATE TRIGGER google_session_no_delete BEFORE DELETE ON auth_google_sessions
BEGIN
  SELECT RAISE(ABORT,'Spent Google challenge and session evidence cannot be deleted');
END;
-- next statement
CREATE TRIGGER google_session_no_replace BEFORE INSERT ON auth_google_sessions
WHEN EXISTS(SELECT 1 FROM auth_google_sessions
  WHERE token_hash=NEW.token_hash OR binding_hash=NEW.binding_hash)
BEGIN
  SELECT RAISE(ABORT,'Google session replacement forbidden');
END;
