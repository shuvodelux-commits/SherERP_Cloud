/** M07-B4 synthetic, isolated real Workerd D1 correction fixture. NEVER deploy. */
export const M07_PURCHASE_CASH_DELETE_DDL=[
`CREATE TABLE m07_purchase_cash_delete_receipts(
 tenant_id TEXT NOT NULL,return_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,purchase_id TEXT NOT NULL,sku TEXT NOT NULL,lot_id TEXT NOT NULL,
 source_hash TEXT NOT NULL CHECK(length(source_hash)=64),
 intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
 units INTEGER NOT NULL CHECK(units>0),
 refund_paisa INTEGER NOT NULL CHECK(refund_paisa>0),
 reason TEXT NOT NULL CHECK(length(reason)>0 AND length(reason)<=200),
 PRIMARY KEY(tenant_id,return_id),UNIQUE(tenant_id,operation_id)) STRICT`,
`CREATE TABLE m07_purchase_cash_delete_moves(
 tenant_id TEXT NOT NULL,return_id TEXT NOT NULL,purchase_id TEXT NOT NULL,
 lot_id TEXT NOT NULL,sku TEXT NOT NULL,units_in INTEGER NOT NULL CHECK(units_in>0),
 balance_stock INTEGER NOT NULL CHECK(balance_stock>=0),
 PRIMARY KEY(tenant_id,return_id)) STRICT`,
`CREATE TABLE m07_purchase_cash_delete_offsets(
 tenant_id TEXT NOT NULL,return_id TEXT NOT NULL,purchase_id TEXT NOT NULL,
 debit_paisa INTEGER NOT NULL CHECK(debit_paisa>0),
 PRIMARY KEY(tenant_id,return_id)) STRICT`,
`CREATE TABLE m07_purchase_cash_delete_dependencies(
 tenant_id TEXT NOT NULL,return_id TEXT NOT NULL,activity_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,return_id,activity_id)) STRICT`,
`CREATE VIEW m07_active_purchase_cash_returns AS
 SELECT r.* FROM m07_purchase_cash_returns r
 WHERE NOT EXISTS(SELECT 1 FROM m07_purchase_cash_delete_receipts d
 WHERE d.tenant_id=r.tenant_id AND d.return_id=r.return_id)`,
`CREATE TRIGGER m07_commit_purchase_cash_delete AFTER INSERT ON m07_purchase_cash_delete_receipts
 BEGIN
 UPDATE m07_purchase_lot_balances SET remaining=remaining+NEW.units
 WHERE tenant_id=NEW.tenant_id AND purchase_id=NEW.purchase_id
 AND lot_id=NEW.lot_id AND sku=NEW.sku
 AND remaining+NEW.units<=(SELECT qty FROM m05_lots
   WHERE tenant_id=NEW.tenant_id AND purchase_id=NEW.purchase_id
   AND lot_id=NEW.lot_id AND sku=NEW.sku);
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-original-purchase-lot-stale') END;
 UPDATE m05_products SET stock=stock+NEW.units,version=version+1
 WHERE tenant_id=NEW.tenant_id AND sku=NEW.sku
 AND active=1 AND deleted=0 AND product_type='Standard';
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-purchase-product-missing') END;
 INSERT INTO m07_purchase_cash_delete_moves
 SELECT NEW.tenant_id,NEW.return_id,NEW.purchase_id,NEW.lot_id,
 NEW.sku,NEW.units,p.stock
 FROM m05_products p WHERE p.tenant_id=NEW.tenant_id AND p.sku=NEW.sku;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-purchase-delete-movement-missing') END;
 INSERT INTO m07_purchase_cash_delete_offsets VALUES(
 NEW.tenant_id,NEW.return_id,NEW.purchase_id,NEW.refund_paisa);
 END`
];
export const M07_PURCHASE_CASH_DELETE_IMMUTABLE_TABLES=[
 'm07_purchase_cash_delete_receipts','m07_purchase_cash_delete_moves',
 'm07_purchase_cash_delete_offsets'
];
export const M07_PURCHASE_CASH_DELETE_IMMUTABLE_DDL=
 M07_PURCHASE_CASH_DELETE_IMMUTABLE_TABLES.flatMap(name=>[
  `CREATE TRIGGER ${name}_immutable_update BEFORE UPDATE ON ${name}
    BEGIN SELECT RAISE(ABORT,'m07-immutable-purchase-correction'); END`,
  `CREATE TRIGGER ${name}_immutable_delete BEFORE DELETE ON ${name}
    BEGIN SELECT RAISE(ABORT,'m07-immutable-purchase-correction'); END`
 ]);
