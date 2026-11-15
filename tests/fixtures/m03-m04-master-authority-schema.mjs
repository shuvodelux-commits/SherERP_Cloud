/**
 * LOCAL D1 ONLY: extend the synthetic M03 operation with a permanent actor seal.
 * Applied after M04 session fixture and existing M03 atomic master fixture.
 * NOT A DEPLOYABLE MIGRATION. No auth-only bypass for the old test helper.
 */
export const SYNTHETIC_M03_M04_MASTER_AUTH_DDL=Object.freeze([
  "ALTER TABLE synthetic_m03_master_intents ADD COLUMN actor_id TEXT REFERENCES auth_users(user_id)",
  "CREATE TRIGGER synthetic_m03_master_actor_required BEFORE INSERT ON synthetic_m03_master_intents "+
    "WHEN NEW.actor_id IS NULL OR length(trim(NEW.actor_id))=0 "+
    "BEGIN SELECT RAISE(ABORT,'actor-bound Product intent required'); END",
  "CREATE TRIGGER synthetic_m03_master_actor_immutable BEFORE UPDATE OF actor_id "+
    "ON synthetic_m03_master_intents WHEN OLD.actor_id IS NOT NEW.actor_id "+
    "BEGIN SELECT RAISE(ABORT,'immutable Product intent actor'); END"
]);
