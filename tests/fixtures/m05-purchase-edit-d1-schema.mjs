/**
 * M05 purchase edit: synthetic local Workerd D1 tables and triggers ONLY.
 * This is not a migration, production repository or new M07 correction engine.
 * One existing pair of SKUs, one immutable purchase, exactly one edit claim.
 * The original receipt and financial rows are immutable and auditable.
 */
export const M05ML_EDIT_DDL=[
`CREATE TABLE m05ml_edit_receipts(
 tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
 reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 new_items_json TEXT NOT NULL CHECK(json_valid(new_items_json) AND json_type(new_items_json)='array'),
 subtotal_paisa INTEGER NOT NULL CHECK(subtotal_paisa>=0),
 grand_paisa INTEGER NOT NULL CHECK(grand_paisa>=0),
 due_paisa INTEGER NOT NULL CHECK(due_paisa>=0),
 PRIMARY KEY(tenant_id,purchase_id),UNIQUE(tenant_id,operation_id)
) STRICT`,
`CREATE TABLE m05ml_edit_movements(
 tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,sku TEXT NOT NULL,
 qty_delta INTEGER NOT NULL,
 new_cost_paisa INTEGER NOT NULL CHECK(new_cost_paisa>=0),
 balance_stock INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,purchase_id,sku)
) STRICT`,
`CREATE TABLE m05ml_edit_audit(
 tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,supplier_id TEXT NOT NULL,reason TEXT NOT NULL,
 lines_changed INTEGER NOT NULL CHECK(lines_changed>0),
 old_due_paisa INTEGER NOT NULL CHECK(old_due_paisa>=0),
 new_due_paisa INTEGER NOT NULL CHECK(new_due_paisa>=0),
 PRIMARY KEY(tenant_id,purchase_id),UNIQUE(tenant_id,operation_id)
) STRICT`,
`CREATE VIEW m05ml_effective_purchase_items AS
 SELECT i.tenant_id,i.purchase_id,i.sku,
 COALESCE((SELECT json_extract(j.value,'$.qty')
   FROM m05ml_edit_receipts e,json_each(e.new_items_json) j
   WHERE e.tenant_id=i.tenant_id AND e.purchase_id=i.purchase_id
   AND json_extract(j.value,'$.sku')=i.sku),i.qty) AS qty,
 COALESCE((SELECT json_extract(j.value,'$.costPaisa')
   FROM m05ml_edit_receipts e,json_each(e.new_items_json) j
   WHERE e.tenant_id=i.tenant_id AND e.purchase_id=i.purchase_id
   AND json_extract(j.value,'$.sku')=i.sku),i.cost_paisa) AS cost_paisa
 FROM m05ml_items i
 WHERE NOT EXISTS(SELECT 1 FROM m05ml_delete_receipts d
   WHERE d.tenant_id=i.tenant_id AND d.purchase_id=i.purchase_id)`,
`CREATE VIEW m05ml_effective_supplier_ledger AS
 SELECT l.tenant_id,l.purchase_id,l.supplier_id,
 COALESCE(e.due_paisa,l.debit_paisa) AS debit_paisa
 FROM m05ml_active_supplier_ledger l
 LEFT JOIN m05ml_edit_receipts e ON e.tenant_id=l.tenant_id
 AND e.purchase_id=l.purchase_id`,
`CREATE TRIGGER m05ml_edit_prevents_prior_delete BEFORE INSERT ON m05ml_delete_receipts
 WHEN EXISTS(SELECT 1 FROM m05ml_edit_receipts e
 WHERE e.tenant_id=NEW.tenant_id AND e.purchase_id=NEW.purchase_id)
 BEGIN SELECT RAISE(IGNORE); END`,
`CREATE TRIGGER m05ml_atomic_edit AFTER INSERT ON m05ml_edit_receipts BEGIN
 -- The SQL boundary, not stale JS preflight, owns the authoritative guard.
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM m05ml_sessions s
 WHERE s.tenant_id=NEW.tenant_id AND s.state='Open')
 THEN RAISE(ABORT,'m05ml-edit-session-closed') END;

 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM m05ml_purchases p
 JOIN m05ml_suppliers s ON s.tenant_id=p.tenant_id
 AND s.supplier_id=p.supplier_id AND s.active=1
 JOIN m05ml_party_links l ON l.tenant_id=p.tenant_id
 AND l.source_group='SUPPLIERS' AND l.source_id=p.supplier_id
 AND l.party_id=s.party_id AND l.reviewed=1
 WHERE p.tenant_id=NEW.tenant_id AND p.purchase_id=NEW.purchase_id
 AND p.due_paisa>0
 AND p.grand_paisa>=p.paid_paisa
 AND NEW.grand_paisa=MAX(0,NEW.subtotal_paisa-p.discount_paisa)
 AND NEW.due_paisa=NEW.grand_paisa-p.paid_paisa)
 THEN RAISE(ABORT,'m05ml-edit-source-or-payable-invalid') END;

 SELECT CASE WHEN EXISTS(SELECT 1 FROM m05ml_delete_receipts d
 WHERE d.tenant_id=NEW.tenant_id AND d.purchase_id=NEW.purchase_id)
 THEN RAISE(ABORT,'m05ml-edit-already-deleted') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM m05ml_purchase_returns r
 WHERE r.tenant_id=NEW.tenant_id AND r.purchase_id=NEW.purchase_id AND r.active=1)
 THEN RAISE(ABORT,'m05ml-edit-active-return') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM m05ml_purchase_settlements st
 WHERE st.tenant_id=NEW.tenant_id AND st.purchase_id=NEW.purchase_id AND st.active=1)
 THEN RAISE(ABORT,'m05ml-edit-linked-settlement') END;

 -- Later same-supplier receipts require chronological ledger rebalancing.
 -- Do not pretend the original historical balance stays correct.
 SELECT CASE WHEN EXISTS(SELECT 1 FROM m05ml_purchases p
 JOIN m05ml_purchases later ON later.tenant_id=p.tenant_id
 AND later.supplier_id=p.supplier_id AND later.rowid>p.rowid
 JOIN m05ml_supplier_ledger sl ON sl.tenant_id=later.tenant_id
 AND sl.purchase_id=later.purchase_id
 WHERE p.tenant_id=NEW.tenant_id AND p.purchase_id=NEW.purchase_id)
 THEN RAISE(ABORT,'m05ml-edit-later-supplier-ledger') END;

 SELECT CASE WHEN (SELECT COUNT(*) FROM m05ml_items i
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id)=0
 OR (SELECT COUNT(*) FROM json_each(NEW.new_items_json))<>
    (SELECT COUNT(*) FROM m05ml_items i
     WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id)
 OR (SELECT COUNT(DISTINCT json_extract(j.value,'$.sku'))
    FROM json_each(NEW.new_items_json) j)<>
    (SELECT COUNT(*) FROM json_each(NEW.new_items_json))
 THEN RAISE(ABORT,'m05ml-edit-line-identity') END;

 SELECT CASE WHEN
 (SELECT COALESCE(SUM(
    json_extract(j.value,'$.qty')*json_extract(j.value,'$.costPaisa')),0)
  FROM json_each(NEW.new_items_json) j)<>NEW.subtotal_paisa
 THEN RAISE(ABORT,'m05ml-edit-subtotal-mismatch') END;

 SELECT CASE WHEN (SELECT COUNT(*) FROM m05ml_lots l
 WHERE l.tenant_id=NEW.tenant_id AND l.purchase_id=NEW.purchase_id)
 <>(SELECT COUNT(*) FROM m05ml_items i
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id)
 THEN RAISE(ABORT,'m05ml-edit-ambiguous-lots') END;

 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM json_each(NEW.new_items_json) j
 LEFT JOIN m05ml_items i ON i.tenant_id=NEW.tenant_id
 AND i.purchase_id=NEW.purchase_id AND i.sku=json_extract(j.value,'$.sku')
 LEFT JOIN m05ml_lots l ON l.tenant_id=i.tenant_id
 AND l.purchase_id=i.purchase_id AND l.sku=i.sku
 LEFT JOIN m05ml_products pr ON pr.tenant_id=i.tenant_id AND pr.sku=i.sku
 WHERE i.sku IS NULL OR l.lot_id IS NULL OR pr.sku IS NULL
 OR json_type(j.value,'$.qty')<>'integer'
 OR json_type(j.value,'$.costPaisa')<>'integer'
 OR json_type(j.value,'$.expectedVersion')<>'integer'
 OR json_extract(j.value,'$.qty')<1 OR json_extract(j.value,'$.costPaisa')<0
 OR pr.version<>json_extract(j.value,'$.expectedVersion')
 OR pr.active<>1 OR pr.deleted<>0 OR pr.product_type<>'Standard'
 OR l.qty<>i.qty OR l.remaining_qty<0 OR l.remaining_qty>l.qty
 OR (l.remaining_qty<l.qty AND json_extract(j.value,'$.costPaisa')<>l.cost_paisa)
 OR l.remaining_qty + json_extract(j.value,'$.qty')-i.qty<0
 OR (json_extract(j.value,'$.qty')<i.qty
     AND pr.stock + json_extract(j.value,'$.qty')-i.qty<0)
 ) THEN RAISE(ABORT,'m05ml-edit-stale-stock-lot-cost-or-version') END;

 -- The original source item/receipt remains immutable. Effective views use
 -- the sidecar claim. Stock and supplier mutation share one SQL statement.
 UPDATE m05ml_products SET
 stock=stock+(
  SELECT json_extract(j.value,'$.qty')-i.qty
  FROM json_each(NEW.new_items_json) j
  JOIN m05ml_items i ON i.tenant_id=NEW.tenant_id
  AND i.purchase_id=NEW.purchase_id AND i.sku=m05ml_products.sku
  WHERE json_extract(j.value,'$.sku')=i.sku),
 version=version+1
 WHERE tenant_id=NEW.tenant_id
 AND sku IN(SELECT i.sku FROM m05ml_items i
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id);
 SELECT CASE WHEN changes()<>(SELECT COUNT(*) FROM m05ml_items i
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id)
 THEN RAISE(ABORT,'m05ml-edit-product-stock-cas') END;

 INSERT INTO m05ml_edit_movements(
 tenant_id,purchase_id,sku,qty_delta,new_cost_paisa,balance_stock)
 SELECT i.tenant_id,i.purchase_id,i.sku,
 json_extract(j.value,'$.qty')-i.qty,
 json_extract(j.value,'$.costPaisa'),pr.stock
 FROM m05ml_items i
 JOIN json_each(NEW.new_items_json) j ON json_extract(j.value,'$.sku')=i.sku
 JOIN m05ml_products pr ON pr.tenant_id=i.tenant_id AND pr.sku=i.sku
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id;
 SELECT CASE WHEN changes()<>(SELECT COUNT(*) FROM m05ml_items i
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id)
 THEN RAISE(ABORT,'m05ml-edit-movement-not-recorded') END;

 UPDATE m05ml_lots SET
 qty=qty+(SELECT json_extract(j.value,'$.qty')-i.qty
  FROM json_each(NEW.new_items_json) j
  JOIN m05ml_items i ON i.tenant_id=NEW.tenant_id
   AND i.purchase_id=NEW.purchase_id AND i.sku=m05ml_lots.sku
  WHERE json_extract(j.value,'$.sku')=i.sku),
 remaining_qty=remaining_qty+(SELECT json_extract(j.value,'$.qty')-i.qty
  FROM json_each(NEW.new_items_json) j
  JOIN m05ml_items i ON i.tenant_id=NEW.tenant_id
   AND i.purchase_id=NEW.purchase_id AND i.sku=m05ml_lots.sku
  WHERE json_extract(j.value,'$.sku')=i.sku),
 cost_paisa=(SELECT json_extract(j.value,'$.costPaisa')
  FROM json_each(NEW.new_items_json) j
  WHERE json_extract(j.value,'$.sku')=m05ml_lots.sku)
 WHERE tenant_id=NEW.tenant_id AND purchase_id=NEW.purchase_id;
 SELECT CASE WHEN changes()<>(SELECT COUNT(*) FROM m05ml_items i
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id)
 THEN RAISE(ABORT,'m05ml-edit-lot-update-cas') END;

 UPDATE m05ml_suppliers SET payable_paisa=payable_paisa+NEW.due_paisa-
 (SELECT p.due_paisa FROM m05ml_purchases p
 WHERE p.tenant_id=NEW.tenant_id AND p.purchase_id=NEW.purchase_id)
 WHERE tenant_id=NEW.tenant_id AND active=1
 AND supplier_id=(SELECT p.supplier_id FROM m05ml_purchases p
 WHERE p.tenant_id=NEW.tenant_id AND p.purchase_id=NEW.purchase_id)
 AND EXISTS(SELECT 1 FROM m05ml_party_links l
 WHERE l.tenant_id=m05ml_suppliers.tenant_id
 AND l.source_group='SUPPLIERS' AND l.source_id=m05ml_suppliers.supplier_id
 AND l.party_id=m05ml_suppliers.party_id AND l.reviewed=1);
 SELECT CASE WHEN changes()!=1
 THEN RAISE(ABORT,'m05ml-edit-supplier-link-stale') END;

 -- Injecting a failure here proves the entire purchase edit rolls back.
 INSERT INTO m05ml_edit_audit(tenant_id,purchase_id,operation_id,
 actor_id,supplier_id,reason,lines_changed,old_due_paisa,new_due_paisa)
 SELECT NEW.tenant_id,NEW.purchase_id,NEW.operation_id,
 NEW.actor_id,p.supplier_id,NEW.reason,
 (SELECT COUNT(*) FROM m05ml_items i
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id),
 p.due_paisa,NEW.due_paisa
 FROM m05ml_purchases p WHERE p.tenant_id=NEW.tenant_id
 AND p.purchase_id=NEW.purchase_id;
 SELECT CASE WHEN changes()!=1
 THEN RAISE(ABORT,'m05ml-edit-audit-not-written') END;
 END`
];
