/**
 * M07-B8 ONLY: isolated synthetic Workerd/D1 Store Credit price correction.
 * Never deploy to public Worker or migrate to production / business D1.
 */
export const M07_CREDIT_PRICE_EDIT_DDL=[
`CREATE TABLE m07_credit_price_edit_receipts(
 tenant_id TEXT NOT NULL, return_id TEXT NOT NULL,
 operation_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 invoice_id TEXT NOT NULL, sku TEXT NOT NULL, lot_id TEXT NOT NULL,
 source_hash TEXT NOT NULL CHECK(length(source_hash)=64),
 intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
 customer_id TEXT NOT NULL,
 expected_version INTEGER NOT NULL CHECK(expected_version BETWEEN 0 AND 999999),
 next_version INTEGER NOT NULL CHECK(next_version=expected_version+1),
 previous_credit_paisa INTEGER NOT NULL CHECK(previous_credit_paisa>=0),
 new_credit_paisa INTEGER NOT NULL CHECK(new_credit_paisa BETWEEN 0 AND 1000000000),
 reason TEXT NOT NULL CHECK(length(reason)>0 AND length(reason)<=200),
 CHECK(previous_credit_paisa<>new_credit_paisa),
 PRIMARY KEY(tenant_id,return_id,next_version),
 UNIQUE(tenant_id,operation_id)
) STRICT`,
`CREATE TABLE m07_credit_price_edit_ledger(
 tenant_id TEXT NOT NULL, return_id TEXT NOT NULL,
 operation_id TEXT NOT NULL,next_version INTEGER NOT NULL CHECK(next_version>0),
 customer_id TEXT NOT NULL,party_id TEXT NOT NULL,
 debit_paisa INTEGER NOT NULL CHECK(debit_paisa>=0),
 credit_paisa INTEGER NOT NULL CHECK(credit_paisa>=0),
 balance_paisa INTEGER NOT NULL,
 CHECK((debit_paisa>0 AND credit_paisa=0) OR
       (credit_paisa>0 AND debit_paisa=0)),
 PRIMARY KEY(tenant_id,return_id,next_version),UNIQUE(tenant_id,operation_id)
) STRICT`,
`CREATE TABLE m07_credit_price_edit_dependencies(
 tenant_id TEXT NOT NULL, return_id TEXT NOT NULL,
 customer_id TEXT NOT NULL, activity_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,return_id,activity_id)
) STRICT`,
`CREATE VIEW m07_credit_current_values AS
 SELECT r.tenant_id,r.return_id,r.invoice_id,r.customer_id,
 r.credit_paisa AS original_credit_paisa,
 COALESCE((SELECT e.new_credit_paisa FROM m07_credit_price_edit_receipts e
   WHERE e.tenant_id=r.tenant_id AND e.return_id=r.return_id
   ORDER BY e.next_version DESC LIMIT 1),r.credit_paisa) AS active_credit_paisa,
 COALESCE((SELECT e.next_version FROM m07_credit_price_edit_receipts e
   WHERE e.tenant_id=r.tenant_id AND e.return_id=r.return_id
   ORDER BY e.next_version DESC LIMIT 1),0) AS revision_version
 FROM m07_credit_returns r
 WHERE NOT EXISTS(SELECT 1 FROM m07_credit_delete_receipts d
  WHERE d.tenant_id=r.tenant_id AND d.return_id=r.return_id)`,
`CREATE TRIGGER m07_credit_delete_guard_prior_price_edit
 BEFORE INSERT ON m07_credit_delete_receipts BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM m07_credit_price_edit_receipts e
  WHERE e.tenant_id=NEW.tenant_id AND e.return_id=NEW.return_id)
 THEN RAISE(IGNORE) END;
 END`,
`CREATE TRIGGER m07_credit_price_edit_commit
 AFTER INSERT ON m07_credit_price_edit_receipts BEGIN
 INSERT INTO m07_return_edit_versions(tenant_id,return_id,edit_version)
 VALUES(NEW.tenant_id,NEW.return_id,NEW.next_version)
 ON CONFLICT(tenant_id,return_id) DO UPDATE SET edit_version=excluded.edit_version
 WHERE m07_return_edit_versions.edit_version=NEW.expected_version;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-credit-price-version-race') END;
 UPDATE m07_customer_signed_accounts SET
  signed_due_paisa=signed_due_paisa+NEW.previous_credit_paisa-NEW.new_credit_paisa
 WHERE tenant_id=NEW.tenant_id AND customer_id=NEW.customer_id AND active=1
  AND party_id=(SELECT l.party_id FROM m07_credit_ledger l
    WHERE l.tenant_id=NEW.tenant_id AND l.return_id=NEW.return_id)
  AND signed_due_paisa=COALESCE((
    SELECT e.balance_paisa FROM m07_credit_price_edit_ledger e
    WHERE e.tenant_id=NEW.tenant_id AND e.return_id=NEW.return_id
    ORDER BY e.next_version DESC LIMIT 1
  ),(SELECT l.balance_paisa FROM m07_credit_ledger l
    WHERE l.tenant_id=NEW.tenant_id AND l.return_id=NEW.return_id))
  AND EXISTS(SELECT 1 FROM m06_party_links p
    WHERE p.tenant_id=NEW.tenant_id AND p.source_group='CUSTOMERS'
    AND p.source_id=NEW.customer_id AND p.party_id=m07_customer_signed_accounts.party_id
    AND p.reviewed=1);
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-credit-price-stale-customer') END;
 INSERT INTO m07_credit_price_edit_ledger(
  tenant_id,return_id,operation_id,next_version,customer_id,party_id,
  debit_paisa,credit_paisa,balance_paisa)
 SELECT NEW.tenant_id,NEW.return_id,NEW.operation_id,NEW.next_version,
  NEW.customer_id,a.party_id,
  MAX(NEW.previous_credit_paisa-NEW.new_credit_paisa,0),
  MAX(NEW.new_credit_paisa-NEW.previous_credit_paisa,0),
  a.signed_due_paisa
 FROM m07_customer_signed_accounts a
 WHERE a.tenant_id=NEW.tenant_id AND a.customer_id=NEW.customer_id AND a.active=1;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m07-credit-price-ledger-missing') END;
 END`
];
export const M07_CREDIT_PRICE_EDIT_IMMUTABLE=[
 'm07_credit_price_edit_receipts','m07_credit_price_edit_ledger'
];
export const M07_CREDIT_PRICE_EDIT_IMMUTABLE_DDL=
 M07_CREDIT_PRICE_EDIT_IMMUTABLE.flatMap(name=>[
  `CREATE TRIGGER ${name}_immutable_update BEFORE UPDATE ON ${name}
   BEGIN SELECT RAISE(ABORT,'m07-immutable-credit-price'); END`,
  `CREATE TRIGGER ${name}_immutable_delete BEFORE DELETE ON ${name}
   BEGIN SELECT RAISE(ABORT,'m07-immutable-credit-price'); END`
 ]);
