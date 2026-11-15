/**
 * M05 multiple-line purchase: TEST-ONLY synthetic local Workerd/D1 fixture.
 * These m05ml_* tables are NOT versioned migrations or production contracts.
 */
export const M05ML_DDL=[
`CREATE TABLE m05ml_sessions(
 tenant_id TEXT PRIMARY KEY,state TEXT NOT NULL CHECK(state IN ('Open','Closed'))
) STRICT`,
`CREATE TABLE m05ml_products(
 tenant_id TEXT NOT NULL,sku TEXT NOT NULL,stock INTEGER NOT NULL CHECK(stock>=0),
 version INTEGER NOT NULL CHECK(version>0),
 sell_paisa INTEGER NOT NULL CHECK(sell_paisa>=0),
 active INTEGER NOT NULL CHECK(active IN (0,1)),
 deleted INTEGER NOT NULL CHECK(deleted IN (0,1)),
 product_type TEXT NOT NULL CHECK(product_type IN ('Standard','Bundle')),
 PRIMARY KEY(tenant_id,sku)
) STRICT`,
`CREATE TABLE m05ml_suppliers(
 tenant_id TEXT NOT NULL,supplier_id TEXT NOT NULL,party_id TEXT NOT NULL,
 active INTEGER NOT NULL CHECK(active IN (0,1)),
 payable_paisa INTEGER NOT NULL,PRIMARY KEY(tenant_id,supplier_id)
) STRICT`,
`CREATE TABLE m05ml_party_links(
 tenant_id TEXT NOT NULL,source_group TEXT NOT NULL CHECK(source_group='SUPPLIERS'),
 source_id TEXT NOT NULL,party_id TEXT NOT NULL,
 reviewed INTEGER NOT NULL CHECK(reviewed IN (0,1)),
 PRIMARY KEY(tenant_id,source_group,source_id)
) STRICT`,
`CREATE TABLE m05ml_customer_accounts(
 tenant_id TEXT NOT NULL,party_id TEXT NOT NULL,customer_ar_paisa INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,party_id)
) STRICT`,
`CREATE TABLE m05ml_banks(
 tenant_id TEXT NOT NULL,bank_id TEXT NOT NULL,
 active INTEGER NOT NULL CHECK(active IN (0,1)),
 PRIMARY KEY(tenant_id,bank_id)
) STRICT`,
`CREATE TABLE m05ml_purchases(
 tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
 supplier_id TEXT NOT NULL,purchase_date TEXT NOT NULL CHECK(length(purchase_date)=10),
 items_json TEXT NOT NULL CHECK(json_valid(items_json) AND json_type(items_json)='array'),
 subtotal_paisa INTEGER NOT NULL CHECK(subtotal_paisa>=0),
 discount_paisa INTEGER NOT NULL CHECK(discount_paisa>=0),
 grand_paisa INTEGER NOT NULL CHECK(grand_paisa>=0),
 paid_paisa INTEGER NOT NULL CHECK(paid_paisa>=0),
 due_paisa INTEGER NOT NULL CHECK(due_paisa>=0),
 payment_method TEXT NOT NULL CHECK(payment_method IN ('','Cash','Bank')),
 bank_account_id TEXT NOT NULL,
 CHECK(paid_paisa+due_paisa=grand_paisa),
 CHECK(grand_paisa=MAX(0,subtotal_paisa-discount_paisa)),
 CHECK((paid_paisa=0 AND payment_method='' AND bank_account_id='') OR
 (paid_paisa>0 AND ((payment_method='Cash' AND bank_account_id='') OR
 (payment_method='Bank' AND bank_account_id<>'')))),
 PRIMARY KEY(tenant_id,purchase_id),UNIQUE(tenant_id,operation_id)
) STRICT`,
`CREATE TABLE m05ml_items(
 tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,sku TEXT NOT NULL,
 qty INTEGER NOT NULL CHECK(qty>0),expected_version INTEGER NOT NULL CHECK(expected_version>0),
 cost_paisa INTEGER NOT NULL CHECK(cost_paisa>=0),
 sell_paisa INTEGER NOT NULL CHECK(sell_paisa>=0),
 PRIMARY KEY(tenant_id,purchase_id,sku)
) STRICT`,
`CREATE TABLE m05ml_lots(
 tenant_id TEXT NOT NULL,lot_id TEXT NOT NULL,purchase_id TEXT NOT NULL,
 supplier_id TEXT NOT NULL,sku TEXT NOT NULL,purchase_date TEXT NOT NULL,
 qty INTEGER NOT NULL CHECK(qty>0),remaining_qty INTEGER NOT NULL CHECK(remaining_qty>=0),
 cost_paisa INTEGER NOT NULL CHECK(cost_paisa>=0),
 sell_paisa INTEGER NOT NULL CHECK(sell_paisa>=0),
 PRIMARY KEY(tenant_id,lot_id)
) STRICT`,
`CREATE TABLE m05ml_movements(
 tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,sku TEXT NOT NULL,
 lot_id TEXT NOT NULL,units_in INTEGER NOT NULL CHECK(units_in>0),
 balance_stock INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,purchase_id,sku)
) STRICT`,
`CREATE TABLE m05ml_cash_book(
 tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,
 debit_paisa INTEGER NOT NULL CHECK(debit_paisa>0),PRIMARY KEY(tenant_id,purchase_id)
) STRICT`,
`CREATE TABLE m05ml_bank_book(
 tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,bank_account_id TEXT NOT NULL,
 debit_paisa INTEGER NOT NULL CHECK(debit_paisa>0),PRIMARY KEY(tenant_id,purchase_id)
) STRICT`,
`CREATE TABLE m05ml_supplier_ledger(
 tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,supplier_id TEXT NOT NULL,
 debit_paisa INTEGER NOT NULL CHECK(debit_paisa>0),balance_paisa INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,purchase_id)
) STRICT`,
`CREATE TRIGGER m05ml_commit_item AFTER INSERT ON m05ml_items BEGIN
 UPDATE m05ml_products SET stock=stock+NEW.qty,version=version+1,sell_paisa=NEW.sell_paisa
 WHERE tenant_id=NEW.tenant_id AND sku=NEW.sku AND version=NEW.expected_version
 AND active=1 AND deleted=0 AND product_type='Standard';
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m05ml-stale-product') END;
 INSERT INTO m05ml_lots(
 tenant_id,lot_id,purchase_id,supplier_id,sku,purchase_date,qty,remaining_qty,cost_paisa,sell_paisa)
 SELECT NEW.tenant_id,'LOT-'||NEW.purchase_id||'-'||NEW.sku,NEW.purchase_id,
 p.supplier_id,NEW.sku,p.purchase_date,NEW.qty,NEW.qty,NEW.cost_paisa,NEW.sell_paisa
 FROM m05ml_purchases p WHERE p.tenant_id=NEW.tenant_id AND p.purchase_id=NEW.purchase_id;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m05ml-lot-write') END;
 INSERT INTO m05ml_movements(tenant_id,purchase_id,sku,lot_id,units_in,balance_stock)
 SELECT NEW.tenant_id,NEW.purchase_id,NEW.sku,'LOT-'||NEW.purchase_id||'-'||NEW.sku,NEW.qty,pr.stock
 FROM m05ml_products pr WHERE pr.tenant_id=NEW.tenant_id AND pr.sku=NEW.sku;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m05ml-movement-write') END;
 END`,
`CREATE TRIGGER m05ml_commit_purchase AFTER INSERT ON m05ml_purchases BEGIN
 SELECT CASE WHEN
 (SELECT COALESCE(SUM(
 CAST(json_extract(j.value,'$.qty') AS INTEGER) *
 CAST(json_extract(j.value,'$.costPaisa') AS INTEGER)),0)
 FROM json_each(NEW.items_json) j) != NEW.subtotal_paisa
 THEN RAISE(ABORT,'m05ml-subtotal-reconciliation') END;
 INSERT INTO m05ml_items(tenant_id,purchase_id,sku,qty,expected_version,cost_paisa,sell_paisa)
 SELECT NEW.tenant_id,NEW.purchase_id,
 json_extract(j.value,'$.sku'),json_extract(j.value,'$.qty'),
 json_extract(j.value,'$.expectedVersion'),json_extract(j.value,'$.costPaisa'),
 json_extract(j.value,'$.sellPaisa')
 FROM json_each(NEW.items_json) AS j;
 SELECT CASE WHEN
 (SELECT COUNT(*) FROM m05ml_items WHERE tenant_id=NEW.tenant_id AND purchase_id=NEW.purchase_id)
 != json_array_length(NEW.items_json)
 THEN RAISE(ABORT,'m05ml-child-count') END;
 INSERT INTO m05ml_cash_book(tenant_id,purchase_id,debit_paisa)
 SELECT NEW.tenant_id,NEW.purchase_id,NEW.paid_paisa
 WHERE NEW.paid_paisa>0 AND NEW.payment_method='Cash';
 INSERT INTO m05ml_bank_book(tenant_id,purchase_id,bank_account_id,debit_paisa)
 SELECT NEW.tenant_id,NEW.purchase_id,NEW.bank_account_id,NEW.paid_paisa
 WHERE NEW.paid_paisa>0 AND NEW.payment_method='Bank'
 AND EXISTS(SELECT 1 FROM m05ml_banks b
 WHERE b.tenant_id=NEW.tenant_id AND b.bank_id=NEW.bank_account_id AND b.active=1);
 SELECT CASE WHEN NEW.payment_method='Bank' AND NEW.paid_paisa>0 AND changes()!=1
 THEN RAISE(ABORT,'m05ml-bank-status-changed') END;
 UPDATE m05ml_suppliers SET payable_paisa=payable_paisa+NEW.due_paisa
 WHERE tenant_id=NEW.tenant_id AND supplier_id=NEW.supplier_id AND active=1
 AND NEW.due_paisa>0
 AND EXISTS(SELECT 1 FROM m05ml_party_links l
 WHERE l.tenant_id=NEW.tenant_id AND l.source_group='SUPPLIERS'
 AND l.source_id=NEW.supplier_id AND l.party_id=m05ml_suppliers.party_id AND l.reviewed=1);
 SELECT CASE WHEN NEW.due_paisa>0 AND changes()!=1
 THEN RAISE(ABORT,'m05ml-supplier-link-changed') END;
 INSERT INTO m05ml_supplier_ledger(tenant_id,purchase_id,supplier_id,debit_paisa,balance_paisa)
 SELECT NEW.tenant_id,NEW.purchase_id,NEW.supplier_id,NEW.due_paisa,s.payable_paisa
 FROM m05ml_suppliers s WHERE NEW.due_paisa>0
 AND s.tenant_id=NEW.tenant_id AND s.supplier_id=NEW.supplier_id;
 SELECT CASE WHEN NEW.due_paisa>0 AND changes()!=1
 THEN RAISE(ABORT,'m05ml-supplier-ledger-write') END;
 END`,
`CREATE TRIGGER m05ml_purchase_immutable_update BEFORE UPDATE ON m05ml_purchases
 BEGIN SELECT RAISE(ABORT,'m05ml-immutable-receipt'); END`,
`CREATE TRIGGER m05ml_purchase_immutable_delete BEFORE DELETE ON m05ml_purchases
 BEGIN SELECT RAISE(ABORT,'m05ml-immutable-receipt'); END`
];

export const M05ML_SEED=[
  ["INSERT INTO m05ml_sessions VALUES ('SHOP-A','Open')",[]],
  ["INSERT INTO m05ml_products VALUES ('SHOP-A','PIPE',4,1,0,1,0,'Standard')",[]],
  ["INSERT INTO m05ml_products VALUES ('SHOP-A','SWITCH',2,1,0,1,0,'Standard')",[]],
  ["INSERT INTO m05ml_products VALUES ('SHOP-A','BUNDLE',0,1,0,1,0,'Bundle')",[]],
  ["INSERT INTO m05ml_suppliers VALUES ('SHOP-A','SUP-1','PARTY-1',1,4000)",[]],
  ["INSERT INTO m05ml_suppliers VALUES ('SHOP-A','SUP-2','PARTY-2',1,2000)",[]],
  ["INSERT INTO m05ml_party_links VALUES ('SHOP-A','SUPPLIERS','SUP-1','PARTY-1',1)",[]],
  ["INSERT INTO m05ml_party_links VALUES ('SHOP-A','SUPPLIERS','SUP-2','PARTY-2',1)",[]],
  ["INSERT INTO m05ml_customer_accounts VALUES ('SHOP-A','PARTY-1',9000)",[]],
  ["INSERT INTO m05ml_banks VALUES ('SHOP-A','BANK-1',1)",[]]
];
