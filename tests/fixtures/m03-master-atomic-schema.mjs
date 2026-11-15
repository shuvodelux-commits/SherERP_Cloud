/**
 * NONDEPLOYABLE local-only M03 schema proof. NEVER run against staging/production.
 * Catalog snapshot CAS + cleanup/compaction + source ID receipt + insert are
 * nested within one INSERT statement's SQLite trigger transaction.
 */
import {SYNTHETIC_M03_ID_DDL} from './m03-id-issuer-schema.mjs';

const INTENT="CREATE TABLE synthetic_m03_master_intents ("+
  "tenant_id TEXT NOT NULL,id_key TEXT NOT NULL,operation_id TEXT NOT NULL,"+
  "intent_hash TEXT NOT NULL,name TEXT NOT NULL,snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),"+
  "cleanup_json TEXT NOT NULL CHECK(json_valid(cleanup_json)),created_at TEXT NOT NULL,"+
  "result_id TEXT, PRIMARY KEY (tenant_id,id_key,operation_id)) STRICT";

function createTrigger(table,key,id,name){
  const prefix=key==='PRODUCT_CATEGORIES'?'cat':'unit';
  return "CREATE TRIGGER synthetic_m03_create_"+prefix+" AFTER INSERT ON synthetic_m03_master_intents "+
    "WHEN NEW.id_key='"+key+"' BEGIN "+
    "SELECT CASE WHEN "+
      "(SELECT COUNT(*) FROM "+table+") != json_array_length(NEW.snapshot_json) OR "+
      "EXISTS (SELECT 1 FROM "+table+" AS current WHERE NOT EXISTS ("+
        "SELECT 1 FROM json_each(NEW.snapshot_json) AS expected WHERE "+
          "json_extract(expected.value,'$[0]') IS current.legacy_sheet_row AND "+
          "json_extract(expected.value,'$[1]') IS current."+id+" AND "+
          "json_extract(expected.value,'$[2]') IS current."+name+" AND "+
          "json_extract(expected.value,'$[3]') IS current.status AND "+
          "json_extract(expected.value,'$[4]') IS COALESCE(current.created_at,''))) "+
      "THEN RAISE(ABORT,'stale master catalog snapshot') END; "+
    "DELETE FROM "+table+" WHERE "+id+" IN (SELECT value FROM json_each(NEW.cleanup_json)); "+
    "SELECT CASE WHEN changes()!=json_array_length(NEW.cleanup_json) "+
      "THEN RAISE(ABORT,'master cleanup count mismatch') END; "+
    "UPDATE "+table+" SET legacy_sheet_row=legacy_sheet_row+1002 "+
      "WHERE json_array_length(NEW.cleanup_json)>0; "+
    "UPDATE "+table+" SET legacy_sheet_row=1+("+
      "SELECT COUNT(*) FROM json_each(NEW.snapshot_json) AS prior "+
      "WHERE CAST(json_extract(prior.value,'$[0]') AS INTEGER)<=("+table+".legacy_sheet_row-1002) "+
        "AND NOT EXISTS (SELECT 1 FROM json_each(NEW.cleanup_json) AS removed "+
          "WHERE removed.value=json_extract(prior.value,'$[1]'))) "+
      "WHERE legacy_sheet_row>1002; "+
    "INSERT INTO synthetic_m03_id_receipts(tenant_id,id_key,operation_id,intent_hash) "+
      "VALUES(NEW.tenant_id,NEW.id_key,NEW.operation_id,NEW.intent_hash); "+
    "INSERT INTO "+table+"(legacy_sheet_row,"+id+","+name+",status,created_at) "+
      "SELECT COALESCE((SELECT MAX(legacy_sheet_row) FROM "+table+"),1)+1, "+
        "counter.prefix||'-'||printf('%06d',receipt.issued_sequence),"+
        "NEW.name,'Active',NEW.created_at "+
      "FROM synthetic_m03_id_receipts AS receipt "+
      "JOIN synthetic_m03_id_counters AS counter ON "+
        "counter.tenant_id=receipt.tenant_id AND counter.id_key=receipt.id_key "+
      "WHERE receipt.tenant_id=NEW.tenant_id AND receipt.id_key=NEW.id_key "+
        "AND receipt.operation_id=NEW.operation_id AND receipt.intent_hash=NEW.intent_hash "+
        "AND (SELECT COUNT(*) FROM "+table+")<1000; "+
    "SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'master append failed') END; "+
    "UPDATE synthetic_m03_master_intents SET result_id=("+
      "SELECT counter.prefix||'-'||printf('%06d',receipt.issued_sequence) "+
      "FROM synthetic_m03_id_receipts AS receipt JOIN synthetic_m03_id_counters AS counter "+
      "ON counter.tenant_id=receipt.tenant_id AND counter.id_key=receipt.id_key "+
      "WHERE receipt.tenant_id=NEW.tenant_id AND receipt.id_key=NEW.id_key "+
      "AND receipt.operation_id=NEW.operation_id) "+
      "WHERE tenant_id=NEW.tenant_id AND id_key=NEW.id_key "+
      "AND operation_id=NEW.operation_id AND result_id IS NULL; "+
    "SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'master intent stamp failed') END; "+
  "END";
}
export const SYNTHETIC_M03_MASTER_ATOMIC_DDL=Object.freeze([
  ...SYNTHETIC_M03_ID_DDL,
  INTENT,
  "CREATE TRIGGER synthetic_m03_master_intent_immutable BEFORE UPDATE ON synthetic_m03_master_intents "+
    "WHEN OLD.result_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'immutable master intent'); END",
  "CREATE TRIGGER synthetic_m03_master_intent_no_delete BEFORE DELETE ON synthetic_m03_master_intents "+
    "BEGIN SELECT RAISE(ABORT,'immutable master intent'); END",
  createTrigger('product_categories','PRODUCT_CATEGORIES','category_id','category_name'),
  createTrigger('product_units','PRODUCT_UNITS','unit_id','unit_name')
]);
