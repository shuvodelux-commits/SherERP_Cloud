/**
 * NONDEPLOYABLE local D1 overlay: real proposed M04 auth tables are applied
 * separately, and the merged M03 synthetic master trigger is unchanged.
 * Actor is a required persistent receipt identity, sourced inside the
 * authorized INSERT SELECT. The unguarded M03 writer has no actor and fails.
 */
import {SYNTHETIC_M03_MASTER_ATOMIC_DDL} from './m03-master-atomic-schema.mjs';

export const SYNTHETIC_M03_M04_AUTHORIZED_MASTER_DDL=Object.freeze([
  ...SYNTHETIC_M03_MASTER_ATOMIC_DDL,
  "ALTER TABLE synthetic_m03_master_intents ADD COLUMN actor_id TEXT",
  "CREATE TRIGGER synthetic_m03_master_actor_required BEFORE INSERT "+
    "ON synthetic_m03_master_intents "+
    "WHEN NEW.actor_id IS NULL OR length(trim(NEW.actor_id))=0 "+
    "BEGIN SELECT RAISE(ABORT,'M04 master actor required'); END",
  "CREATE TRIGGER synthetic_m03_master_actor_identity_seal BEFORE UPDATE OF actor_id "+
    "ON synthetic_m03_master_intents "+
    "WHEN OLD.actor_id IS NOT NEW.actor_id "+
    "BEGIN SELECT RAISE(ABORT,'immutable M04 master actor'); END"
]);
