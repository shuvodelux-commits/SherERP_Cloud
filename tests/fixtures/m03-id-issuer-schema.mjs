/**
 * NONDEPLOYABLE local D1 schema for isolated M03 ID issuance tests.
 * An approved schema/importer review is required before any live use.
 */
export const SYNTHETIC_M03_ID_DDL=Object.freeze([
  "CREATE TABLE synthetic_m03_id_counters ("+
    "tenant_id TEXT NOT NULL,id_key TEXT NOT NULL,prefix TEXT NOT NULL,"+
    "current_sequence INTEGER NOT NULL CHECK (current_sequence BETWEEN 0 AND 9007199254740991),"+
    "PRIMARY KEY (tenant_id,id_key)) STRICT",
  "CREATE TABLE synthetic_m03_id_receipts ("+
    "tenant_id TEXT NOT NULL,id_key TEXT NOT NULL,operation_id TEXT NOT NULL,"+
    "intent_hash TEXT NOT NULL,issued_sequence INTEGER CHECK (issued_sequence IS NULL OR issued_sequence > 0),"+
    "PRIMARY KEY (tenant_id,id_key,operation_id),"+
    "UNIQUE (tenant_id,id_key,issued_sequence),"+
    "FOREIGN KEY (tenant_id,id_key) REFERENCES synthetic_m03_id_counters(tenant_id,id_key)) STRICT",
  "CREATE TRIGGER synthetic_m03_id_issue AFTER INSERT ON synthetic_m03_id_receipts BEGIN "+
    "UPDATE synthetic_m03_id_counters SET current_sequence=current_sequence+1 "+
      "WHERE tenant_id=NEW.tenant_id AND id_key=NEW.id_key AND current_sequence<9007199254740991; "+
    "SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'source ID counter missing or exhausted') END; "+
    "UPDATE synthetic_m03_id_receipts SET issued_sequence=("+
      "SELECT current_sequence FROM synthetic_m03_id_counters "+
      "WHERE tenant_id=NEW.tenant_id AND id_key=NEW.id_key) "+
      "WHERE tenant_id=NEW.tenant_id AND id_key=NEW.id_key AND operation_id=NEW.operation_id; "+
    "SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'source ID receipt stamp failed') END; END",
  "CREATE TRIGGER synthetic_m03_id_receipt_immutable BEFORE UPDATE ON synthetic_m03_id_receipts "+
    "WHEN OLD.issued_sequence IS NOT NULL BEGIN "+
    "SELECT RAISE(ABORT,'immutable source ID receipt'); END",
  "CREATE TRIGGER synthetic_m03_id_receipt_no_delete BEFORE DELETE ON synthetic_m03_id_receipts "+
    "BEGIN SELECT RAISE(ABORT,'immutable source ID receipt'); END"
]);
