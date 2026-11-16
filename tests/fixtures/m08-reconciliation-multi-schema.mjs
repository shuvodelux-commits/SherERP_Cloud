/**
 * Disposable M08 multi-entry *closing* Cash Reconciliation schema.
 * Imports existing synthetic M08 auth/cash fixtures; adds isolated m08_multi_*
 * tables. Do not use as a production migration, RPC or accounting kernel.
 */
import {M08_RECON_DDL,seedM08Reconciliation} from './m08-reconciliation-atomic-schema.mjs';

export const M08_MULTI_DDL=Object.freeze([
  ...M08_RECON_DDL,
  `CREATE TABLE m08_multi_receipts(
    tenant_id TEXT NOT NULL,operation_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,session_id TEXT NOT NULL,
    legacy_entry_id TEXT NOT NULL,revision INTEGER NOT NULL,
    entry_ids_json TEXT NOT NULL,intent_hash TEXT NOT NULL,
    committed_at TEXT NOT NULL,
    PRIMARY KEY(tenant_id,operation_id),
    CHECK(length(intent_hash)=64),
    CHECK(json_valid(entry_ids_json) AND json_type(entry_ids_json)='array')
  ) STRICT`,
  `CREATE TABLE m08_multi_links(
    tenant_id TEXT NOT NULL,session_id TEXT NOT NULL,
    phase TEXT NOT NULL,entry_id TEXT NOT NULL,operation_id TEXT NOT NULL,
    PRIMARY KEY(tenant_id,entry_id),
    UNIQUE(tenant_id,operation_id,entry_id),
    CHECK(phase='closing')
  ) STRICT`,
  `CREATE TABLE m08_multi_prior_usage(
    tenant_id TEXT NOT NULL,entry_id TEXT NOT NULL,
    session_id TEXT NOT NULL,phase TEXT NOT NULL,
    PRIMARY KEY(tenant_id,entry_id,session_id,phase),
    CHECK(phase IN ('opening','closing'))
  ) STRICT`,
  `CREATE TABLE m08_multi_audit(
    tenant_id TEXT NOT NULL,operation_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,session_id TEXT NOT NULL,
    legacy_entry_id TEXT NOT NULL,entry_ids_json TEXT NOT NULL,
    action TEXT NOT NULL,
    PRIMARY KEY(tenant_id,operation_id),
    CHECK(action='multi-closing-reconciled')
  ) STRICT`,
  `CREATE TRIGGER m08_multi_commit AFTER INSERT ON m08_multi_receipts
  BEGIN
    UPDATE m08_test_cash_entries SET credit_cents=0,debit_cents=0,
      description=CASE WHEN trim(description)<>''
        THEN trim(description)||' — legacy automatic adjustment retired by Cash Reconciliation'
        ELSE 'legacy automatic adjustment retired by Cash Reconciliation' END
    WHERE tenant_id=NEW.tenant_id AND entry_id=NEW.legacy_entry_id
      AND type='Day Close Adjustment' AND reference=NEW.session_id
      AND is_deleted=0 AND credit_cents<>debit_cents;
    SELECT CASE WHEN changes()=1 THEN 1
      ELSE RAISE(ABORT,'m08 multi legacy adjustment changed') END;

    INSERT INTO m08_multi_links(tenant_id,session_id,phase,entry_id,operation_id)
      SELECT NEW.tenant_id,NEW.session_id,'closing',item.value,
        NEW.operation_id
      FROM json_each(NEW.entry_ids_json) AS item
      ORDER BY CAST(item.key AS INTEGER);
    SELECT CASE WHEN
      (SELECT COUNT(*) FROM m08_multi_links
        WHERE tenant_id=NEW.tenant_id AND operation_id=NEW.operation_id)
        =json_array_length(NEW.entry_ids_json) THEN 1
      ELSE RAISE(ABORT,'m08 multi incomplete attribution') END;

    UPDATE m08_test_cash_sessions SET
      expected_cents=opening_cents+(
        SELECT COALESCE(SUM(cash.credit_cents-cash.debit_cents),0)
        FROM json_each(NEW.entry_ids_json) item
        JOIN m08_test_cash_entries cash
          ON cash.tenant_id=NEW.tenant_id AND cash.entry_id=item.value
      ),
      variance_cents=counted_cents-(opening_cents+(
        SELECT COALESCE(SUM(cash.credit_cents-cash.debit_cents),0)
        FROM json_each(NEW.entry_ids_json) item
        JOIN m08_test_cash_entries cash
          ON cash.tenant_id=NEW.tenant_id AND cash.entry_id=item.value
      )),
      closing_entry_id=NEW.operation_id,
      revision=revision+1
    WHERE tenant_id=NEW.tenant_id AND session_id=NEW.session_id
      AND revision=NEW.revision
      AND status IN ('Closed','Closing') AND closing_entry_id IS NULL;
    SELECT CASE WHEN changes()=1 THEN 1
      ELSE RAISE(ABORT,'m08 multi closing session changed') END;

    INSERT INTO m08_multi_audit(
      tenant_id,operation_id,actor_id,session_id,legacy_entry_id,
      entry_ids_json,action)
    VALUES(NEW.tenant_id,NEW.operation_id,NEW.actor_id,NEW.session_id,
      NEW.legacy_entry_id,NEW.entry_ids_json,'multi-closing-reconciled');
  END`,
  `CREATE TRIGGER m08_multi_injected_late_failure BEFORE INSERT ON m08_multi_audit
    WHEN NEW.operation_id='OP-MULTI-FAIL'
    BEGIN SELECT RAISE(ABORT,'m08 multi injected audit failure'); END`,
  `CREATE TRIGGER m08_multi_receipt_update_guard BEFORE UPDATE ON m08_multi_receipts
    BEGIN SELECT RAISE(ABORT,'m08 immutable multi receipt'); END`,
  `CREATE TRIGGER m08_multi_receipt_delete_guard BEFORE DELETE ON m08_multi_receipts
    BEGIN SELECT RAISE(ABORT,'m08 immutable multi receipt'); END`,
  `CREATE TRIGGER m08_multi_link_update_guard BEFORE UPDATE ON m08_multi_links
    BEGIN SELECT RAISE(ABORT,'m08 immutable multi link'); END`,
  `CREATE TRIGGER m08_multi_link_delete_guard BEFORE DELETE ON m08_multi_links
    BEGIN SELECT RAISE(ABORT,'m08 immutable multi link'); END`,
  `CREATE TRIGGER m08_multi_audit_update_guard BEFORE UPDATE ON m08_multi_audit
    BEGIN SELECT RAISE(ABORT,'m08 immutable multi audit'); END`,
  `CREATE TRIGGER m08_multi_audit_delete_guard BEFORE DELETE ON m08_multi_audit
    BEGIN SELECT RAISE(ABORT,'m08 immutable multi audit'); END`
]);

export async function seedM08Multi(DB){
  await seedM08Reconciliation(DB);
  for(const tenant of ['SHOP-A','SHOP-B']){
    await DB.prepare(`UPDATE m08_test_cash_entries
      SET credit_cents=1000 WHERE tenant_id=? AND entry_id='REAL-1'`)
      .bind(tenant).run();
    await DB.prepare(`UPDATE m08_test_cash_entries
      SET credit_cents=2000 WHERE tenant_id=? AND entry_id='REAL-2'`)
      .bind(tenant).run();
  }
}
