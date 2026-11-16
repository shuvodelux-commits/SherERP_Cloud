/**
 * M07-B2 isolated Workerd/D1 TEST-ONLY deletion/reversal proof.
 * Not production migration SQL; not deployed to Cloudflare Worker.
 * Original Cash Return rows remain immutable and are excluded only by a
 * synthetic correction marker view; a linked cash credit offsets the refund.
 */
export const M07_CASH_DELETE_TEST_DDL=[
`CREATE TABLE m07_cash_delete_receipts(
 tenant_id TEXT NOT NULL, operation_id TEXT NOT NULL, return_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, invoice_id TEXT NOT NULL, sku TEXT NOT NULL,
 lot_id TEXT NOT NULL, source_hash TEXT NOT NULL CHECK(length(source_hash)=64),
 intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
 units INTEGER NOT NULL CHECK(units>0),
 refund_paisa INTEGER NOT NULL CHECK(refund_paisa>=0),
 reason TEXT NOT NULL CHECK(length(reason)>0 AND length(reason)<=200),
 PRIMARY KEY(tenant_id,return_id), UNIQUE(tenant_id,operation_id)) STRICT`,
`CREATE TABLE m07_cash_delete_stock_undo(
 tenant_id TEXT NOT NULL, return_id TEXT NOT NULL, invoice_id TEXT NOT NULL,
 sku TEXT NOT NULL, lot_id TEXT NOT NULL,
 units_out INTEGER NOT NULL CHECK(units_out>0),
 PRIMARY KEY(tenant_id,return_id)) STRICT`,
`CREATE TABLE m07_cash_delete_offsets(
 tenant_id TEXT NOT NULL, return_id TEXT NOT NULL, invoice_id TEXT NOT NULL,
 credit_paisa INTEGER NOT NULL CHECK(credit_paisa>=0),
 PRIMARY KEY(tenant_id,return_id)) STRICT`,
`CREATE VIEW m07_active_cash_returns AS
 SELECT r.* FROM m07_cash_returns r
 WHERE NOT EXISTS(SELECT 1 FROM m07_cash_delete_receipts d
   WHERE d.tenant_id=r.tenant_id AND d.return_id=r.return_id)`,
`CREATE TRIGGER m07_commit_cash_delete AFTER INSERT ON m07_cash_delete_receipts
 BEGIN
 UPDATE m07_source_lots SET returned_units=returned_units-NEW.units
 WHERE tenant_id=NEW.tenant_id AND invoice_id=NEW.invoice_id
 AND sku=NEW.sku AND lot_id=NEW.lot_id AND returned_units>=NEW.units;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-delete-original-provenance') END;
 UPDATE m07_lot_stock SET available=available-NEW.units
 WHERE tenant_id=NEW.tenant_id AND lot_id=NEW.lot_id
 AND sku=NEW.sku AND available>=NEW.units;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-delete-resold-original-lot') END;
 UPDATE m06_owned_stock SET available=available-NEW.units
 WHERE tenant_id=NEW.tenant_id AND sku=NEW.sku AND available>=NEW.units;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-delete-insufficient-shop-stock') END;
 INSERT INTO m07_cash_delete_stock_undo VALUES(
   NEW.tenant_id,NEW.return_id,NEW.invoice_id,NEW.sku,NEW.lot_id,NEW.units);
 INSERT INTO m07_cash_delete_offsets VALUES(
   NEW.tenant_id,NEW.return_id,NEW.invoice_id,NEW.refund_paisa);
 END`,
];
export const M07_CASH_DELETE_IMMUTABLE_TABLES=[
  'm07_cash_delete_receipts','m07_cash_delete_stock_undo','m07_cash_delete_offsets'
];
export const M07_CASH_DELETE_IMMUTABLE_DDL=M07_CASH_DELETE_IMMUTABLE_TABLES.flatMap(name=>[
  `CREATE TRIGGER ${name}_immutable_update BEFORE UPDATE ON ${name}
   BEGIN SELECT RAISE(ABORT,'m07-immutable-correction'); END`,
  `CREATE TRIGGER ${name}_immutable_delete BEFORE DELETE ON ${name}
   BEGIN SELECT RAISE(ABORT,'m07-immutable-correction'); END`
]);
