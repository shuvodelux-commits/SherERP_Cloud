/**
 * Test-only D1 schema for exactly-once owned-stock reversal.
 * NOT a migration; never bind or import it from production Workers.
 */
export const SYNTHETIC_REVERSAL_SCHEMA=Object.freeze([
  `CREATE TABLE synthetic_original_ops(
    tenant_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    sku TEXT NOT NULL,
    units INTEGER NOT NULL CHECK(units>0),
    payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
    state TEXT NOT NULL CHECK(state='COMMITTED'),
    has_return INTEGER NOT NULL CHECK(has_return IN (0,1)),
    PRIMARY KEY(tenant_id,operation_id)
  ) STRICT`,
  `CREATE TABLE synthetic_owned_movements(
    tenant_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    sku TEXT NOT NULL,
    units INTEGER NOT NULL CHECK(units>0),
    source_type TEXT NOT NULL CHECK(source_type IN ('OWNED','VENDOR')),
    PRIMARY KEY(tenant_id,operation_id),
    FOREIGN KEY(tenant_id,operation_id) REFERENCES synthetic_original_ops(tenant_id,operation_id)
  ) STRICT`,
  `CREATE TABLE synthetic_stock(
    tenant_id TEXT NOT NULL,
    sku TEXT NOT NULL,
    available INTEGER NOT NULL CHECK(available>=0),
    PRIMARY KEY(tenant_id,sku)
  ) STRICT`,
  `CREATE TABLE synthetic_reversals(
    tenant_id TEXT NOT NULL,
    reversal_id TEXT NOT NULL,
    original_operation_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    original_hash TEXT NOT NULL CHECK(length(original_hash)=64),
    reversal_hash TEXT NOT NULL CHECK(length(reversal_hash)=64),
    units INTEGER NOT NULL CHECK(units>0),
    reason TEXT NOT NULL CHECK(length(trim(reason))>0),
    sku TEXT NOT NULL,
    result_ref TEXT NOT NULL CHECK(length(result_ref)>0),
    PRIMARY KEY(tenant_id,reversal_id),
    UNIQUE(tenant_id,original_operation_id),
    FOREIGN KEY(tenant_id,original_operation_id)
      REFERENCES synthetic_original_ops(tenant_id,operation_id)
  ) STRICT`,
  `CREATE TABLE synthetic_reverse_movements(
    tenant_id TEXT NOT NULL,
    reversal_id TEXT NOT NULL,
    original_operation_id TEXT NOT NULL,
    sku TEXT NOT NULL,
    units INTEGER NOT NULL CHECK(units>0),
    PRIMARY KEY(tenant_id,reversal_id),
    FOREIGN KEY(tenant_id,reversal_id)
      REFERENCES synthetic_reversals(tenant_id,reversal_id)
  ) STRICT`,
  `CREATE TRIGGER synthetic_reverse_apply AFTER INSERT ON synthetic_reversals
    BEGIN
      UPDATE synthetic_stock SET available=available+NEW.units
        WHERE tenant_id=NEW.tenant_id AND sku=NEW.sku;
      SELECT CASE WHEN changes()=1 THEN 1
        ELSE RAISE(ABORT,'synthetic-reversal-stock-missing') END;
      INSERT INTO synthetic_reverse_movements(
        tenant_id,reversal_id,original_operation_id,sku,units
      ) VALUES(
        NEW.tenant_id,NEW.reversal_id,NEW.original_operation_id,NEW.sku,NEW.units
      );
    END`,
  `CREATE TRIGGER synthetic_reverse_no_update BEFORE UPDATE ON synthetic_reversals
    BEGIN SELECT RAISE(ABORT,'Committed synthetic reversal is immutable'); END`,
  `CREATE TRIGGER synthetic_reverse_no_delete BEFORE DELETE ON synthetic_reversals
    BEGIN SELECT RAISE(ABORT,'Committed synthetic reversal is immutable'); END`,
  `CREATE TRIGGER synthetic_reverse_movement_no_update BEFORE UPDATE ON synthetic_reverse_movements
    BEGIN SELECT RAISE(ABORT,'Synthetic reverse movement is immutable'); END`,
  `CREATE TRIGGER synthetic_reverse_movement_no_delete BEFORE DELETE ON synthetic_reverse_movements
    BEGIN SELECT RAISE(ABORT,'Synthetic reverse movement is immutable'); END`,
  `CREATE TRIGGER synthetic_reverse_journal_failure BEFORE INSERT ON synthetic_reverse_movements
    WHEN NEW.reversal_id='REV-BROKEN'
    BEGIN SELECT RAISE(ABORT,'synthetic-reversal-journal-failure'); END`
]);

export const SYNTHETIC_REVERSAL_ORIGINALS=Object.freeze([
  ['TENANT-1','OP-OWN','PIPE',1,'a'.repeat(64),'COMMITTED',0],
  ['TENANT-2','OP-OWN','PIPE',1,'b'.repeat(64),'COMMITTED',0],
  ['TENANT-1','OP-VENDOR','VENDOR-WIRE',1,'c'.repeat(64),'COMMITTED',0],
  ['TENANT-1','OP-RETURN','RETURN-PIPE',1,'d'.repeat(64),'COMMITTED',1],
  ['TENANT-1','OP-MISSING','MISSING',1,'e'.repeat(64),'COMMITTED',0],
  ['TENANT-1','OP-BROKEN','BROKEN',1,'f'.repeat(64),'COMMITTED',0],
  ['TENANT-1','OP-RACE','RACE',1,'0'.repeat(64),'COMMITTED',0],
  ['TENANT-1','OP-UNPROVEN','UNPROVEN',1,'1'.repeat(64),'COMMITTED',0]
]);
export const SYNTHETIC_REVERSAL_STOCK=Object.freeze([
  ['TENANT-1','PIPE',0],['TENANT-2','PIPE',0],
  ['TENANT-1','RETURN-PIPE',0],['TENANT-1','BROKEN',0],
  ['TENANT-1','RACE',0],['TENANT-1','UNPROVEN',0]
]);
export const SYNTHETIC_REVERSAL_MOVEMENTS=Object.freeze([
  ['TENANT-1','OP-OWN','PIPE',1,'OWNED'],
  ['TENANT-2','OP-OWN','PIPE',1,'OWNED'],
  ['TENANT-1','OP-VENDOR','VENDOR-WIRE',1,'VENDOR'],
  ['TENANT-1','OP-RETURN','RETURN-PIPE',1,'OWNED'],
  ['TENANT-1','OP-MISSING','MISSING',1,'OWNED'],
  ['TENANT-1','OP-BROKEN','BROKEN',1,'OWNED'],
  ['TENANT-1','OP-RACE','RACE',1,'OWNED']
]);

export async function seedSyntheticReversalD1(DB){
  for(const row of SYNTHETIC_REVERSAL_ORIGINALS){
    await DB.prepare(`INSERT INTO synthetic_original_ops
      (tenant_id,operation_id,sku,units,payload_hash,state,has_return)
      VALUES (?,?,?,?,?,?,?)`).bind(...row).run();
  }
  for(const row of SYNTHETIC_REVERSAL_STOCK){
    await DB.prepare('INSERT INTO synthetic_stock(tenant_id,sku,available) VALUES (?,?,?)')
      .bind(...row).run();
  }
  for(const row of SYNTHETIC_REVERSAL_MOVEMENTS){
    await DB.prepare(`INSERT INTO synthetic_owned_movements
      (tenant_id,operation_id,sku,units,source_type) VALUES (?,?,?,?,?)`)
      .bind(...row).run();
  }
}
