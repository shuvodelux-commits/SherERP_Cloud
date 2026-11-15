/**
 * TEST ONLY: local D1 atomic reassignment of a posted purchase to another
 * Supplier. NOT a deployed schema, posting engine, or M07 correction writer.
 * The original purchase, stock lots, tender and ledger history stay immutable.
 */
export const M05ML_SUPPLIER_TRANSFER_DDL=[
`CREATE TABLE m05ml_supplier_transfer_receipts(
 tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
 reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 source_supplier_id TEXT NOT NULL,target_supplier_id TEXT NOT NULL,
 due_paisa INTEGER NOT NULL CHECK(due_paisa>0),
 CHECK(source_supplier_id<>target_supplier_id),
 PRIMARY KEY(tenant_id,purchase_id),UNIQUE(tenant_id,operation_id)
) STRICT`,
`CREATE TABLE m05ml_supplier_transfer_legs(
 tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,
 leg_order INTEGER NOT NULL CHECK(leg_order IN(1,2)),
 supplier_id TEXT NOT NULL,
 debit_paisa INTEGER NOT NULL CHECK(debit_paisa>=0),
 credit_paisa INTEGER NOT NULL CHECK(credit_paisa>=0),
 balance_paisa INTEGER NOT NULL,
 CHECK((debit_paisa=0 AND credit_paisa>0) OR
 (debit_paisa>0 AND credit_paisa=0)),
 PRIMARY KEY(tenant_id,purchase_id,leg_order)
) STRICT`,
`CREATE TABLE m05ml_supplier_transfer_audit(
 tenant_id TEXT NOT NULL,purchase_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,reason TEXT NOT NULL,
 source_supplier_id TEXT NOT NULL,target_supplier_id TEXT NOT NULL,
 original_purchase_date TEXT NOT NULL,due_transferred_paisa INTEGER NOT NULL CHECK(due_transferred_paisa>0),
 lot_count INTEGER NOT NULL CHECK(lot_count>0),
 PRIMARY KEY(tenant_id,purchase_id),UNIQUE(tenant_id,operation_id)
) STRICT`,
`CREATE VIEW m05ml_effective_transfer_lots AS
 SELECT l.tenant_id,l.purchase_id,l.lot_id,l.sku,
 COALESCE(r.target_supplier_id,l.supplier_id) AS supplier_id,
 l.purchase_date,l.qty,l.remaining_qty,l.cost_paisa,l.sell_paisa
 FROM m05ml_lots l LEFT JOIN m05ml_supplier_transfer_receipts r
 ON r.tenant_id=l.tenant_id AND r.purchase_id=l.purchase_id
 WHERE NOT EXISTS(SELECT 1 FROM m05ml_delete_receipts d
 WHERE d.tenant_id=l.tenant_id AND d.purchase_id=l.purchase_id)`,
`CREATE VIEW m05ml_effective_transfer_supplier_ledger AS
 SELECT l.tenant_id,l.purchase_id,
 COALESCE(r.target_supplier_id,l.supplier_id) AS supplier_id,
 l.debit_paisa
 FROM m05ml_active_supplier_ledger l
 LEFT JOIN m05ml_supplier_transfer_receipts r
 ON r.tenant_id=l.tenant_id AND r.purchase_id=l.purchase_id`,
`CREATE TRIGGER m05ml_supplier_transfer_blocks_delete
 BEFORE INSERT ON m05ml_delete_receipts
 WHEN EXISTS(SELECT 1 FROM m05ml_supplier_transfer_receipts r
 WHERE r.tenant_id=NEW.tenant_id AND r.purchase_id=NEW.purchase_id)
 BEGIN SELECT RAISE(IGNORE); END`,
`CREATE TRIGGER m05ml_supplier_transfer_blocks_edit
 BEFORE INSERT ON m05ml_edit_receipts
 WHEN EXISTS(SELECT 1 FROM m05ml_supplier_transfer_receipts r
 WHERE r.tenant_id=NEW.tenant_id AND r.purchase_id=NEW.purchase_id)
 BEGIN SELECT RAISE(IGNORE); END`,
`CREATE TRIGGER m05ml_supplier_transfer_blocks_add
 BEFORE INSERT ON m05ml_add_receipts
 WHEN EXISTS(SELECT 1 FROM m05ml_supplier_transfer_receipts r
 WHERE r.tenant_id=NEW.tenant_id AND r.purchase_id=NEW.purchase_id)
 BEGIN SELECT RAISE(IGNORE); END`,
`CREATE TRIGGER m05ml_supplier_transfer_blocks_remove
 BEFORE INSERT ON m05ml_remove_receipts
 WHEN EXISTS(SELECT 1 FROM m05ml_supplier_transfer_receipts r
 WHERE r.tenant_id=NEW.tenant_id AND r.purchase_id=NEW.purchase_id)
 BEGIN SELECT RAISE(IGNORE); END`,
`CREATE TRIGGER m05ml_supplier_transfer_authorize
 BEFORE INSERT ON m05ml_supplier_transfer_receipts BEGIN
 -- Validate at SQL claim time, not by trusting JS preflight.
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM m05ml_sessions s
 WHERE s.tenant_id=NEW.tenant_id AND s.state='Open')
 THEN RAISE(IGNORE) END;
 SELECT CASE WHEN NEW.source_supplier_id=NEW.target_supplier_id
 THEN RAISE(IGNORE) END;
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM m05ml_purchases p
 JOIN m05ml_suppliers src ON src.tenant_id=p.tenant_id
 AND src.supplier_id=p.supplier_id AND src.active=1
 JOIN m05ml_suppliers dest ON dest.tenant_id=p.tenant_id
 AND dest.supplier_id=NEW.target_supplier_id AND dest.active=1
 JOIN m05ml_party_links link_src ON link_src.tenant_id=src.tenant_id
 AND link_src.source_group='SUPPLIERS' AND link_src.source_id=src.supplier_id
 AND link_src.party_id=src.party_id AND link_src.reviewed=1
 JOIN m05ml_party_links link_dest ON link_dest.tenant_id=dest.tenant_id
 AND link_dest.source_group='SUPPLIERS' AND link_dest.source_id=dest.supplier_id
 AND link_dest.party_id=dest.party_id AND link_dest.reviewed=1
 JOIN m05ml_supplier_ledger ledger ON ledger.tenant_id=p.tenant_id
 AND ledger.purchase_id=p.purchase_id AND ledger.supplier_id=p.supplier_id
 AND ledger.debit_paisa=p.due_paisa
 WHERE p.tenant_id=NEW.tenant_id AND p.purchase_id=NEW.purchase_id
 AND p.supplier_id=NEW.source_supplier_id
 AND src.payable_paisa>=p.due_paisa
 AND p.due_paisa=NEW.due_paisa AND p.due_paisa>0
 AND p.paid_paisa+p.due_paisa=p.grand_paisa
 )
 THEN RAISE(IGNORE) END;

 SELECT CASE WHEN EXISTS(SELECT 1 FROM m05ml_delete_receipts d
 WHERE d.tenant_id=NEW.tenant_id AND d.purchase_id=NEW.purchase_id)
 OR EXISTS(SELECT 1 FROM m05ml_edit_receipts e
 WHERE e.tenant_id=NEW.tenant_id AND e.purchase_id=NEW.purchase_id)
 OR EXISTS(SELECT 1 FROM m05ml_add_receipts a
 WHERE a.tenant_id=NEW.tenant_id AND a.purchase_id=NEW.purchase_id)
 OR EXISTS(SELECT 1 FROM m05ml_remove_receipts rr
 WHERE rr.tenant_id=NEW.tenant_id AND rr.purchase_id=NEW.purchase_id)
 OR EXISTS(SELECT 1 FROM m05ml_purchase_returns ret
 WHERE ret.tenant_id=NEW.tenant_id AND ret.purchase_id=NEW.purchase_id
 AND ret.active=1)
 OR EXISTS(SELECT 1 FROM m05ml_purchase_settlements sett
 WHERE sett.tenant_id=NEW.tenant_id AND sett.purchase_id=NEW.purchase_id
 AND sett.active=1)
 THEN RAISE(IGNORE) END;

 -- Historical balances on either Supplier must not be silently left stale.
 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM m05ml_purchases orig
 JOIN m05ml_purchases later ON later.tenant_id=orig.tenant_id
 AND later.rowid>orig.rowid
 AND later.supplier_id IN(NEW.source_supplier_id,NEW.target_supplier_id)
 JOIN m05ml_supplier_ledger later_ledger
 ON later_ledger.tenant_id=later.tenant_id
 AND later_ledger.purchase_id=later.purchase_id
 WHERE orig.tenant_id=NEW.tenant_id AND orig.purchase_id=NEW.purchase_id)
 THEN RAISE(IGNORE) END;

 -- Every original purchased SKU has exactly one unambiguous source lot,
 -- even when fully consumed. Reassign Supplier provenance, never FIFO COGS.
 SELECT CASE WHEN
 (SELECT COUNT(*) FROM m05ml_items i
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id)=0
 OR (SELECT COUNT(*) FROM m05ml_items i
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id)
 <> (SELECT COUNT(*) FROM m05ml_lots l
 WHERE l.tenant_id=NEW.tenant_id AND l.purchase_id=NEW.purchase_id)
 OR EXISTS(SELECT 1 FROM m05ml_items i
 WHERE i.tenant_id=NEW.tenant_id AND i.purchase_id=NEW.purchase_id
 AND (SELECT COUNT(*) FROM m05ml_lots l
 WHERE l.tenant_id=i.tenant_id AND l.purchase_id=i.purchase_id AND l.sku=i.sku
 AND l.supplier_id=NEW.source_supplier_id
 AND l.qty=i.qty AND l.cost_paisa=i.cost_paisa
 AND l.remaining_qty BETWEEN 0 AND l.qty)<>1)
 THEN RAISE(IGNORE) END;
 END`,
`CREATE TRIGGER m05ml_supplier_transfer_atomic
 AFTER INSERT ON m05ml_supplier_transfer_receipts BEGIN
 -- Both gross Supplier accounts and both ledger legs live in ONE statement.
 UPDATE m05ml_suppliers SET payable_paisa=payable_paisa-NEW.due_paisa
 WHERE tenant_id=NEW.tenant_id AND supplier_id=NEW.source_supplier_id
 AND active=1 AND payable_paisa>=NEW.due_paisa
 AND EXISTS(SELECT 1 FROM m05ml_party_links l
 WHERE l.tenant_id=m05ml_suppliers.tenant_id
 AND l.source_group='SUPPLIERS' AND l.source_id=m05ml_suppliers.supplier_id
 AND l.party_id=m05ml_suppliers.party_id AND l.reviewed=1);
 SELECT CASE WHEN changes()!=1
 THEN RAISE(ABORT,'m05ml-transfer-source-payable-cas') END;
 INSERT INTO m05ml_supplier_transfer_legs(
 tenant_id,purchase_id,leg_order,supplier_id,debit_paisa,credit_paisa,balance_paisa)
 SELECT NEW.tenant_id,NEW.purchase_id,1,NEW.source_supplier_id,0,
 NEW.due_paisa,s.payable_paisa
 FROM m05ml_suppliers s
 WHERE s.tenant_id=NEW.tenant_id AND s.supplier_id=NEW.source_supplier_id;
 SELECT CASE WHEN changes()!=1
 THEN RAISE(ABORT,'m05ml-transfer-source-leg') END;

 UPDATE m05ml_suppliers SET payable_paisa=payable_paisa+NEW.due_paisa
 WHERE tenant_id=NEW.tenant_id AND supplier_id=NEW.target_supplier_id
 AND active=1 AND EXISTS(SELECT 1 FROM m05ml_party_links l
 WHERE l.tenant_id=m05ml_suppliers.tenant_id
 AND l.source_group='SUPPLIERS' AND l.source_id=m05ml_suppliers.supplier_id
 AND l.party_id=m05ml_suppliers.party_id AND l.reviewed=1);
 SELECT CASE WHEN changes()!=1
 THEN RAISE(ABORT,'m05ml-transfer-target-payable-cas') END;
 INSERT INTO m05ml_supplier_transfer_legs(
 tenant_id,purchase_id,leg_order,supplier_id,debit_paisa,credit_paisa,balance_paisa)
 SELECT NEW.tenant_id,NEW.purchase_id,2,NEW.target_supplier_id,
 NEW.due_paisa,0,s.payable_paisa
 FROM m05ml_suppliers s
 WHERE s.tenant_id=NEW.tenant_id AND s.supplier_id=NEW.target_supplier_id;
 SELECT CASE WHEN changes()!=1
 THEN RAISE(ABORT,'m05ml-transfer-target-leg') END;

 -- Last insert is injectable: any failure aborts both balances, legs & claim.
 INSERT INTO m05ml_supplier_transfer_audit(
 tenant_id,purchase_id,operation_id,actor_id,reason,
 source_supplier_id,target_supplier_id,original_purchase_date,
 due_transferred_paisa,lot_count)
 SELECT NEW.tenant_id,NEW.purchase_id,NEW.operation_id,NEW.actor_id,
 NEW.reason,NEW.source_supplier_id,NEW.target_supplier_id,
 p.purchase_date,NEW.due_paisa,
 (SELECT COUNT(*) FROM m05ml_lots l
 WHERE l.tenant_id=NEW.tenant_id AND l.purchase_id=NEW.purchase_id)
 FROM m05ml_purchases p
 WHERE p.tenant_id=NEW.tenant_id AND p.purchase_id=NEW.purchase_id;
 SELECT CASE WHEN changes()!=1
 THEN RAISE(ABORT,'m05ml-transfer-audit-missing') END;
 END`
];
