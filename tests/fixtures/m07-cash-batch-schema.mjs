/** M07-A3 only: disposable Workerd/D1 2–20 original-invoice Cash batch. NOT a migration. */
export const M07_CASH_BATCH_TEST_DDL=[
`CREATE TABLE m07_batch_source_policy(
 tenant_id TEXT NOT NULL,invoice_id TEXT NOT NULL,
 payment_detail_version TEXT NOT NULL CHECK(payment_detail_version IN ('legacy','1')),
 PRIMARY KEY(tenant_id,invoice_id)) STRICT`,
`CREATE TABLE m07_cash_batches(
 tenant_id TEXT NOT NULL,batch_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,customer_id TEXT NOT NULL,reason TEXT NOT NULL,
 intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
 children_json TEXT NOT NULL CHECK(json_valid(children_json)),
 child_count INTEGER NOT NULL CHECK(child_count BETWEEN 2 AND 20),
 total_refund_paisa INTEGER NOT NULL CHECK(total_refund_paisa>=0),
 PRIMARY KEY(tenant_id,batch_id),UNIQUE(tenant_id,operation_id)) STRICT`,
`CREATE TABLE m07_cash_batch_members(
 tenant_id TEXT NOT NULL,batch_id TEXT NOT NULL,return_id TEXT NOT NULL,
 invoice_id TEXT NOT NULL,child_order INTEGER NOT NULL CHECK(child_order BETWEEN 1 AND 20),
 PRIMARY KEY(tenant_id,batch_id,return_id),
 UNIQUE(tenant_id,return_id),UNIQUE(tenant_id,batch_id,child_order)) STRICT`,
`CREATE TRIGGER m07_cash_batch_guard BEFORE INSERT ON m07_cash_batches BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM m06_cash_sessions s
  WHERE s.tenant_id=NEW.tenant_id AND s.state='Open')
  THEN RAISE(IGNORE) END;
 SELECT CASE WHEN json_array_length(NEW.children_json)<>NEW.child_count
  OR (SELECT COUNT(DISTINCT json_extract(j.value,'$.invoiceId'))
   FROM json_each(NEW.children_json) j)<>NEW.child_count
  OR (SELECT COUNT(DISTINCT json_extract(j.value,'$.returnId'))
   FROM json_each(NEW.children_json) j)<>NEW.child_count
  OR (SELECT COUNT(DISTINCT json_extract(j.value,'$.operationId'))
   FROM json_each(NEW.children_json) j)<>NEW.child_count
  THEN RAISE(IGNORE) END;
 SELECT CASE WHEN (SELECT COALESCE(SUM(CAST(json_extract(j.value,'$.refundPaisa') AS INTEGER)),0)
  FROM json_each(NEW.children_json) j)<>NEW.total_refund_paisa THEN RAISE(IGNORE) END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.children_json) j
  WHERE NOT EXISTS(
   SELECT 1 FROM m06_invoices invoice
   JOIN m06_sale_items item ON item.tenant_id=invoice.tenant_id
      AND item.invoice_id=invoice.invoice_id AND item.sku=invoice.sku
   JOIN m06_stock_movements movement ON movement.tenant_id=invoice.tenant_id
      AND movement.invoice_id=invoice.invoice_id AND movement.sku=invoice.sku
   JOIN m07_batch_source_policy policy ON policy.tenant_id=invoice.tenant_id
      AND policy.invoice_id=invoice.invoice_id
   JOIN m07_source_lots source_lot ON source_lot.tenant_id=invoice.tenant_id
      AND source_lot.invoice_id=invoice.invoice_id AND source_lot.sku=invoice.sku
   JOIN m07_lot_stock lot ON lot.tenant_id=invoice.tenant_id
      AND lot.lot_id=source_lot.lot_id AND lot.sku=invoice.sku
   JOIN m06_owned_stock stock ON stock.tenant_id=invoice.tenant_id
      AND stock.sku=invoice.sku
   JOIN m06_customer_accounts account ON account.tenant_id=invoice.tenant_id
      AND account.customer_id=invoice.customer_id
   JOIN m06_party_links link ON link.tenant_id=account.tenant_id
      AND link.source_group='CUSTOMERS' AND link.source_id=account.customer_id
      AND link.party_id=account.party_id AND link.reviewed=1
   WHERE invoice.tenant_id=NEW.tenant_id
      AND invoice.invoice_id=json_extract(j.value,'$.invoiceId')
      AND invoice.customer_id=NEW.customer_id AND invoice.customer_id<>''
      AND invoice.payload_hash=json_extract(j.value,'$.originalHash')
      AND invoice.sku=json_extract(j.value,'$.sku')
      AND item.units=invoice.units AND movement.units_out=invoice.units
      AND source_lot.lot_id=json_extract(j.value,'$.lotId')
      AND source_lot.sold_units=invoice.units
      AND source_lot.returned_units+CAST(json_extract(j.value,'$.units') AS INTEGER)
         <=source_lot.sold_units
      AND policy.payment_detail_version='legacy'
      AND invoice.grand_paisa*CAST(json_extract(j.value,'$.units') AS INTEGER)
         >=CAST(json_extract(j.value,'$.refundPaisa') AS INTEGER)*invoice.units
  ))
  THEN RAISE(IGNORE) END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.children_json) j
   JOIN m07_cash_returns prior ON prior.tenant_id=NEW.tenant_id
    AND (prior.return_id=json_extract(j.value,'$.returnId')
      OR prior.operation_id=json_extract(j.value,'$.operationId')))
  OR EXISTS(SELECT 1 FROM json_each(NEW.children_json) j
   JOIN m07_credit_returns prior ON prior.tenant_id=NEW.tenant_id
    AND (prior.return_id=json_extract(j.value,'$.returnId')
      OR prior.operation_id=json_extract(j.value,'$.operationId')))
  THEN RAISE(IGNORE) END;
 END`,
`CREATE TRIGGER m07_commit_cash_batch AFTER INSERT ON m07_cash_batches BEGIN
 INSERT INTO m07_cash_returns(
   tenant_id,return_id,operation_id,actor_id,invoice_id,sku,lot_id,
   source_hash,intent_hash,units,refund_paisa,reason)
 SELECT NEW.tenant_id,json_extract(j.value,'$.returnId'),
   json_extract(j.value,'$.operationId'),NEW.actor_id,
   json_extract(j.value,'$.invoiceId'),json_extract(j.value,'$.sku'),
   json_extract(j.value,'$.lotId'),json_extract(j.value,'$.originalHash'),
   NEW.intent_hash,CAST(json_extract(j.value,'$.units') AS INTEGER),
   CAST(json_extract(j.value,'$.refundPaisa') AS INTEGER),NEW.reason
 FROM json_each(NEW.children_json) j ORDER BY CAST(j.key AS INTEGER);
 SELECT CASE WHEN changes()!=NEW.child_count THEN RAISE(ABORT,'m07-batch-child-count') END;
 INSERT INTO m07_cash_batch_members(tenant_id,batch_id,return_id,invoice_id,child_order)
 SELECT NEW.tenant_id,NEW.batch_id,json_extract(j.value,'$.returnId'),
  json_extract(j.value,'$.invoiceId'),CAST(j.key AS INTEGER)+1
 FROM json_each(NEW.children_json) j ORDER BY CAST(j.key AS INTEGER);
 SELECT CASE WHEN changes()!=NEW.child_count THEN RAISE(ABORT,'m07-batch-members-count') END;
 END`,
`CREATE TRIGGER m07_cash_batch_immutable_update BEFORE UPDATE ON m07_cash_batches
 BEGIN SELECT RAISE(ABORT,'immutable-batch'); END`,
`CREATE TRIGGER m07_cash_batch_immutable_delete BEFORE DELETE ON m07_cash_batches
 BEGIN SELECT RAISE(ABORT,'immutable-batch'); END`
];
