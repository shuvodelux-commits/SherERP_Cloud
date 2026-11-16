/** M07-B7: disposable local D1 proof only. NOT a deployable migration. */
export const M07_CASH_PRICE_EDIT_DDL=[
`CREATE TABLE m07_cash_price_edit_receipts(
 tenant_id TEXT NOT NULL,return_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,invoice_id TEXT NOT NULL,sku TEXT NOT NULL,
 lot_id TEXT NOT NULL,source_hash TEXT NOT NULL CHECK(length(source_hash)=64),
 intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
 expected_version INTEGER NOT NULL CHECK(expected_version BETWEEN 0 AND 999999),
 next_version INTEGER NOT NULL CHECK(next_version=expected_version+1),
 previous_refund_paisa INTEGER NOT NULL CHECK(previous_refund_paisa>=0),
 new_refund_paisa INTEGER NOT NULL CHECK(new_refund_paisa>=0 AND new_refund_paisa<=1000000000),
 reason TEXT NOT NULL CHECK(length(reason)>0 AND length(reason)<=200),
 CHECK(previous_refund_paisa<>new_refund_paisa),
 PRIMARY KEY(tenant_id,return_id,next_version),
 UNIQUE(tenant_id,operation_id)
) STRICT`,
`CREATE TABLE m07_cash_price_edit_adjustments(
 tenant_id TEXT NOT NULL,return_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 next_version INTEGER NOT NULL CHECK(next_version>=1),
 debit_paisa INTEGER NOT NULL CHECK(debit_paisa>=0),
 credit_paisa INTEGER NOT NULL CHECK(credit_paisa>=0),
 CHECK((debit_paisa>0 AND credit_paisa=0) OR
       (credit_paisa>0 AND debit_paisa=0)),
 PRIMARY KEY(tenant_id,return_id,next_version),UNIQUE(tenant_id,operation_id)
) STRICT`,
`CREATE TABLE m07_cash_price_edit_dependencies(
 tenant_id TEXT NOT NULL,return_id TEXT NOT NULL,
 activity_id TEXT NOT NULL,PRIMARY KEY(tenant_id,return_id,activity_id)
) STRICT`,
`CREATE VIEW m07_cash_current_refund_values AS
 SELECT r.tenant_id,r.return_id,r.invoice_id,r.refund_paisa AS original_refund_paisa,
 COALESCE((SELECT revision.new_refund_paisa
  FROM m07_cash_price_edit_receipts revision
  WHERE revision.tenant_id=r.tenant_id AND revision.return_id=r.return_id
  ORDER BY revision.next_version DESC LIMIT 1),r.refund_paisa) AS active_refund_paisa,
 COALESCE((SELECT revision.next_version
  FROM m07_cash_price_edit_receipts revision
  WHERE revision.tenant_id=r.tenant_id AND revision.return_id=r.return_id
  ORDER BY revision.next_version DESC LIMIT 1),0) AS revision_version
 FROM m07_cash_returns r WHERE NOT EXISTS(
  SELECT 1 FROM m07_cash_delete_receipts d
  WHERE d.tenant_id=r.tenant_id AND d.return_id=r.return_id)`,
`CREATE TRIGGER m07_cash_delete_guard_prior_price_edit
 BEFORE INSERT ON m07_cash_delete_receipts BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM m07_cash_price_edit_receipts e
  WHERE e.tenant_id=NEW.tenant_id AND e.return_id=NEW.return_id)
 THEN RAISE(IGNORE) END;
 END`,
`CREATE TRIGGER m07_cash_price_edit_commit
 AFTER INSERT ON m07_cash_price_edit_receipts BEGIN
 INSERT INTO m07_return_edit_versions(tenant_id,return_id,edit_version)
 VALUES(NEW.tenant_id,NEW.return_id,NEW.next_version)
 ON CONFLICT(tenant_id,return_id)
 DO UPDATE SET edit_version=excluded.edit_version
 WHERE m07_return_edit_versions.edit_version=NEW.expected_version;
 SELECT CASE WHEN changes()!=1
  THEN RAISE(ABORT,'m07-cash-price-edit-version-race') END;
 INSERT INTO m07_cash_price_edit_adjustments(
  tenant_id,return_id,operation_id,next_version,debit_paisa,credit_paisa)
 VALUES(NEW.tenant_id,NEW.return_id,NEW.operation_id,NEW.next_version,
  MAX(NEW.new_refund_paisa-NEW.previous_refund_paisa,0),
  MAX(NEW.previous_refund_paisa-NEW.new_refund_paisa,0));
 SELECT CASE WHEN changes()!=1
  THEN RAISE(ABORT,'m07-cash-price-edit-adjustment-missing') END;
 END`
];

export const M07_CASH_PRICE_EDIT_IMMUTABLE=[
 'm07_cash_price_edit_receipts','m07_cash_price_edit_adjustments'
];
export const M07_CASH_PRICE_EDIT_IMMUTABLE_DDL=
 M07_CASH_PRICE_EDIT_IMMUTABLE.flatMap(name=>[
 `CREATE TRIGGER ${name}_immutable_update BEFORE UPDATE ON ${name}
 BEGIN SELECT RAISE(ABORT,'m07-immutable-cash-price-edit'); END`,
 `CREATE TRIGGER ${name}_immutable_delete BEFORE DELETE ON ${name}
 BEGIN SELECT RAISE(ABORT,'m07-immutable-cash-price-edit'); END`
 ]);
