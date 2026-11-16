/**
 * M07-B3 isolated REAL Workerd/D1 TEST-ONLY Store Credit correction evidence.
 * Never import this schema into production or remote Cloudflare D1.
 */
export const M07_CREDIT_DELETE_TEST_DDL=[
`CREATE TABLE m07_credit_delete_receipts(
 tenant_id TEXT NOT NULL, operation_id TEXT NOT NULL, return_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, invoice_id TEXT NOT NULL, sku TEXT NOT NULL,
 lot_id TEXT NOT NULL, source_hash TEXT NOT NULL CHECK(length(source_hash)=64),
 intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
 customer_id TEXT NOT NULL, units INTEGER NOT NULL CHECK(units>0),
 credit_paisa INTEGER NOT NULL CHECK(credit_paisa>0),
 reason TEXT NOT NULL CHECK(length(reason)>0 AND length(reason)<=200),
 PRIMARY KEY(tenant_id,return_id), UNIQUE(tenant_id,operation_id)) STRICT`,
`CREATE TABLE m07_credit_delete_stock_undo(
 tenant_id TEXT NOT NULL, return_id TEXT NOT NULL, invoice_id TEXT NOT NULL,
 sku TEXT NOT NULL, lot_id TEXT NOT NULL, units_out INTEGER NOT NULL CHECK(units_out>0),
 PRIMARY KEY(tenant_id,return_id)) STRICT`,
`CREATE TABLE m07_credit_delete_ledger(
 tenant_id TEXT NOT NULL, return_id TEXT NOT NULL,
 customer_id TEXT NOT NULL, party_id TEXT NOT NULL,
 debit_paisa INTEGER NOT NULL CHECK(debit_paisa>0),
 balance_paisa INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,return_id)) STRICT`,
`CREATE TABLE m07_credit_delete_dependencies(
 tenant_id TEXT NOT NULL, return_id TEXT NOT NULL,
 customer_id TEXT NOT NULL, activity_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,return_id,activity_id)) STRICT`,
`CREATE VIEW m07_active_credit_returns AS
 SELECT r.* FROM m07_credit_returns r
 WHERE NOT EXISTS(SELECT 1 FROM m07_credit_delete_receipts d
 WHERE d.tenant_id=r.tenant_id AND d.return_id=r.return_id)`,
`CREATE TRIGGER m07_commit_credit_delete AFTER INSERT ON m07_credit_delete_receipts
 BEGIN
 UPDATE m07_source_lots SET returned_units=returned_units-NEW.units
 WHERE tenant_id=NEW.tenant_id AND invoice_id=NEW.invoice_id
 AND sku=NEW.sku AND lot_id=NEW.lot_id AND returned_units>=NEW.units;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-credit-delete-source-stale') END;
 UPDATE m07_lot_stock SET available=available-NEW.units
 WHERE tenant_id=NEW.tenant_id AND lot_id=NEW.lot_id AND sku=NEW.sku
 AND available>=NEW.units;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-credit-delete-lot-resold') END;
 UPDATE m06_owned_stock SET available=available-NEW.units
 WHERE tenant_id=NEW.tenant_id AND sku=NEW.sku AND available>=NEW.units;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-credit-delete-shop-stock-stale') END;
 INSERT INTO m07_credit_delete_stock_undo VALUES(
 NEW.tenant_id,NEW.return_id,NEW.invoice_id,NEW.sku,NEW.lot_id,NEW.units);
 UPDATE m07_customer_signed_accounts SET signed_due_paisa=signed_due_paisa+NEW.credit_paisa
 WHERE tenant_id=NEW.tenant_id AND customer_id=NEW.customer_id AND active=1
 AND signed_due_paisa=(SELECT balance_paisa FROM m07_credit_ledger
   WHERE tenant_id=NEW.tenant_id AND return_id=NEW.return_id)
 AND party_id=(SELECT party_id FROM m07_credit_ledger
   WHERE tenant_id=NEW.tenant_id AND return_id=NEW.return_id)
 AND EXISTS(SELECT 1 FROM m06_party_links l
   WHERE l.tenant_id=NEW.tenant_id AND l.source_group='CUSTOMERS'
   AND l.source_id=NEW.customer_id AND l.party_id=m07_customer_signed_accounts.party_id
   AND l.reviewed=1);
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-credit-delete-customer-evidence-stale') END;
 INSERT INTO m07_credit_delete_ledger
 SELECT NEW.tenant_id,NEW.return_id,NEW.customer_id,a.party_id,
   NEW.credit_paisa,a.signed_due_paisa
 FROM m07_customer_signed_accounts a WHERE a.tenant_id=NEW.tenant_id
 AND a.customer_id=NEW.customer_id AND a.active=1;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-credit-delete-ledger-evidence-stale') END;
 END`
];
export const M07_CREDIT_DELETE_IMMUTABLE_TABLES=[
 'm07_credit_delete_receipts','m07_credit_delete_stock_undo','m07_credit_delete_ledger'
];
export const M07_CREDIT_DELETE_IMMUTABLE_DDL=M07_CREDIT_DELETE_IMMUTABLE_TABLES.flatMap(t=>[
 `CREATE TRIGGER ${t}_immutable_update BEFORE UPDATE ON ${t}
 BEGIN SELECT RAISE(ABORT,'m07-immutable-credit-delete'); END`,
 `CREATE TRIGGER ${t}_immutable_delete BEFORE DELETE ON ${t}
 BEGIN SELECT RAISE(ABORT,'m07-immutable-credit-delete'); END`
]);
