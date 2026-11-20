-- Additive local Owner-ready Shop lease. Historical grants remain NULL and fail closed.
-- Apply after 0002 and 0003; no remote migration is authorized by this file.
ALTER TABLE shop_owner_write_grant ADD COLUMN expires_at_ms INTEGER
  CHECK (expires_at_ms IS NULL OR (expires_at_ms > 0 AND expires_at_ms <= 9007199254740991));
-- next statement
CREATE TRIGGER shop_owner_write_grant_lease_no_extension
BEFORE UPDATE OF expires_at_ms,generation ON shop_owner_write_grant
WHEN NEW.generation=OLD.generation AND
  ((OLD.expires_at_ms IS NULL AND NEW.expires_at_ms IS NOT NULL)
   OR NEW.expires_at_ms>OLD.expires_at_ms)
BEGIN
  SELECT RAISE(ABORT,'Owner write grant lease cannot extend within one generation');
END;
