/** M07-B5 disposable Workerd/D1 fixture; NOT a production migration. */
export const M07_PURCHASE_CREDIT_DELETE_DDL=[
`CREATE TABLE m07_purchase_credit_delete_receipts(
 tenant_id TEXT NOT NULL,return_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,purchase_id TEXT NOT NULL,supplier_id TEXT NOT NULL,
 sku TEXT NOT NULL,lot_id TEXT NOT NULL,
 source_hash TEXT NOT NULL CHECK(length(source_hash)=64),
 intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
 units INTEGER NOT NULL CHECK(units>0),
 credit_paisa INTEGER NOT NULL CHECK(credit_paisa>0),
 reason TEXT NOT NULL CHECK(length(reason)>0 AND length(reason)<=200),
 PRIMARY KEY(tenant_id,return_id),UNIQUE(tenant_id,operation_id)) STRICT`,
`CREATE TABLE m07_purchase_credit_delete_moves(
 tenant_id TEXT NOT NULL,return_id TEXT NOT NULL,purchase_id TEXT NOT NULL,
 lot_id TEXT NOT NULL,sku TEXT NOT NULL,units_in INTEGER NOT NULL CHECK(units_in>0),
 balance_stock INTEGER NOT NULL CHECK(balance_stock>=0),
 PRIMARY KEY(tenant_id,return_id)) STRICT`,
`CREATE TABLE m07_purchase_credit_delete_ledger(
 tenant_id TEXT NOT NULL,return_id TEXT NOT NULL,purchase_id TEXT NOT NULL,
 supplier_id TEXT NOT NULL,party_id TEXT NOT NULL,
 debit_paisa INTEGER NOT NULL CHECK(debit_paisa>0),
 balance_paisa INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,return_id)) STRICT`,
`CREATE TABLE m07_purchase_credit_delete_dependencies(
 tenant_id TEXT NOT NULL,return_id TEXT NOT NULL,supplier_id TEXT NOT NULL,
 activity_id TEXT NOT NULL,PRIMARY KEY(tenant_id,return_id,activity_id)) STRICT`,
`CREATE VIEW m07_active_purchase_credit_returns AS
 SELECT r.* FROM m07_purchase_credit_returns r
 WHERE NOT EXISTS(SELECT 1 FROM m07_purchase_credit_delete_receipts d
   WHERE d.tenant_id=r.tenant_id AND d.return_id=r.return_id)`,
`CREATE TRIGGER m07_purchase_credit_delete_commit
 AFTER INSERT ON m07_purchase_credit_delete_receipts BEGIN
 UPDATE m07_purchase_lot_balances SET remaining=remaining+NEW.units
 WHERE tenant_id=NEW.tenant_id AND purchase_id=NEW.purchase_id
  AND lot_id=NEW.lot_id AND sku=NEW.sku
  AND remaining+NEW.units<=(SELECT qty FROM m05_lots
   WHERE tenant_id=NEW.tenant_id AND purchase_id=NEW.purchase_id
    AND lot_id=NEW.lot_id AND sku=NEW.sku);
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-credit-delete-original-lot') END;
 UPDATE m05_products SET stock=stock+NEW.units,version=version+1
 WHERE tenant_id=NEW.tenant_id AND sku=NEW.sku
  AND active=1 AND deleted=0 AND product_type='Standard';
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-credit-delete-original-product') END;
 INSERT INTO m07_purchase_credit_delete_moves
 SELECT NEW.tenant_id,NEW.return_id,NEW.purchase_id,NEW.lot_id,
  NEW.sku,NEW.units,product.stock FROM m05_products product
 WHERE product.tenant_id=NEW.tenant_id AND product.sku=NEW.sku;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-credit-delete-stock-evidence') END;
 UPDATE m07_purchase_supplier_signed SET signed_due_paisa=signed_due_paisa+NEW.credit_paisa
 WHERE tenant_id=NEW.tenant_id AND supplier_id=NEW.supplier_id AND active=1
  AND signed_due_paisa=(SELECT balance_paisa FROM m07_purchase_credit_ledger
   WHERE tenant_id=NEW.tenant_id AND return_id=NEW.return_id)
  AND party_id=(SELECT party_id FROM m07_purchase_credit_ledger
   WHERE tenant_id=NEW.tenant_id AND return_id=NEW.return_id)
  AND EXISTS(SELECT 1 FROM m05_suppliers s
   JOIN m05_party_links l ON l.tenant_id=s.tenant_id
    AND l.source_group='SUPPLIERS' AND l.source_id=s.supplier_id
    AND l.party_id=s.party_id AND l.reviewed=1
   WHERE s.tenant_id=NEW.tenant_id AND s.supplier_id=NEW.supplier_id
    AND s.active=1 AND s.party_id=m07_purchase_supplier_signed.party_id);
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-credit-delete-supplier-stale') END;
 INSERT INTO m07_purchase_credit_delete_ledger
 SELECT NEW.tenant_id,NEW.return_id,NEW.purchase_id,NEW.supplier_id,
  a.party_id,NEW.credit_paisa,a.signed_due_paisa
 FROM m07_purchase_supplier_signed a
 WHERE a.tenant_id=NEW.tenant_id AND a.supplier_id=NEW.supplier_id
  AND a.active=1;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-credit-delete-ledger-missing') END;
 END`
];
export const M07_PURCHASE_CREDIT_DELETE_IMMUTABLE_TABLES=[
 'm07_purchase_credit_delete_receipts',
 'm07_purchase_credit_delete_moves',
 'm07_purchase_credit_delete_ledger'
];
export const M07_PURCHASE_CREDIT_DELETE_IMMUTABLE_DDL=
 M07_PURCHASE_CREDIT_DELETE_IMMUTABLE_TABLES.flatMap(name=>[
  `CREATE TRIGGER ${name}_immutable_update BEFORE UPDATE ON ${name}
   BEGIN SELECT RAISE(ABORT,'m07-immutable-supplier-correction'); END`,
  `CREATE TRIGGER ${name}_immutable_delete BEFORE DELETE ON ${name}
   BEGIN SELECT RAISE(ABORT,'m07-immutable-supplier-correction'); END`
 ]);
