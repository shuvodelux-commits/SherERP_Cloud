/**
 * Local M05 synthetic D1 purchase-delete proof. Not a production migration.
 * Sidecar soft-deletion preserves immutable purchase, original cash/bank and
 * supplier ledger rows for audit, while active views exclude voided records.
 * Only one original source purchase per receipt, and one lot per SKU.
 */
export const M05ML_DELETE_DDL=[
`CREATE TABLE m05ml_purchase_returns(
 tenant_id TEXT NOT NULL,return_id TEXT NOT NULL,purchase_id TEXT NOT NULL,
 active INTEGER NOT NULL CHECK(active IN (0,1)),
 PRIMARY KEY(tenant_id,return_id)
) STRICT`,
`CREATE TABLE m05ml_purchase_settlements(
 tenant_id TEXT NOT NULL,settlement_id TEXT NOT NULL,purchase_id TEXT NOT NULL,
 allocated_paisa INTEGER NOT NULL CHECK(allocated_paisa>0),
 active INTEGER NOT NULL CHECK(active IN (0,1)),
 PRIMARY KEY(tenant_id,settlement_id)
) STRICT`,
`CREATE TABLE m05ml_delete_receipts(
 tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
 reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 deleted_at TEXT NOT NULL CHECK(length(deleted_at)=10),
 due_reversed_paisa INTEGER NOT NULL CHECK(due_reversed_paisa>=0),
 PRIMARY KEY(tenant_id,purchase_id),UNIQUE(tenant_id,operation_id)
) STRICT`,
`CREATE TABLE m05ml_delete_movements(
 tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,sku TEXT NOT NULL,
 units_out INTEGER NOT NULL CHECK(units_out>0),
 balance_stock INTEGER NOT NULL CHECK(balance_stock>=0),
 PRIMARY KEY(tenant_id,purchase_id,sku)
) STRICT`,
`CREATE TABLE m05ml_delete_audit(
 tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 supplier_id TEXT NOT NULL,actor_id TEXT NOT NULL,reason TEXT NOT NULL,
 lines_reversed INTEGER NOT NULL CHECK(lines_reversed>0),
 due_reversed_paisa INTEGER NOT NULL CHECK(due_reversed_paisa>=0),
 paid_voided_paisa INTEGER NOT NULL CHECK(paid_voided_paisa>=0),
 PRIMARY KEY(tenant_id,purchase_id),UNIQUE(tenant_id,operation_id)
) STRICT`,
`CREATE VIEW m05ml_active_cash_book AS
 SELECT c.* FROM m05ml_cash_book c
 WHERE NOT EXISTS(SELECT 1 FROM m05ml_delete_receipts d
 WHERE d.tenant_id=c.tenant_id AND d.purchase_id=c.purchase_id)`,
`CREATE VIEW m05ml_active_bank_book AS
 SELECT b.* FROM m05ml_bank_book b
 WHERE NOT EXISTS(SELECT 1 FROM m05ml_delete_receipts d
 WHERE d.tenant_id=b.tenant_id AND d.purchase_id=b.purchase_id)`,
`CREATE VIEW m05ml_active_supplier_ledger AS
 SELECT l.* FROM m05ml_supplier_ledger l
 WHERE NOT EXISTS(SELECT 1 FROM m05ml_delete_receipts d
 WHERE d.tenant_id=l.tenant_id AND d.purchase_id=l.purchase_id)`,
`CREATE TRIGGER m05ml_atomic_delete AFTER INSERT ON m05ml_delete_receipts BEGIN
 -- A stale JS preview never authorizes a reversal. Recheck under SQL lock.
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM m05ml_sessions s
 WHERE s.tenant_id=NEW.tenant_id AND s.state='Open')
 THEN RAISE(ABORT,'m05ml-delete-session-closed') END;

 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM m05ml_purchases p
 JOIN m05ml_suppliers s ON s.tenant_id=p.tenant_id AND s.supplier_id=p.supplier_id
 JOIN m05ml_party_links l ON l.tenant_id=s.tenant_id
 AND l.source_group='SUPPLIERS' AND l.source_id=s.supplier_id
 AND l.party_id=s.party_id AND l.reviewed=1
 WHERE p.tenant_id=NEW.tenant_id AND p.purchase_id=NEW.purchase_id
 AND s.active=1 AND p.due_paisa=NEW.due_reversed_paisa)
 THEN RAISE(ABORT,'m05ml-delete-source-supplier-mismatch') END;

 SELECT CASE WHEN EXISTS(SELECT 1 FROM m05ml_purchase_returns r
 WHERE r.tenant_id=NEW.tenant_id AND r.purchase_id=NEW.purchase_id AND r.active=1)
 THEN RAISE(ABORT,'m05ml-delete-has-return') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM m05ml_purchase_settlements s
 WHERE s.tenant_id=NEW.tenant_id AND s.purchase_id=NEW.purchase_id AND s.active=1)
 THEN RAISE(ABORT,'m05ml-delete-settlement-dependent') END;

 SELECT CASE WHEN (SELECT COUNT(*) FROM m05ml_items i
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id)=0
 THEN RAISE(ABORT,'m05ml-delete-empty-source-items') END;
 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM m05ml_items i
 LEFT JOIN m05ml_lots l ON l.tenant_id=i.tenant_id
 AND l.purchase_id=i.purchase_id AND l.sku=i.sku
 LEFT JOIN m05ml_products p ON p.tenant_id=i.tenant_id AND p.sku=i.sku
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id
 AND (l.lot_id IS NULL OR l.qty<>i.qty OR l.remaining_qty<>l.qty
 OR p.sku IS NULL OR p.stock<i.qty OR p.active<>1 OR p.deleted<>0
 OR p.product_type<>'Standard'))
 THEN RAISE(ABORT,'m05ml-delete-stock-or-lot-unavailable') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM m05ml_lots l
 WHERE l.tenant_id=NEW.tenant_id AND l.purchase_id=NEW.purchase_id)
 <>(SELECT COUNT(*) FROM m05ml_items i
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id)
 THEN RAISE(ABORT,'m05ml-delete-ambiguous-lots') END;

 -- Reversal is a single SQLite statement with the receipt insertion.
 UPDATE m05ml_products SET
 stock=stock-(SELECT i.qty FROM m05ml_items i
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id
 AND i.sku=m05ml_products.sku),
 version=version+1
 WHERE tenant_id=NEW.tenant_id AND active=1 AND deleted=0
 AND product_type='Standard'
 AND sku IN(SELECT i.sku FROM m05ml_items i
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id)
 AND stock>=(SELECT i.qty FROM m05ml_items i
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id
 AND i.sku=m05ml_products.sku);
 SELECT CASE WHEN changes()<>(SELECT COUNT(*) FROM m05ml_items i
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id)
 THEN RAISE(ABORT,'m05ml-delete-stale-stock-cas') END;

 INSERT INTO m05ml_delete_movements(tenant_id,purchase_id,sku,units_out,balance_stock)
 SELECT i.tenant_id,i.purchase_id,i.sku,i.qty,p.stock
 FROM m05ml_items i JOIN m05ml_products p
 ON p.tenant_id=i.tenant_id AND p.sku=i.sku
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id;
 SELECT CASE WHEN changes()<>(SELECT COUNT(*) FROM m05ml_items i
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id)
 THEN RAISE(ABORT,'m05ml-delete-movements-missing') END;

 UPDATE m05ml_lots SET remaining_qty=0 WHERE tenant_id=NEW.tenant_id
 AND purchase_id=NEW.purchase_id AND remaining_qty=qty;
 SELECT CASE WHEN changes()<>(SELECT COUNT(*) FROM m05ml_items i
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id)
 THEN RAISE(ABORT,'m05ml-delete-lot-stale') END;

 UPDATE m05ml_suppliers SET payable_paisa=payable_paisa-NEW.due_reversed_paisa
 WHERE tenant_id=NEW.tenant_id AND supplier_id=
 (SELECT supplier_id FROM m05ml_purchases p
 WHERE p.tenant_id=NEW.tenant_id AND p.purchase_id=NEW.purchase_id)
 AND active=1 AND NEW.due_reversed_paisa>0
 AND EXISTS(SELECT 1 FROM m05ml_party_links l
 WHERE l.tenant_id=m05ml_suppliers.tenant_id
 AND l.source_group='SUPPLIERS' AND l.source_id=m05ml_suppliers.supplier_id
 AND l.party_id=m05ml_suppliers.party_id AND l.reviewed=1);
 SELECT CASE WHEN NEW.due_reversed_paisa>0 AND changes()!=1
 THEN RAISE(ABORT,'m05ml-delete-supplier-link-stale') END;

 -- Immutable source records are made inactive through the sidecar views.
 -- An audit failure is deliberately the very last action: all-or-nothing.
 INSERT INTO m05ml_delete_audit(
 tenant_id,purchase_id,operation_id,supplier_id,actor_id,reason,
 lines_reversed,due_reversed_paisa,paid_voided_paisa)
 SELECT NEW.tenant_id,NEW.purchase_id,NEW.operation_id,
 p.supplier_id,NEW.actor_id,NEW.reason,
 (SELECT COUNT(*) FROM m05ml_items i
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id),
 NEW.due_reversed_paisa,p.paid_paisa
 FROM m05ml_purchases p WHERE p.tenant_id=NEW.tenant_id
 AND p.purchase_id=NEW.purchase_id;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m05ml-delete-audit-write') END;
 END`
];
