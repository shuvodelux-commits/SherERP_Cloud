/** M07-A1 ONLY: isolated local Workerd/D1 fixtures; never deploy or migrate. */
export const M07_CASH_TEST_DDL = [
`CREATE TABLE m07_source_lots(
 tenant_id TEXT NOT NULL, invoice_id TEXT NOT NULL, sku TEXT NOT NULL, lot_id TEXT NOT NULL,
 sold_units INTEGER NOT NULL CHECK(sold_units>0),
 returned_units INTEGER NOT NULL DEFAULT 0 CHECK(returned_units>=0 AND returned_units<=sold_units),
 PRIMARY KEY(tenant_id,invoice_id,sku,lot_id)) STRICT`,
`CREATE TABLE m07_lot_stock(
 tenant_id TEXT NOT NULL, lot_id TEXT NOT NULL, sku TEXT NOT NULL,
 available INTEGER NOT NULL CHECK(available>=0), PRIMARY KEY(tenant_id,lot_id)) STRICT`,
`CREATE TABLE m07_cash_returns(
 tenant_id TEXT NOT NULL, return_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, invoice_id TEXT NOT NULL, sku TEXT NOT NULL, lot_id TEXT NOT NULL,
 source_hash TEXT NOT NULL CHECK(length(source_hash)=64),
 intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
 units INTEGER NOT NULL CHECK(units>0), refund_paisa INTEGER NOT NULL CHECK(refund_paisa>=0),
 reason TEXT NOT NULL CHECK(length(reason)>0 AND length(reason)<=200),
 PRIMARY KEY(tenant_id,return_id), UNIQUE(tenant_id,operation_id)) STRICT`,
`CREATE TABLE m07_return_movements(
 tenant_id TEXT NOT NULL, return_id TEXT NOT NULL, invoice_id TEXT NOT NULL,
 sku TEXT NOT NULL, lot_id TEXT NOT NULL, units_in INTEGER NOT NULL CHECK(units_in>0),
 PRIMARY KEY(tenant_id,return_id)) STRICT`,
`CREATE TABLE m07_cash_refunds(
 tenant_id TEXT NOT NULL, return_id TEXT NOT NULL, invoice_id TEXT NOT NULL,
 debit_paisa INTEGER NOT NULL CHECK(debit_paisa>=0),
 PRIMARY KEY(tenant_id,return_id)) STRICT`,
`CREATE TRIGGER m07_commit_cash_return AFTER INSERT ON m07_cash_returns BEGIN
 UPDATE m07_source_lots SET returned_units=returned_units+NEW.units
 WHERE tenant_id=NEW.tenant_id AND invoice_id=NEW.invoice_id AND sku=NEW.sku
 AND lot_id=NEW.lot_id AND returned_units+NEW.units<=sold_units;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-return-qty-race') END;
 UPDATE m07_lot_stock SET available=available+NEW.units
 WHERE tenant_id=NEW.tenant_id AND lot_id=NEW.lot_id AND sku=NEW.sku;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-original-lot-missing') END;
 UPDATE m06_owned_stock SET available=available+NEW.units
 WHERE tenant_id=NEW.tenant_id AND sku=NEW.sku;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-stock-missing') END;
 INSERT INTO m07_return_movements VALUES(
 NEW.tenant_id,NEW.return_id,NEW.invoice_id,NEW.sku,NEW.lot_id,NEW.units);
 INSERT INTO m07_cash_refunds VALUES(
 NEW.tenant_id,NEW.return_id,NEW.invoice_id,NEW.refund_paisa);
 END`,
`CREATE TRIGGER m07_receipt_immutable_update BEFORE UPDATE ON m07_cash_returns
 BEGIN SELECT RAISE(ABORT,'m07-immutable-return'); END`,
`CREATE TRIGGER m07_receipt_immutable_delete BEFORE DELETE ON m07_cash_returns
 BEGIN SELECT RAISE(ABORT,'m07-immutable-return'); END`

,`CREATE TABLE m07_customer_signed_accounts(
 tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL, party_id TEXT NOT NULL,
 signed_due_paisa INTEGER NOT NULL CHECK(signed_due_paisa BETWEEN -1000000000000 AND 1000000000000),
 active INTEGER NOT NULL CHECK(active IN (0,1)),
 PRIMARY KEY(tenant_id,customer_id)) STRICT`,
`CREATE TABLE m07_credit_returns(
 tenant_id TEXT NOT NULL, return_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, invoice_id TEXT NOT NULL, sku TEXT NOT NULL, lot_id TEXT NOT NULL,
 source_hash TEXT NOT NULL CHECK(length(source_hash)=64),
 intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
 customer_id TEXT NOT NULL, units INTEGER NOT NULL CHECK(units>0),
 credit_paisa INTEGER NOT NULL CHECK(credit_paisa>0),
 reason TEXT NOT NULL CHECK(length(reason)>0 AND length(reason)<=200),
 PRIMARY KEY(tenant_id,return_id), UNIQUE(tenant_id,operation_id)) STRICT`,
`CREATE TABLE m07_credit_ledger(
 tenant_id TEXT NOT NULL, return_id TEXT NOT NULL, invoice_id TEXT NOT NULL,
 customer_id TEXT NOT NULL, party_id TEXT NOT NULL,
 credit_paisa INTEGER NOT NULL CHECK(credit_paisa>0),
 balance_paisa INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,return_id)) STRICT`,
`CREATE TRIGGER m07_commit_store_credit AFTER INSERT ON m07_credit_returns BEGIN
 UPDATE m07_source_lots SET returned_units=returned_units+NEW.units
 WHERE tenant_id=NEW.tenant_id AND invoice_id=NEW.invoice_id
 AND sku=NEW.sku AND lot_id=NEW.lot_id AND returned_units+NEW.units<=sold_units;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-credit-qty-race') END;
 UPDATE m07_lot_stock SET available=available+NEW.units
 WHERE tenant_id=NEW.tenant_id AND lot_id=NEW.lot_id AND sku=NEW.sku;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-credit-original-lot-missing') END;
 UPDATE m06_owned_stock SET available=available+NEW.units
 WHERE tenant_id=NEW.tenant_id AND sku=NEW.sku;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-credit-stock-missing') END;
 INSERT INTO m07_return_movements VALUES(
 NEW.tenant_id,NEW.return_id,NEW.invoice_id,NEW.sku,NEW.lot_id,NEW.units);
 UPDATE m07_customer_signed_accounts
 SET signed_due_paisa=signed_due_paisa-NEW.credit_paisa
 WHERE tenant_id=NEW.tenant_id AND customer_id=NEW.customer_id AND active=1
 AND EXISTS(SELECT 1 FROM m06_party_links l
  WHERE l.tenant_id=NEW.tenant_id AND l.source_group='CUSTOMERS'
  AND l.source_id=NEW.customer_id AND l.party_id=m07_customer_signed_accounts.party_id AND l.reviewed=1);
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-credit-customer-link-stale') END;
 INSERT INTO m07_credit_ledger
 SELECT NEW.tenant_id,NEW.return_id,NEW.invoice_id,NEW.customer_id,
 a.party_id,NEW.credit_paisa,a.signed_due_paisa
 FROM m07_customer_signed_accounts a
 WHERE a.tenant_id=NEW.tenant_id AND a.customer_id=NEW.customer_id AND a.active=1;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-credit-ledger-missing') END;
 END`,
`CREATE TRIGGER m07_credit_immutable_update BEFORE UPDATE ON m07_credit_returns
 BEGIN SELECT RAISE(ABORT,'m07-immutable-credit'); END`,
`CREATE TRIGGER m07_credit_immutable_delete BEFORE DELETE ON m07_credit_returns
 BEGIN SELECT RAISE(ABORT,'m07-immutable-credit'); END`

];
