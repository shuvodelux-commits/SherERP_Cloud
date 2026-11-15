/**
 * M05 TEST ONLY: add a single *new* SKU to an immutable posted purchase.
 * Local m05ml_* Workerd/D1 only; never deploy as production M03/M07 SQL.
 * A BEFORE trigger rejects stale/dependent inputs within SQLite. The AFTER
 * trigger atomically posts the new purchase lot, stock, payable and audit.
 */
export const M05ML_ADD_DDL=[
`CREATE TABLE m05ml_add_receipts(
 tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
 reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 sku TEXT NOT NULL,qty INTEGER NOT NULL CHECK(qty>0),
 cost_paisa INTEGER NOT NULL CHECK(cost_paisa>=0),
 sell_paisa INTEGER NOT NULL CHECK(sell_paisa>=0),
 expected_version INTEGER NOT NULL CHECK(expected_version>0),
 new_due_paisa INTEGER NOT NULL CHECK(new_due_paisa>=0),
 PRIMARY KEY(tenant_id,purchase_id),UNIQUE(tenant_id,operation_id)
) STRICT`,
`CREATE TABLE m05ml_add_movements(
 tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,sku TEXT NOT NULL,
 lot_id TEXT NOT NULL,qty_in INTEGER NOT NULL CHECK(qty_in>0),
 balance_stock INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,purchase_id,sku)
) STRICT`,
`CREATE TABLE m05ml_add_audit(
 tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,supplier_id TEXT NOT NULL,reason TEXT NOT NULL,
 purchase_date TEXT NOT NULL,old_due_paisa INTEGER NOT NULL,
 new_due_paisa INTEGER NOT NULL,paid_paisa INTEGER NOT NULL,
 lines_added INTEGER NOT NULL CHECK(lines_added=1),
 PRIMARY KEY(tenant_id,purchase_id),UNIQUE(tenant_id,operation_id)
) STRICT`,
`CREATE VIEW m05ml_effective_add_items AS
 SELECT i.tenant_id,i.purchase_id,i.sku,i.qty,i.cost_paisa
 FROM m05ml_items i
 WHERE NOT EXISTS(SELECT 1 FROM m05ml_delete_receipts d
   WHERE d.tenant_id=i.tenant_id AND d.purchase_id=i.purchase_id)
 UNION ALL
 SELECT a.tenant_id,a.purchase_id,a.sku,a.qty,a.cost_paisa
 FROM m05ml_add_receipts a
 WHERE NOT EXISTS(SELECT 1 FROM m05ml_delete_receipts d
   WHERE d.tenant_id=a.tenant_id AND d.purchase_id=a.purchase_id)`,
`CREATE VIEW m05ml_effective_add_supplier_ledger AS
 SELECT l.tenant_id,l.purchase_id,l.supplier_id,
 COALESCE(a.new_due_paisa,l.debit_paisa) AS debit_paisa
 FROM m05ml_active_supplier_ledger l
 LEFT JOIN m05ml_add_receipts a ON a.tenant_id=l.tenant_id
 AND a.purchase_id=l.purchase_id`,
`CREATE TRIGGER m05ml_add_blocks_delete BEFORE INSERT ON m05ml_delete_receipts
 WHEN EXISTS(SELECT 1 FROM m05ml_add_receipts a
 WHERE a.tenant_id=NEW.tenant_id AND a.purchase_id=NEW.purchase_id)
 BEGIN SELECT RAISE(IGNORE); END`,
`CREATE TRIGGER m05ml_add_blocks_existing_edit BEFORE INSERT ON m05ml_edit_receipts
 WHEN EXISTS(SELECT 1 FROM m05ml_add_receipts a
 WHERE a.tenant_id=NEW.tenant_id AND a.purchase_id=NEW.purchase_id)
 BEGIN SELECT RAISE(IGNORE); END`,
`CREATE TRIGGER m05ml_add_authorize BEFORE INSERT ON m05ml_add_receipts BEGIN
 -- Reject within the same SQLite statement, not from stale JS preflight.
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM m05ml_sessions s
 WHERE s.tenant_id=NEW.tenant_id AND s.state='Open')
 THEN RAISE(IGNORE) END;
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM m05ml_purchases p
 JOIN m05ml_suppliers s ON s.tenant_id=p.tenant_id AND s.supplier_id=p.supplier_id
 JOIN m05ml_party_links l ON l.tenant_id=p.tenant_id
 AND l.source_group='SUPPLIERS' AND l.source_id=s.supplier_id
 AND l.party_id=s.party_id AND l.reviewed=1
 WHERE p.tenant_id=NEW.tenant_id AND p.purchase_id=NEW.purchase_id
 AND p.due_paisa>0 AND s.active=1
 AND NEW.new_due_paisa=p.due_paisa+NEW.qty*NEW.cost_paisa
 AND p.paid_paisa+p.due_paisa=p.grand_paisa)
 THEN RAISE(IGNORE) END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM m05ml_delete_receipts d
 WHERE d.tenant_id=NEW.tenant_id AND d.purchase_id=NEW.purchase_id)
 OR EXISTS(SELECT 1 FROM m05ml_edit_receipts e
 WHERE e.tenant_id=NEW.tenant_id AND e.purchase_id=NEW.purchase_id)
 OR EXISTS(SELECT 1 FROM m05ml_purchase_returns x
 WHERE x.tenant_id=NEW.tenant_id AND x.purchase_id=NEW.purchase_id AND x.active=1)
 OR EXISTS(SELECT 1 FROM m05ml_purchase_settlements x
 WHERE x.tenant_id=NEW.tenant_id AND x.purchase_id=NEW.purchase_id AND x.active=1)
 THEN RAISE(IGNORE) END;
 -- Do not leave a later Supplier running balance stale.
 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM m05ml_purchases p JOIN m05ml_purchases later
 ON later.tenant_id=p.tenant_id AND later.supplier_id=p.supplier_id
 AND later.rowid>p.rowid
 JOIN m05ml_supplier_ledger sl ON sl.tenant_id=later.tenant_id
 AND sl.purchase_id=later.purchase_id
 WHERE p.tenant_id=NEW.tenant_id AND p.purchase_id=NEW.purchase_id)
 THEN RAISE(IGNORE) END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM m05ml_items i
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id)
 OR EXISTS(SELECT 1 FROM m05ml_items i
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id
 AND i.sku=NEW.sku)
 OR EXISTS(SELECT 1 FROM m05ml_lots l
 WHERE l.tenant_id=NEW.tenant_id AND l.purchase_id=NEW.purchase_id
 AND l.sku=NEW.sku)
 THEN RAISE(IGNORE) END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM m05ml_products p
 WHERE p.tenant_id=NEW.tenant_id AND p.sku=NEW.sku
 AND p.version=NEW.expected_version
 AND p.active=1 AND p.deleted=0 AND p.product_type='Standard')
 THEN RAISE(IGNORE) END;
 END`,
`CREATE TRIGGER m05ml_atomic_add AFTER INSERT ON m05ml_add_receipts BEGIN
 UPDATE m05ml_products SET stock=stock+NEW.qty,version=version+1
 WHERE tenant_id=NEW.tenant_id AND sku=NEW.sku
 AND version=NEW.expected_version
 AND active=1 AND deleted=0 AND product_type='Standard';
 SELECT CASE WHEN changes()!=1
 THEN RAISE(ABORT,'m05ml-add-stale-product') END;
 INSERT INTO m05ml_lots(
 tenant_id,lot_id,purchase_id,supplier_id,sku,purchase_date,
 qty,remaining_qty,cost_paisa,sell_paisa)
 SELECT NEW.tenant_id,'LOT-'||NEW.purchase_id||'-'||NEW.sku,
 NEW.purchase_id,p.supplier_id,NEW.sku,p.purchase_date,
 NEW.qty,NEW.qty,NEW.cost_paisa,NEW.sell_paisa
 FROM m05ml_purchases p WHERE p.tenant_id=NEW.tenant_id
 AND p.purchase_id=NEW.purchase_id;
 SELECT CASE WHEN changes()!=1
 THEN RAISE(ABORT,'m05ml-add-new-lot-missing') END;
 INSERT INTO m05ml_add_movements(
 tenant_id,purchase_id,sku,lot_id,qty_in,balance_stock)
 SELECT NEW.tenant_id,NEW.purchase_id,NEW.sku,
 'LOT-'||NEW.purchase_id||'-'||NEW.sku,NEW.qty,pr.stock
 FROM m05ml_products pr WHERE pr.tenant_id=NEW.tenant_id AND pr.sku=NEW.sku;
 SELECT CASE WHEN changes()!=1
 THEN RAISE(ABORT,'m05ml-add-movement-write') END;

 UPDATE m05ml_suppliers SET payable_paisa=payable_paisa+NEW.qty*NEW.cost_paisa
 WHERE tenant_id=NEW.tenant_id AND active=1 AND supplier_id=(
 SELECT p.supplier_id FROM m05ml_purchases p
 WHERE p.tenant_id=NEW.tenant_id AND p.purchase_id=NEW.purchase_id)
 AND EXISTS(SELECT 1 FROM m05ml_party_links l
 WHERE l.tenant_id=m05ml_suppliers.tenant_id
 AND l.source_group='SUPPLIERS' AND l.source_id=m05ml_suppliers.supplier_id
 AND l.party_id=m05ml_suppliers.party_id AND l.reviewed=1);
 SELECT CASE WHEN changes()!=1
 THEN RAISE(ABORT,'m05ml-add-supplier-link-stale') END;

 -- Forced audit failure rolls back even stock, lot and Supplier updates.
 INSERT INTO m05ml_add_audit(
 tenant_id,purchase_id,operation_id,actor_id,supplier_id,reason,
 purchase_date,old_due_paisa,new_due_paisa,paid_paisa,lines_added)
 SELECT NEW.tenant_id,NEW.purchase_id,NEW.operation_id,NEW.actor_id,
 p.supplier_id,NEW.reason,p.purchase_date,p.due_paisa,
 NEW.new_due_paisa,p.paid_paisa,1
 FROM m05ml_purchases p WHERE p.tenant_id=NEW.tenant_id
 AND p.purchase_id=NEW.purchase_id;
 SELECT CASE WHEN changes()!=1
 THEN RAISE(ABORT,'m05ml-add-audit-write') END;
 END`
];
