/** Synthetic D1/SQLite oversold settlement proof. NEVER a production migration. */
export const M03_OVERSOLD_DDL=Object.freeze([
`CREATE TABLE m03_os_roles(tenant_id TEXT,role_id TEXT,active INTEGER NOT NULL,can_post INTEGER NOT NULL,auth_version INTEGER NOT NULL,PRIMARY KEY(tenant_id,role_id)) STRICT`,
`CREATE TABLE m03_os_users(tenant_id TEXT,user_id TEXT,role_id TEXT,active INTEGER NOT NULL,auth_version INTEGER NOT NULL,PRIMARY KEY(tenant_id,user_id)) STRICT`,
`CREATE TABLE m03_os_sessions(token_hash TEXT PRIMARY KEY,tenant_id TEXT,user_id TEXT,role_id TEXT,user_version INTEGER,role_version INTEGER,expires_at INTEGER,revoked_at INTEGER) STRICT`,
`CREATE TABLE m03_os_lots(tenant_id TEXT NOT NULL,product_id TEXT NOT NULL,lot_id TEXT NOT NULL,purchase_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('PURCHASE','OVERSOLD')),original_units INTEGER NOT NULL CHECK(original_units>=0),remaining_units INTEGER NOT NULL,unit_cost_paisa INTEGER NOT NULL CHECK(unit_cost_paisa>0),occurred_at TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),PRIMARY KEY(tenant_id,lot_id)) STRICT`,
`CREATE TABLE m03_os_receipts(tenant_id TEXT NOT NULL,operation_id TEXT NOT NULL,actor_id TEXT NOT NULL,product_id TEXT NOT NULL,purchase_id TEXT NOT NULL,purchase_lot_id TEXT NOT NULL,expected_purchase_revision INTEGER NOT NULL,expected_purchase_remaining INTEGER NOT NULL,allocations_json TEXT NOT NULL CHECK(json_valid(allocations_json)),total_units INTEGER NOT NULL CHECK(total_units>0),provisional_cost_paisa INTEGER NOT NULL,actual_cost_paisa INTEGER NOT NULL,variance_paisa INTEGER NOT NULL, intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),committed_at TEXT NOT NULL,PRIMARY KEY(tenant_id,operation_id)) STRICT`,
`CREATE TABLE m03_os_links(tenant_id TEXT NOT NULL,operation_id TEXT NOT NULL,purchase_lot_id TEXT NOT NULL,oversold_lot_id TEXT NOT NULL,units INTEGER NOT NULL CHECK(units>0),provisional_cost_paisa INTEGER NOT NULL,actual_cost_paisa INTEGER NOT NULL,PRIMARY KEY(tenant_id,operation_id,oversold_lot_id),FOREIGN KEY(tenant_id,operation_id) REFERENCES m03_os_receipts(tenant_id,operation_id)) STRICT`,
`CREATE TABLE m03_os_audit(tenant_id TEXT NOT NULL,operation_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL,PRIMARY KEY(tenant_id,operation_id)) STRICT`,
`CREATE TRIGGER m03_os_receipt_apply AFTER INSERT ON m03_os_receipts BEGIN
 UPDATE m03_os_lots SET remaining_units=remaining_units-NEW.total_units, version=version+1
 WHERE tenant_id=NEW.tenant_id AND product_id=NEW.product_id AND lot_id=NEW.purchase_lot_id AND kind='PURCHASE' AND purchase_id=NEW.purchase_id
 AND version=NEW.expected_purchase_revision AND remaining_units=NEW.expected_purchase_remaining AND remaining_units>=NEW.total_units;
 SELECT CASE WHEN changes()=1 THEN 1 ELSE RAISE(ABORT,'purchase lot changed') END;
 UPDATE m03_os_lots SET
 remaining_units=remaining_units+(SELECT CAST(json_extract(j.value,'$.units') AS INTEGER) FROM json_each(NEW.allocations_json) j WHERE json_extract(j.value,'$.oversoldLotId')=lot_id),
 version=version+1
 WHERE tenant_id=NEW.tenant_id AND product_id=NEW.product_id AND kind='OVERSOLD'
 AND lot_id IN (SELECT json_extract(j.value,'$.oversoldLotId') FROM json_each(NEW.allocations_json) j);
 SELECT CASE WHEN changes()=json_array_length(NEW.allocations_json) THEN 1 ELSE RAISE(ABORT,'oversold allocation changed') END;
 INSERT INTO m03_os_links(tenant_id,operation_id,purchase_lot_id,oversold_lot_id,units,provisional_cost_paisa,actual_cost_paisa)
 SELECT NEW.tenant_id,NEW.operation_id,NEW.purchase_lot_id,json_extract(j.value,'$.oversoldLotId'),CAST(json_extract(j.value,'$.units') AS INTEGER),
 neg.unit_cost_paisa*CAST(json_extract(j.value,'$.units') AS INTEGER),
 (SELECT pos.unit_cost_paisa FROM m03_os_lots pos WHERE pos.tenant_id=NEW.tenant_id AND pos.lot_id=NEW.purchase_lot_id)*CAST(json_extract(j.value,'$.units') AS INTEGER)
 FROM json_each(NEW.allocations_json) j JOIN m03_os_lots neg ON neg.tenant_id=NEW.tenant_id AND neg.lot_id=json_extract(j.value,'$.oversoldLotId');
 INSERT INTO m03_os_audit VALUES(NEW.tenant_id,NEW.operation_id,NEW.actor_id,'synthetic-oversold-settlement');
 END`,
`CREATE TRIGGER m03_os_inject_late_failure BEFORE INSERT ON m03_os_audit WHEN NEW.operation_id='OP-BAD' BEGIN SELECT RAISE(ABORT,'synthetic late audit failure'); END`,
`CREATE TRIGGER m03_os_receipt_immutable_update BEFORE UPDATE ON m03_os_receipts BEGIN SELECT RAISE(ABORT,'receipt immutable'); END`,
`CREATE TRIGGER m03_os_receipt_immutable_delete BEFORE DELETE ON m03_os_receipts BEGIN SELECT RAISE(ABORT,'receipt immutable'); END`,
`CREATE TRIGGER m03_os_link_immutable_update BEFORE UPDATE ON m03_os_links BEGIN SELECT RAISE(ABORT,'link immutable'); END`,
`CREATE TRIGGER m03_os_link_immutable_delete BEFORE DELETE ON m03_os_links BEGIN SELECT RAISE(ABORT,'link immutable'); END`
]);
export function seedOversoldProof(db){
 for(const [tenant,user,role,token] of [['SHOP-A','USER-A','ROLE-A','a'.repeat(64)],['SHOP-B','USER-B','ROLE-B','b'.repeat(64)]]){
   db.prepare('INSERT INTO m03_os_roles VALUES (?,?,1,1,1)').run(tenant,role);
   db.prepare('INSERT INTO m03_os_users VALUES (?,?,?,1,1)').run(tenant,user,role);
   db.prepare('INSERT INTO m03_os_sessions VALUES (?,?,?,?,1,1,2000,NULL)').run(token,tenant,user,role);
 }
 for(const [lot,kind,original,remaining,cost,date,purchase] of [
   ['LOT-939','OVERSOLD',229,-229,6800,'2026-11-10','OVERSOLD'],
   ['LOT-OLD-2','OVERSOLD',2,-2,6800,'2026-11-15','OVERSOLD'],
   ['LOT-940','PURCHASE',240,240,6475,'2026-11-19','PUR-082']
 ]){
   db.prepare(`INSERT INTO m03_os_lots VALUES ('SHOP-A','PIPE',?,?,?,?,?,?,?,1)`)
     .run(lot,purchase,kind,original,remaining,cost,date);
 }
}
