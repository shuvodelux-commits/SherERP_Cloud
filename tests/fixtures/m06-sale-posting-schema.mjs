/** M06 ONLY: synthetic local Workerd/D1 schema, never production migrations. */
export const M06_SALE_TEST_DDL=[
`CREATE TABLE m06_cash_sessions(tenant_id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('Open','Closed'))) STRICT`,
`CREATE TABLE m06_owned_stock(tenant_id TEXT NOT NULL, sku TEXT NOT NULL, available INTEGER NOT NULL CHECK(available>=0), PRIMARY KEY(tenant_id,sku)) STRICT`,
`CREATE TABLE m06_bank_accounts(tenant_id TEXT NOT NULL, account_id TEXT NOT NULL, account_name TEXT NOT NULL, method TEXT NOT NULL CHECK(method IN ('Bank','Mobile Banking')), active INTEGER NOT NULL CHECK(active IN (0,1)), PRIMARY KEY(tenant_id,account_id)) STRICT`,
`CREATE TABLE m06_customer_accounts(tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL, party_id TEXT NOT NULL, due_paisa INTEGER NOT NULL CHECK(due_paisa>=0), PRIMARY KEY(tenant_id,customer_id)) STRICT`,
`CREATE TABLE m06_party_links(tenant_id TEXT NOT NULL, source_group TEXT NOT NULL CHECK(source_group='CUSTOMERS'), source_id TEXT NOT NULL, party_id TEXT NOT NULL, reviewed INTEGER NOT NULL CHECK(reviewed IN (0,1)), PRIMARY KEY(tenant_id,source_group,source_id)) STRICT`,
`CREATE TABLE m06_supplier_accounts(tenant_id TEXT NOT NULL, supplier_id TEXT NOT NULL, payable_paisa INTEGER NOT NULL, PRIMARY KEY(tenant_id,supplier_id)) STRICT`,
`CREATE TABLE m06_drafts(
 tenant_id TEXT NOT NULL, draft_id TEXT NOT NULL, owner_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>=1),
 sku TEXT NOT NULL, units INTEGER NOT NULL CHECK(units>0),
 unit_price_paisa INTEGER NOT NULL CHECK(unit_price_paisa>=0),
 discount_paisa INTEGER NOT NULL CHECK(discount_paisa>=0),
 customer_id TEXT NOT NULL, payments_json TEXT NOT NULL CHECK(json_valid(payments_json)),
 payment_mode TEXT NOT NULL CHECK(payment_mode IN ('Split','Legacy')),
 PRIMARY KEY(tenant_id,draft_id)) STRICT`,
`CREATE TABLE m06_draft_audit(
 tenant_id TEXT NOT NULL, draft_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=1),
 invoice_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action='POSTED'),
 PRIMARY KEY(tenant_id,draft_id)) STRICT`,
`CREATE TABLE m06_invoices(
 tenant_id TEXT NOT NULL, invoice_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
 sku TEXT NOT NULL, units INTEGER NOT NULL CHECK(units>0),
 unit_price_paisa INTEGER NOT NULL CHECK(unit_price_paisa>=0),
 discount_paisa INTEGER NOT NULL CHECK(discount_paisa>=0),
 source_draft_id TEXT NOT NULL DEFAULT '',
 source_draft_version INTEGER NOT NULL DEFAULT 0 CHECK(source_draft_version>=0),
 grand_paisa INTEGER NOT NULL CHECK(grand_paisa>=0),
 paid_paisa INTEGER NOT NULL CHECK(paid_paisa>=0),
 due_paisa INTEGER NOT NULL CHECK(due_paisa>=0),
 customer_id TEXT NOT NULL DEFAULT '', payments_json TEXT NOT NULL CHECK(json_valid(payments_json)),
 CHECK(paid_paisa+due_paisa=grand_paisa),
 CHECK(due_paisa=0 OR customer_id<>''),
 CHECK((source_draft_id='' AND source_draft_version=0) OR
       (source_draft_id<>'' AND source_draft_version>=1)),
 PRIMARY KEY(tenant_id,invoice_id), UNIQUE(tenant_id,operation_id)) STRICT`,
`CREATE UNIQUE INDEX m06_invoice_draft_once ON m06_invoices(tenant_id,source_draft_id)
 WHERE source_draft_id<>''`,
`CREATE TABLE m06_sale_items(tenant_id TEXT NOT NULL, invoice_id TEXT NOT NULL, sku TEXT NOT NULL, units INTEGER NOT NULL CHECK(units>0), PRIMARY KEY(tenant_id,invoice_id,sku)) STRICT`,
`CREATE TABLE m06_stock_movements(tenant_id TEXT NOT NULL, invoice_id TEXT NOT NULL, sku TEXT NOT NULL, units_out INTEGER NOT NULL CHECK(units_out>0), PRIMARY KEY(tenant_id,invoice_id,sku)) STRICT`,
`CREATE TABLE m06_payment_children(tenant_id TEXT NOT NULL, invoice_id TEXT NOT NULL, row_id TEXT NOT NULL, row_order INTEGER NOT NULL CHECK(row_order BETWEEN 1 AND 20), method TEXT NOT NULL CHECK(method IN ('Cash','Bank','Mobile Banking')), account_id TEXT NOT NULL, tender_paisa INTEGER NOT NULL CHECK(tender_paisa>=0), applied_paisa INTEGER NOT NULL CHECK(applied_paisa>=0), change_paisa INTEGER NOT NULL CHECK(change_paisa>=0), CHECK((method='Cash' AND account_id='' AND tender_paisa=applied_paisa+change_paisa) OR (method<>'Cash' AND account_id<>'' AND tender_paisa=applied_paisa AND change_paisa=0)), PRIMARY KEY(tenant_id,invoice_id,row_id), UNIQUE(tenant_id,invoice_id,row_order)) STRICT`,
`CREATE TABLE m06_cash_book(tenant_id TEXT NOT NULL, invoice_id TEXT NOT NULL, row_id TEXT NOT NULL, credit_paisa INTEGER NOT NULL CHECK(credit_paisa>0), PRIMARY KEY(tenant_id,invoice_id,row_id)) STRICT`,
`CREATE TABLE m06_bank_book(tenant_id TEXT NOT NULL, invoice_id TEXT NOT NULL, row_id TEXT NOT NULL, account_id TEXT NOT NULL, credit_paisa INTEGER NOT NULL CHECK(credit_paisa>0), PRIMARY KEY(tenant_id,invoice_id,row_id)) STRICT`,
`CREATE TABLE m06_customer_ledger(tenant_id TEXT NOT NULL, invoice_id TEXT NOT NULL, customer_id TEXT NOT NULL, debit_paisa INTEGER NOT NULL CHECK(debit_paisa>0), PRIMARY KEY(tenant_id,invoice_id)) STRICT`,
`CREATE TRIGGER m06_post_invoice AFTER INSERT ON m06_invoices BEGIN
 UPDATE m06_owned_stock SET available=available-NEW.units
 WHERE tenant_id=NEW.tenant_id AND sku=NEW.sku AND available>=NEW.units;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m06-stale-stock') END;
 INSERT INTO m06_sale_items VALUES (NEW.tenant_id,NEW.invoice_id,NEW.sku,NEW.units);
 INSERT INTO m06_stock_movements VALUES (NEW.tenant_id,NEW.invoice_id,NEW.sku,NEW.units);
 INSERT INTO m06_payment_children(
 tenant_id,invoice_id,row_id,row_order,method,account_id,tender_paisa,applied_paisa,change_paisa)
 SELECT NEW.tenant_id,NEW.invoice_id,
 json_extract(j.value,'$.rowId'),json_extract(j.value,'$.rowOrder'),json_extract(j.value,'$.method'),
 json_extract(j.value,'$.accountId'),json_extract(j.value,'$.tenderPaisa'),
 json_extract(j.value,'$.appliedPaisa'),json_extract(j.value,'$.changePaisa')
 FROM json_each(NEW.payments_json) AS j;
 SELECT CASE WHEN (SELECT COALESCE(SUM(applied_paisa),0) FROM m06_payment_children
 WHERE tenant_id=NEW.tenant_id AND invoice_id=NEW.invoice_id) != NEW.paid_paisa
 THEN RAISE(ABORT,'m06-payment-reconciliation') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM m06_payment_children p
 WHERE p.tenant_id=NEW.tenant_id AND p.invoice_id=NEW.invoice_id AND p.method<>'Cash'
 AND NOT EXISTS(SELECT 1 FROM m06_bank_accounts b WHERE b.tenant_id=p.tenant_id
 AND b.account_id=p.account_id AND b.method=p.method AND b.active=1))
 THEN RAISE(ABORT,'m06-bank-authority-changed') END;
 INSERT INTO m06_cash_book SELECT tenant_id,invoice_id,row_id,applied_paisa
 FROM m06_payment_children WHERE tenant_id=NEW.tenant_id AND invoice_id=NEW.invoice_id
 AND method='Cash' AND applied_paisa>0;
 INSERT INTO m06_bank_book SELECT tenant_id,invoice_id,row_id,account_id,applied_paisa
 FROM m06_payment_children WHERE tenant_id=NEW.tenant_id AND invoice_id=NEW.invoice_id
 AND method<>'Cash' AND applied_paisa>0;
 UPDATE m06_customer_accounts SET due_paisa=due_paisa+NEW.due_paisa
 WHERE tenant_id=NEW.tenant_id AND customer_id=NEW.customer_id AND NEW.due_paisa>0
 AND EXISTS(SELECT 1 FROM m06_party_links l WHERE l.tenant_id=NEW.tenant_id
 AND l.source_group='CUSTOMERS' AND l.source_id=NEW.customer_id
 AND l.party_id=m06_customer_accounts.party_id AND l.reviewed=1);
 SELECT CASE WHEN NEW.due_paisa>0 AND changes()!=1
 THEN RAISE(ABORT,'m06-customer-link-stale') END;
 INSERT INTO m06_customer_ledger SELECT NEW.tenant_id,NEW.invoice_id,NEW.customer_id,NEW.due_paisa
 WHERE NEW.due_paisa>0;
 DELETE FROM m06_drafts WHERE NEW.source_draft_id<>''
 AND tenant_id=NEW.tenant_id AND draft_id=NEW.source_draft_id
 AND version=NEW.source_draft_version AND owner_id=NEW.actor_id
 AND sku=NEW.sku AND units=NEW.units
 AND unit_price_paisa=NEW.unit_price_paisa AND discount_paisa=NEW.discount_paisa
 AND customer_id=NEW.customer_id AND payments_json=NEW.payments_json
 AND payment_mode='Split';
 SELECT CASE WHEN NEW.source_draft_id<>'' AND changes()!=1
 THEN RAISE(ABORT,'m06-draft-cas') END;
 INSERT INTO m06_draft_audit(tenant_id,draft_id,version,invoice_id,actor_id,action)
 SELECT NEW.tenant_id,NEW.source_draft_id,NEW.source_draft_version,
 NEW.invoice_id,NEW.actor_id,'POSTED' WHERE NEW.source_draft_id<>'';
 END`,
`CREATE TRIGGER m06_invoice_immutable_update BEFORE UPDATE ON m06_invoices BEGIN SELECT RAISE(ABORT,'m06-immutable-invoice'); END`,
`CREATE TRIGGER m06_invoice_immutable_delete BEFORE DELETE ON m06_invoices BEGIN SELECT RAISE(ABORT,'m06-immutable-invoice'); END`
];

export const M06_SALE_TEST_SEED=[
  ["INSERT INTO m06_cash_sessions VALUES ('SHOP-A','Open')",[]],
  ["INSERT INTO m06_owned_stock VALUES ('SHOP-A','PIPE',2)",[]],
  ["INSERT INTO m06_owned_stock VALUES ('SHOP-A','OTHER',4)",[]],
  ["INSERT INTO m06_bank_accounts VALUES ('SHOP-A','BANK-1','Shop Bank','Bank',1)",[]],
  ["INSERT INTO m06_bank_accounts VALUES ('SHOP-A','MOB-1','Shop Wallet','Mobile Banking',1)",[]],
  ["INSERT INTO m06_customer_accounts VALUES ('SHOP-A','CUS-1','PARTY-1',0)",[]],
  ["INSERT INTO m06_customer_accounts VALUES ('SHOP-A','CUS-2','PARTY-2',0)",[]],
  ["INSERT INTO m06_party_links VALUES ('SHOP-A','CUSTOMERS','CUS-1','PARTY-1',1)",[]],
  ["INSERT INTO m06_party_links VALUES ('SHOP-A','CUSTOMERS','CUS-2','PARTY-2',1)",[]],
  ["INSERT INTO m06_supplier_accounts VALUES ('SHOP-A','SUP-1',4000)",[]]
];
