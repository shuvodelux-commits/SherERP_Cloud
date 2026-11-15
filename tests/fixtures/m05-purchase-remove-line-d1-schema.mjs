/**
 * M05 test-only local Workerd/D1 proof for removing one unsold purchase SKU.
 * NOT a migration, production repository or native M07 correction writer.
 * Original positive-quantity stock lots remain immutable; effective views
 * encode original-source zeroed lot when the entire line is removed.
 */
export const M05ML_REMOVE_DDL=[
`CREATE TABLE m05ml_remove_receipts(
 tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
 reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 sku TEXT NOT NULL,expected_version INTEGER NOT NULL CHECK(expected_version>0),
 removed_qty INTEGER NOT NULL CHECK(removed_qty>0),
 removed_cost_paisa INTEGER NOT NULL CHECK(removed_cost_paisa>=0),
 new_due_paisa INTEGER NOT NULL CHECK(new_due_paisa>=0),
 PRIMARY KEY(tenant_id,purchase_id),UNIQUE(tenant_id,operation_id)
) STRICT`,
`CREATE TABLE m05ml_remove_movements(
 tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,sku TEXT NOT NULL,
 lot_id TEXT NOT NULL,qty_out INTEGER NOT NULL CHECK(qty_out>0),
 balance_stock INTEGER NOT NULL CHECK(balance_stock>=0),
 PRIMARY KEY(tenant_id,purchase_id,sku)
) STRICT`,
`CREATE TABLE m05ml_remove_audit(
 tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,supplier_id TEXT NOT NULL,reason TEXT NOT NULL,
 purchase_date TEXT NOT NULL,old_due_paisa INTEGER NOT NULL,
 new_due_paisa INTEGER NOT NULL,paid_paisa INTEGER NOT NULL,
 lines_removed INTEGER NOT NULL CHECK(lines_removed=1),
 PRIMARY KEY(tenant_id,purchase_id),UNIQUE(tenant_id,operation_id)
) STRICT`,
`CREATE VIEW m05ml_effective_remove_items AS
 SELECT i.tenant_id,i.purchase_id,i.sku,i.qty,i.cost_paisa
 FROM m05ml_items i
 WHERE NOT EXISTS(SELECT 1 FROM m05ml_remove_receipts r
 WHERE r.tenant_id=i.tenant_id AND r.purchase_id=i.purchase_id
 AND r.sku=i.sku)
 AND NOT EXISTS(SELECT 1 FROM m05ml_delete_receipts d
 WHERE d.tenant_id=i.tenant_id AND d.purchase_id=i.purchase_id)`,
`CREATE VIEW m05ml_effective_remove_lots AS
 SELECT l.tenant_id,l.purchase_id,l.lot_id,l.sku,l.supplier_id,l.purchase_date,
 CASE WHEN r.sku=l.sku THEN 0 ELSE l.qty END AS qty,
 CASE WHEN r.sku=l.sku THEN 0 ELSE l.remaining_qty END AS remaining_qty,
 l.cost_paisa,l.sell_paisa
 FROM m05ml_lots l LEFT JOIN m05ml_remove_receipts r
 ON r.tenant_id=l.tenant_id AND r.purchase_id=l.purchase_id
 WHERE NOT EXISTS(SELECT 1 FROM m05ml_delete_receipts d
 WHERE d.tenant_id=l.tenant_id AND d.purchase_id=l.purchase_id)`,
`CREATE VIEW m05ml_effective_remove_supplier_ledger AS
 SELECT l.tenant_id,l.purchase_id,l.supplier_id,
 COALESCE(r.new_due_paisa,l.debit_paisa) AS debit_paisa
 FROM m05ml_active_supplier_ledger l
 LEFT JOIN m05ml_remove_receipts r
 ON r.tenant_id=l.tenant_id AND r.purchase_id=l.purchase_id`,
`CREATE TRIGGER m05ml_remove_blocks_delete BEFORE INSERT ON m05ml_delete_receipts
 WHEN EXISTS(SELECT 1 FROM m05ml_remove_receipts r
 WHERE r.tenant_id=NEW.tenant_id AND r.purchase_id=NEW.purchase_id)
 BEGIN SELECT RAISE(IGNORE); END`,
`CREATE TRIGGER m05ml_remove_blocks_edit BEFORE INSERT ON m05ml_edit_receipts
 WHEN EXISTS(SELECT 1 FROM m05ml_remove_receipts r
 WHERE r.tenant_id=NEW.tenant_id AND r.purchase_id=NEW.purchase_id)
 BEGIN SELECT RAISE(IGNORE); END`,
`CREATE TRIGGER m05ml_remove_blocks_add BEFORE INSERT ON m05ml_add_receipts
 WHEN EXISTS(SELECT 1 FROM m05ml_remove_receipts r
 WHERE r.tenant_id=NEW.tenant_id AND r.purchase_id=NEW.purchase_id)
 BEGIN SELECT RAISE(IGNORE); END`,
`CREATE TRIGGER m05ml_remove_authorize BEFORE INSERT ON m05ml_remove_receipts BEGIN
 -- Authoritative source and settlement guards INSIDE the SQLite claim.
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM m05ml_sessions s
 WHERE s.tenant_id=NEW.tenant_id AND s.state='Open')
 THEN RAISE(IGNORE) END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM m05ml_purchases p
 JOIN m05ml_suppliers s ON s.tenant_id=p.tenant_id AND s.supplier_id=p.supplier_id
 JOIN m05ml_party_links l ON l.tenant_id=p.tenant_id
 AND l.source_group='SUPPLIERS' AND l.source_id=s.supplier_id
 AND l.party_id=s.party_id AND l.reviewed=1
 WHERE p.tenant_id=NEW.tenant_id AND p.purchase_id=NEW.purchase_id
 AND s.active=1 AND p.due_paisa>0
 AND p.paid_paisa+p.due_paisa=p.grand_paisa
 AND p.due_paisa>=NEW.removed_qty*NEW.removed_cost_paisa
 AND NEW.new_due_paisa=p.due_paisa-NEW.removed_qty*NEW.removed_cost_paisa
 AND p.paid_paisa+NEW.new_due_paisa=
 MAX(0,p.subtotal_paisa-NEW.removed_qty*NEW.removed_cost_paisa-p.discount_paisa))
 THEN RAISE(IGNORE) END;

 SELECT CASE WHEN EXISTS(SELECT 1 FROM m05ml_delete_receipts d
 WHERE d.tenant_id=NEW.tenant_id AND d.purchase_id=NEW.purchase_id)
 OR EXISTS(SELECT 1 FROM m05ml_add_receipts a
 WHERE a.tenant_id=NEW.tenant_id AND a.purchase_id=NEW.purchase_id)
 OR EXISTS(SELECT 1 FROM m05ml_edit_receipts e
 WHERE e.tenant_id=NEW.tenant_id AND e.purchase_id=NEW.purchase_id)
 OR EXISTS(SELECT 1 FROM m05ml_purchase_returns rr
 WHERE rr.tenant_id=NEW.tenant_id AND rr.purchase_id=NEW.purchase_id AND rr.active=1)
 OR EXISTS(SELECT 1 FROM m05ml_purchase_settlements ss
 WHERE ss.tenant_id=NEW.tenant_id AND ss.purchase_id=NEW.purchase_id AND ss.active=1)
 THEN RAISE(IGNORE) END;

 SELECT CASE WHEN EXISTS(SELECT 1 FROM m05ml_purchases p
 JOIN m05ml_purchases later ON later.tenant_id=p.tenant_id
 AND later.supplier_id=p.supplier_id AND later.rowid>p.rowid
 JOIN m05ml_supplier_ledger sl ON sl.tenant_id=later.tenant_id
 AND sl.purchase_id=later.purchase_id
 WHERE p.tenant_id=NEW.tenant_id AND p.purchase_id=NEW.purchase_id)
 THEN RAISE(IGNORE) END;

 -- Keep at least one existing purchase line, and ensure own lot is UNSOLD.
 SELECT CASE WHEN
 (SELECT COUNT(*) FROM m05ml_items i
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id)<2
 OR NOT EXISTS(SELECT 1 FROM m05ml_items i
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id
 AND i.sku=NEW.sku AND i.qty=NEW.removed_qty
 AND i.cost_paisa=NEW.removed_cost_paisa)
 OR (SELECT COUNT(*) FROM m05ml_lots ll
 WHERE ll.tenant_id=NEW.tenant_id AND ll.purchase_id=NEW.purchase_id
 AND ll.sku=NEW.sku)<>1
 OR NOT EXISTS(SELECT 1 FROM m05ml_lots ll
 JOIN m05ml_items i ON i.tenant_id=ll.tenant_id
 AND i.purchase_id=ll.purchase_id AND i.sku=ll.sku
 WHERE ll.tenant_id=NEW.tenant_id AND ll.purchase_id=NEW.purchase_id
 AND ll.sku=NEW.sku AND ll.qty=i.qty AND ll.remaining_qty=ll.qty
 AND ll.cost_paisa=i.cost_paisa)
 THEN RAISE(IGNORE) END;

 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM m05ml_products p
 WHERE p.tenant_id=NEW.tenant_id AND p.sku=NEW.sku
 AND p.version=NEW.expected_version
 AND p.stock>=NEW.removed_qty AND p.active=1 AND p.deleted=0
 AND p.product_type='Standard')
 THEN RAISE(IGNORE) END;
 END`,
`CREATE TRIGGER m05ml_atomic_remove AFTER INSERT ON m05ml_remove_receipts BEGIN
 -- One SQLite INSERT owns every stock/lot-effective/Supplier/audit effect.
 UPDATE m05ml_products SET stock=stock-NEW.removed_qty,version=version+1
 WHERE tenant_id=NEW.tenant_id AND sku=NEW.sku
 AND version=NEW.expected_version AND stock>=NEW.removed_qty
 AND active=1 AND deleted=0 AND product_type='Standard';
 SELECT CASE WHEN changes()!=1
 THEN RAISE(ABORT,'m05ml-remove-stale-stock') END;

 INSERT INTO m05ml_remove_movements(
 tenant_id,purchase_id,sku,lot_id,qty_out,balance_stock)
 SELECT NEW.tenant_id,NEW.purchase_id,NEW.sku,ll.lot_id,
 NEW.removed_qty,pr.stock FROM m05ml_lots ll
 JOIN m05ml_products pr ON pr.tenant_id=ll.tenant_id AND pr.sku=ll.sku
 WHERE ll.tenant_id=NEW.tenant_id AND ll.purchase_id=NEW.purchase_id
 AND ll.sku=NEW.sku AND ll.qty=NEW.removed_qty
 AND ll.remaining_qty=ll.qty;
 SELECT CASE WHEN changes()!=1
 THEN RAISE(ABORT,'m05ml-remove-movement-missing') END;

 UPDATE m05ml_suppliers SET payable_paisa=
 payable_paisa-NEW.removed_qty*NEW.removed_cost_paisa
 WHERE tenant_id=NEW.tenant_id AND active=1 AND supplier_id=(
 SELECT p.supplier_id FROM m05ml_purchases p
 WHERE p.tenant_id=NEW.tenant_id AND p.purchase_id=NEW.purchase_id)
 AND EXISTS(SELECT 1 FROM m05ml_party_links l
 WHERE l.tenant_id=m05ml_suppliers.tenant_id
 AND l.source_group='SUPPLIERS' AND l.source_id=m05ml_suppliers.supplier_id
 AND l.party_id=m05ml_suppliers.party_id AND l.reviewed=1);
 SELECT CASE WHEN changes()!=1
 THEN RAISE(ABORT,'m05ml-remove-supplier-link-changed') END;

 -- Audit is last: failure ABORT undoes receipt, product, movement and payable.
 INSERT INTO m05ml_remove_audit(
 tenant_id,purchase_id,operation_id,actor_id,supplier_id,reason,
 purchase_date,old_due_paisa,new_due_paisa,paid_paisa,lines_removed)
 SELECT NEW.tenant_id,NEW.purchase_id,NEW.operation_id,NEW.actor_id,
 p.supplier_id,NEW.reason,p.purchase_date,p.due_paisa,
 NEW.new_due_paisa,p.paid_paisa,1
 FROM m05ml_purchases p WHERE p.tenant_id=NEW.tenant_id
 AND p.purchase_id=NEW.purchase_id;
 SELECT CASE WHEN changes()!=1
 THEN RAISE(ABORT,'m05ml-remove-audit-missing') END;
 END`
];
