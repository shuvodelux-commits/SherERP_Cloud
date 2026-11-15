/** M05 ONLY — synthetic local D1 transaction proof. NOT a deployable migration. */
export const M05_PURCHASE_DDL=[
`CREATE TABLE m05_sessions(tenant_id TEXT PRIMARY KEY,state TEXT NOT NULL CHECK(state IN ('Open','Closed'))) STRICT`,
`CREATE TABLE m05_products(tenant_id TEXT NOT NULL,sku TEXT NOT NULL,stock INTEGER NOT NULL,version INTEGER NOT NULL CHECK(version>=1),active INTEGER NOT NULL CHECK(active IN (0,1)),deleted INTEGER NOT NULL CHECK(deleted IN (0,1)),product_type TEXT NOT NULL CHECK(product_type IN ('Standard','Bundle')),PRIMARY KEY(tenant_id,sku)) STRICT`,
`CREATE TABLE m05_suppliers(tenant_id TEXT NOT NULL,supplier_id TEXT NOT NULL,party_id TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN (0,1)),payable_paisa INTEGER NOT NULL,PRIMARY KEY(tenant_id,supplier_id)) STRICT`,
`CREATE TABLE m05_party_links(tenant_id TEXT NOT NULL,source_group TEXT NOT NULL CHECK(source_group='SUPPLIERS'),source_id TEXT NOT NULL,party_id TEXT NOT NULL,reviewed INTEGER NOT NULL CHECK(reviewed IN (0,1)),PRIMARY KEY(tenant_id,source_group,source_id)) STRICT`,
`CREATE TABLE m05_banks(tenant_id TEXT NOT NULL,bank_id TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN (0,1)),PRIMARY KEY(tenant_id,bank_id)) STRICT`,
`CREATE TABLE m05_unrelated_accounts(party_id TEXT PRIMARY KEY,customer_ar_paisa INTEGER NOT NULL) STRICT`,
`CREATE TABLE m05_purchases(
 tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
 supplier_id TEXT NOT NULL,sku TEXT NOT NULL,qty INTEGER NOT NULL CHECK(qty>0),
 expected_version INTEGER NOT NULL CHECK(expected_version>=1),
 purchase_date TEXT NOT NULL CHECK(length(purchase_date)=10),
 unit_cost_paisa INTEGER NOT NULL CHECK(unit_cost_paisa>=0),
 sell_price_paisa INTEGER NOT NULL CHECK(sell_price_paisa>=0),
 discount_paisa INTEGER NOT NULL CHECK(discount_paisa>=0),
 grand_paisa INTEGER NOT NULL CHECK(grand_paisa>=0),
 paid_paisa INTEGER NOT NULL CHECK(paid_paisa>=0),
 due_paisa INTEGER NOT NULL CHECK(due_paisa>=0),
 payment_method TEXT NOT NULL CHECK(payment_method IN ('','Cash','Bank')),
 bank_account_id TEXT NOT NULL,
 CHECK(paid_paisa+due_paisa=grand_paisa),
 CHECK((paid_paisa=0 AND payment_method='' AND bank_account_id='') OR
       (paid_paisa>0 AND ((payment_method='Cash' AND bank_account_id='') OR
       (payment_method='Bank' AND bank_account_id<>'')))),
 PRIMARY KEY(tenant_id,purchase_id),UNIQUE(tenant_id,operation_id)) STRICT`,
`CREATE TABLE m05_items(tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,sku TEXT NOT NULL,qty INTEGER NOT NULL CHECK(qty>0),unit_cost_paisa INTEGER NOT NULL CHECK(unit_cost_paisa>=0),sell_price_paisa INTEGER NOT NULL CHECK(sell_price_paisa>=0),PRIMARY KEY(tenant_id,purchase_id,sku)) STRICT`,
`CREATE TABLE m05_lots(tenant_id TEXT NOT NULL,lot_id TEXT NOT NULL,purchase_id TEXT NOT NULL,supplier_id TEXT NOT NULL,sku TEXT NOT NULL,qty INTEGER NOT NULL CHECK(qty>0),purchase_date TEXT NOT NULL,unit_cost_paisa INTEGER NOT NULL CHECK(unit_cost_paisa>=0),sell_price_paisa INTEGER NOT NULL CHECK(sell_price_paisa>=0),PRIMARY KEY(tenant_id,lot_id)) STRICT`,
`CREATE TABLE m05_movements(tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,lot_id TEXT NOT NULL,sku TEXT NOT NULL,units_in INTEGER NOT NULL CHECK(units_in>0),balance_stock INTEGER NOT NULL,PRIMARY KEY(tenant_id,purchase_id)) STRICT`,
`CREATE TABLE m05_cash_book(tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,debit_paisa INTEGER NOT NULL CHECK(debit_paisa>0),PRIMARY KEY(tenant_id,purchase_id)) STRICT`,
`CREATE TABLE m05_bank_book(tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,bank_account_id TEXT NOT NULL,debit_paisa INTEGER NOT NULL CHECK(debit_paisa>0),PRIMARY KEY(tenant_id,purchase_id)) STRICT`,
`CREATE TABLE m05_supplier_ledger(tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,supplier_id TEXT NOT NULL,debit_paisa INTEGER NOT NULL CHECK(debit_paisa>0),balance_paisa INTEGER NOT NULL,PRIMARY KEY(tenant_id,purchase_id)) STRICT`,
`CREATE TRIGGER m05_commit_purchase AFTER INSERT ON m05_purchases BEGIN
 UPDATE m05_products SET stock=stock+NEW.qty,version=version+1
 WHERE tenant_id=NEW.tenant_id AND sku=NEW.sku AND version=NEW.expected_version
 AND active=1 AND deleted=0 AND product_type='Standard';
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m05-stale-product') END;
 INSERT INTO m05_items VALUES(NEW.tenant_id,NEW.purchase_id,NEW.sku,NEW.qty,NEW.unit_cost_paisa,NEW.sell_price_paisa);
 INSERT INTO m05_lots VALUES(NEW.tenant_id,'LOT-'||NEW.purchase_id,NEW.purchase_id,NEW.supplier_id,
 NEW.sku,NEW.qty,NEW.purchase_date,NEW.unit_cost_paisa,NEW.sell_price_paisa);
 INSERT INTO m05_movements(tenant_id,purchase_id,lot_id,sku,units_in,balance_stock)
 SELECT NEW.tenant_id,NEW.purchase_id,'LOT-'||NEW.purchase_id,NEW.sku,NEW.qty,p.stock
 FROM m05_products p WHERE p.tenant_id=NEW.tenant_id AND p.sku=NEW.sku;
 INSERT INTO m05_cash_book SELECT NEW.tenant_id,NEW.purchase_id,NEW.paid_paisa
 WHERE NEW.payment_method='Cash' AND NEW.paid_paisa>0;
 INSERT INTO m05_bank_book SELECT NEW.tenant_id,NEW.purchase_id,NEW.bank_account_id,NEW.paid_paisa
 WHERE NEW.payment_method='Bank' AND NEW.paid_paisa>0
 AND EXISTS(SELECT 1 FROM m05_banks b WHERE b.tenant_id=NEW.tenant_id
   AND b.bank_id=NEW.bank_account_id AND b.active=1);
 SELECT CASE WHEN NEW.payment_method='Bank' AND NEW.paid_paisa>0 AND changes()!=1
 THEN RAISE(ABORT,'m05-bank-changed') END;
 UPDATE m05_suppliers SET payable_paisa=payable_paisa+NEW.due_paisa
 WHERE tenant_id=NEW.tenant_id AND supplier_id=NEW.supplier_id AND active=1
 AND NEW.due_paisa>0
 AND EXISTS(SELECT 1 FROM m05_party_links l WHERE l.tenant_id=NEW.tenant_id
 AND l.source_group='SUPPLIERS' AND l.source_id=NEW.supplier_id
 AND l.party_id=m05_suppliers.party_id AND l.reviewed=1);
 SELECT CASE WHEN NEW.due_paisa>0 AND changes()!=1 THEN RAISE(ABORT,'m05-supplier-link-stale') END;
 INSERT INTO m05_supplier_ledger
 SELECT NEW.tenant_id,NEW.purchase_id,NEW.supplier_id,NEW.due_paisa,s.payable_paisa
 FROM m05_suppliers s WHERE NEW.due_paisa>0
 AND s.tenant_id=NEW.tenant_id AND s.supplier_id=NEW.supplier_id;
 END`,
`CREATE TRIGGER m05_receipt_update_guard BEFORE UPDATE ON m05_purchases BEGIN SELECT RAISE(ABORT,'m05-immutable-receipt'); END`,
`CREATE TRIGGER m05_receipt_delete_guard BEFORE DELETE ON m05_purchases BEGIN SELECT RAISE(ABORT,'m05-immutable-receipt'); END`
];

export const M05_PURCHASE_SEED=[
["INSERT INTO m05_sessions VALUES('SHOP-A','Open')",[]],
["INSERT INTO m05_products VALUES('SHOP-A','PIPE',3,1,1,0,'Standard')",[]],
["INSERT INTO m05_products VALUES('SHOP-A','BUNDLE',0,1,1,0,'Bundle')",[]],
["INSERT INTO m05_suppliers VALUES('SHOP-A','SUP-1','PARTY-1',1,4000)",[]],
["INSERT INTO m05_party_links VALUES('SHOP-A','SUPPLIERS','SUP-1','PARTY-1',1)",[]],
["INSERT INTO m05_banks VALUES('SHOP-A','BANK-1',1)",[]],
["INSERT INTO m05_unrelated_accounts VALUES('PARTY-1',9000)",[]]
];
