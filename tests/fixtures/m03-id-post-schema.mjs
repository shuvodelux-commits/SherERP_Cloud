/**
 * Local test-only D1 extension to M03 ID issuer receipts.
 * The original AFTER INSERT issue trigger increments the counter + stamps
 * its receipt. This AFTER UPDATE posting trigger runs DURING that same INSERT.
 * ABORT at any nested step must roll back counter, receipt, stock and journal.
 */
import {SYNTHETIC_M03_ID_DDL} from './m03-id-issuer-schema.mjs';
export const SYNTHETIC_M03_ID_POST_DDL=Object.freeze([
  ...SYNTHETIC_M03_ID_DDL,
  "CREATE TABLE synthetic_m03_post_stock ("+
    "tenant_id TEXT NOT NULL,sku TEXT NOT NULL,available INTEGER NOT NULL CHECK(available>=0),"+
    "PRIMARY KEY(tenant_id,sku)) STRICT",
  "CREATE TABLE synthetic_m03_post_journal ("+
    "tenant_id TEXT NOT NULL,operation_id TEXT NOT NULL,source_id TEXT NOT NULL,"+
    "sku TEXT NOT NULL,units INTEGER NOT NULL CHECK(units=1),"+
    "PRIMARY KEY(tenant_id,operation_id),UNIQUE(tenant_id,source_id)) STRICT",
  "CREATE TRIGGER synthetic_m03_id_posting AFTER UPDATE ON synthetic_m03_id_receipts "+
    "WHEN OLD.issued_sequence IS NULL AND NEW.issued_sequence IS NOT NULL AND NEW.id_key='SALES' BEGIN "+
    "UPDATE synthetic_m03_post_stock SET available=available-1 "+
    "WHERE tenant_id=NEW.tenant_id AND sku='PIPE-1' AND available>=1; "+
    "SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'source ID posting stock refused') END; "+
    "INSERT INTO synthetic_m03_post_journal (tenant_id,operation_id,source_id,sku,units) "+
    "SELECT NEW.tenant_id,NEW.operation_id,prefix||'-'||printf('%06d',NEW.issued_sequence),'PIPE-1',1 "+
    "FROM synthetic_m03_id_counters WHERE tenant_id=NEW.tenant_id AND id_key=NEW.id_key; "+
    "SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'source ID posting journal refused') END; END",
  "CREATE TRIGGER synthetic_m03_post_journal_no_update BEFORE UPDATE ON synthetic_m03_post_journal "+
    "BEGIN SELECT RAISE(ABORT,'immutable post journal'); END",
  "CREATE TRIGGER synthetic_m03_post_journal_no_delete BEFORE DELETE ON synthetic_m03_post_journal "+
    "BEGIN SELECT RAISE(ABORT,'immutable post journal'); END"
]);
