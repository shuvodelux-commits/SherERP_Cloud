/**
 * M07-B2 only: disposable local Workerd/D1 Supplier Credit Purchase Return.
 * M05's unsigned/synthetic supplier payable is NOT the authoritative signed
 * future M08 account. Never apply this schema as a production migration.
 */
export const M07_PURCHASE_CREDIT_DDL=[
`CREATE TABLE m07_purchase_supplier_signed(
 tenant_id TEXT NOT NULL,supplier_id TEXT NOT NULL,party_id TEXT NOT NULL,
 signed_due_paisa INTEGER NOT NULL CHECK(signed_due_paisa BETWEEN -1000000000000 AND 1000000000000),
 active INTEGER NOT NULL CHECK(active IN (0,1)),
 PRIMARY KEY(tenant_id,supplier_id)) STRICT`,
`CREATE TABLE m07_purchase_credit_returns(
 tenant_id TEXT NOT NULL,return_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,purchase_id TEXT NOT NULL,supplier_id TEXT NOT NULL,
 sku TEXT NOT NULL,lot_id TEXT NOT NULL,
 source_hash TEXT NOT NULL CHECK(length(source_hash)=64),
 intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
 units INTEGER NOT NULL CHECK(units>0),
 credit_paisa INTEGER NOT NULL CHECK(credit_paisa>0),
 reason TEXT NOT NULL CHECK(length(reason)>0 AND length(reason)<=200),
 PRIMARY KEY(tenant_id,return_id),UNIQUE(tenant_id,operation_id)) STRICT`,
`CREATE TABLE m07_purchase_credit_ledger(
 tenant_id TEXT NOT NULL,return_id TEXT NOT NULL,purchase_id TEXT NOT NULL,
 supplier_id TEXT NOT NULL,party_id TEXT NOT NULL,
 credit_paisa INTEGER NOT NULL CHECK(credit_paisa>0),
 balance_paisa INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,return_id)) STRICT`,
`CREATE TRIGGER m07_purchase_credit_guard BEFORE INSERT ON m07_purchase_credit_returns BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM m05_sessions s
  WHERE s.tenant_id=NEW.tenant_id AND s.state='Open')
 THEN RAISE(IGNORE) END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM m07_purchase_cash_returns prior
  WHERE prior.tenant_id=NEW.tenant_id AND
  (prior.operation_id=NEW.operation_id OR prior.return_id=NEW.return_id))
 THEN RAISE(IGNORE) END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM m05_purchases p
  JOIN m05_items i ON i.tenant_id=p.tenant_id AND i.purchase_id=p.purchase_id
   AND i.sku=p.sku AND i.qty=p.qty AND i.unit_cost_paisa=p.unit_cost_paisa
  JOIN m05_movements movement ON movement.tenant_id=p.tenant_id
   AND movement.purchase_id=p.purchase_id AND movement.sku=p.sku
   AND movement.units_in=p.qty AND movement.lot_id=NEW.lot_id
  JOIN m05_lots original ON original.tenant_id=p.tenant_id
   AND original.purchase_id=p.purchase_id AND original.supplier_id=p.supplier_id
   AND original.sku=p.sku AND original.lot_id=NEW.lot_id
   AND original.qty=p.qty AND original.unit_cost_paisa=p.unit_cost_paisa
   AND original.purchase_date=p.purchase_date
  JOIN m07_purchase_lot_balances balance ON balance.tenant_id=p.tenant_id
   AND balance.purchase_id=p.purchase_id AND balance.sku=p.sku
   AND balance.lot_id=original.lot_id
  JOIN m05_products product ON product.tenant_id=p.tenant_id AND product.sku=p.sku
   AND product.active=1 AND product.deleted=0 AND product.product_type='Standard'
  JOIN m05_suppliers supplier ON supplier.tenant_id=p.tenant_id
   AND supplier.supplier_id=p.supplier_id AND supplier.active=1
  JOIN m05_party_links link ON link.tenant_id=supplier.tenant_id
   AND link.source_group='SUPPLIERS' AND link.source_id=supplier.supplier_id
   AND link.party_id=supplier.party_id AND link.reviewed=1
  JOIN m07_purchase_supplier_signed signed ON signed.tenant_id=p.tenant_id
   AND signed.supplier_id=p.supplier_id
   AND signed.party_id=supplier.party_id AND signed.active=1
  WHERE p.tenant_id=NEW.tenant_id AND p.purchase_id=NEW.purchase_id
   AND p.supplier_id=NEW.supplier_id AND p.sku=NEW.sku
   AND p.intent_hash=NEW.source_hash
   AND p.grand_paisa=p.qty*p.unit_cost_paisa-p.discount_paisa
   AND p.grand_paisa>0
   AND p.grand_paisa*NEW.units=NEW.credit_paisa*p.qty
   AND balance.remaining>=NEW.units AND balance.remaining<=original.qty
   AND product.stock>=NEW.units
 ) THEN RAISE(IGNORE) END;
 END`,
`CREATE TRIGGER m07_purchase_credit_commit AFTER INSERT ON m07_purchase_credit_returns BEGIN
 UPDATE m07_purchase_lot_balances SET remaining=remaining-NEW.units
 WHERE tenant_id=NEW.tenant_id AND lot_id=NEW.lot_id
   AND purchase_id=NEW.purchase_id AND sku=NEW.sku AND remaining>=NEW.units;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-credit-source-lot-race') END;
 UPDATE m05_products SET stock=stock-NEW.units,version=version+1
 WHERE tenant_id=NEW.tenant_id AND sku=NEW.sku
   AND active=1 AND deleted=0 AND product_type='Standard' AND stock>=NEW.units;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-credit-stock-race') END;
 INSERT INTO m07_purchase_return_moves
 SELECT NEW.tenant_id,NEW.return_id,NEW.purchase_id,NEW.lot_id,
  NEW.sku,NEW.units,product.stock
 FROM m05_products product WHERE product.tenant_id=NEW.tenant_id AND product.sku=NEW.sku;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-credit-stock-movement-missing') END;
 UPDATE m07_purchase_supplier_signed SET signed_due_paisa=signed_due_paisa-NEW.credit_paisa
 WHERE tenant_id=NEW.tenant_id AND supplier_id=NEW.supplier_id AND active=1
 AND EXISTS(SELECT 1 FROM m05_suppliers s
  JOIN m05_party_links link ON link.tenant_id=s.tenant_id
   AND link.source_group='SUPPLIERS'
   AND link.source_id=s.supplier_id
   AND link.party_id=s.party_id AND link.reviewed=1
  WHERE s.tenant_id=NEW.tenant_id AND s.supplier_id=NEW.supplier_id AND s.active=1
   AND s.party_id=m07_purchase_supplier_signed.party_id);
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-credit-supplier-identity-changed') END;
 INSERT INTO m07_purchase_credit_ledger
 SELECT NEW.tenant_id,NEW.return_id,NEW.purchase_id,NEW.supplier_id,
  signed.party_id,NEW.credit_paisa,signed.signed_due_paisa
 FROM m07_purchase_supplier_signed signed WHERE signed.tenant_id=NEW.tenant_id
   AND signed.supplier_id=NEW.supplier_id AND signed.active=1;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-credit-ledger-missing') END;
 END`,
`CREATE TRIGGER m07_purchase_cash_guard_existing_credit
 BEFORE INSERT ON m07_purchase_cash_returns BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM m07_purchase_credit_returns prior
  WHERE prior.tenant_id=NEW.tenant_id
   AND (prior.return_id=NEW.return_id OR prior.operation_id=NEW.operation_id))
 THEN RAISE(IGNORE) END;
 END`,
`CREATE TRIGGER m07_purchase_credit_immutable_update BEFORE UPDATE ON m07_purchase_credit_returns
 BEGIN SELECT RAISE(ABORT,'m07-purchase-credit-immutable'); END`,
`CREATE TRIGGER m07_purchase_credit_immutable_delete BEFORE DELETE ON m07_purchase_credit_returns
 BEGIN SELECT RAISE(ABORT,'m07-purchase-credit-immutable'); END`
];
