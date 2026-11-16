/**
 * Disposable, test-only M08 single-entry closing reconciliation D1 schema.
 * Never import in production migrations, Worker RPC or Cloudflare bindings.
 *
 * The one-entry formula is intentional: it is NOT the source's multi-entry,
 * positional Cash Book reconciliation algorithm.
 */
export const M08_RECON_DDL=Object.freeze([
  `CREATE TABLE m08_test_roles(
    tenant_id TEXT NOT NULL,role_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('Active','Inactive')),
    can_edit INTEGER NOT NULL CHECK(can_edit IN (0,1)),
    auth_version INTEGER NOT NULL CHECK(auth_version>=1),
    PRIMARY KEY(tenant_id,role_id)
  ) STRICT`,
  `CREATE TABLE m08_test_users(
    tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,role_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('Active','Inactive')),
    auth_version INTEGER NOT NULL CHECK(auth_version>=1),
    PRIMARY KEY(tenant_id,user_id)
  ) STRICT`,
  `CREATE TABLE m08_test_sessions(
    token_hash TEXT NOT NULL PRIMARY KEY,
    tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,role_id TEXT NOT NULL,
    user_version INTEGER NOT NULL,role_version INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,revoked_at INTEGER,
    CHECK(length(token_hash)=64)
  ) STRICT`,
  `CREATE TABLE m08_test_cash_sessions(
    tenant_id TEXT NOT NULL,session_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('Open','Closing','Closed')),
    revision INTEGER NOT NULL CHECK(revision>=1),
    opening_cents INTEGER NOT NULL,
    expected_cents INTEGER NOT NULL,
    counted_cents INTEGER,
    variance_cents INTEGER,
    closing_entry_id TEXT,
    PRIMARY KEY(tenant_id,session_id)
  ) STRICT`,
  `CREATE TABLE m08_test_cash_entries(
    tenant_id TEXT NOT NULL,entry_id TEXT NOT NULL,
    type TEXT NOT NULL,reference TEXT NOT NULL,
    credit_cents INTEGER NOT NULL CHECK(credit_cents>=0),
    debit_cents INTEGER NOT NULL CHECK(debit_cents>=0),
    is_deleted INTEGER NOT NULL CHECK(is_deleted IN (0,1)),
    description TEXT NOT NULL,
    PRIMARY KEY(tenant_id,entry_id)
  ) STRICT`,
  `CREATE TABLE m08_test_receipts(
    tenant_id TEXT NOT NULL,operation_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,session_id TEXT NOT NULL,
    real_entry_id TEXT NOT NULL,legacy_entry_id TEXT NOT NULL,
    revision INTEGER NOT NULL,intent_hash TEXT NOT NULL,
    committed_at TEXT NOT NULL,
    PRIMARY KEY(tenant_id,operation_id),
    CHECK(length(intent_hash)=64)
  ) STRICT`,
  `CREATE TABLE m08_test_links(
    tenant_id TEXT NOT NULL,session_id TEXT NOT NULL,phase TEXT NOT NULL,
    entry_id TEXT NOT NULL,operation_id TEXT NOT NULL,
    PRIMARY KEY(tenant_id,entry_id),
    UNIQUE(tenant_id,session_id,phase)
  ) STRICT`,
  `CREATE TABLE m08_test_audit(
    tenant_id TEXT NOT NULL,operation_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,session_id TEXT NOT NULL,
    real_entry_id TEXT NOT NULL,legacy_entry_id TEXT NOT NULL,
    action TEXT NOT NULL,
    PRIMARY KEY(tenant_id,operation_id)
  ) STRICT`,
  `CREATE TRIGGER m08_test_apply_receipt AFTER INSERT ON m08_test_receipts
  BEGIN
    UPDATE m08_test_cash_entries
    SET credit_cents=0,debit_cents=0,
      description=CASE WHEN trim(description)<>''
        THEN trim(description)||' — legacy automatic adjustment retired by Cash Reconciliation'
        ELSE 'legacy automatic adjustment retired by Cash Reconciliation' END
    WHERE tenant_id=NEW.tenant_id AND entry_id=NEW.legacy_entry_id
      AND type='Day Close Adjustment' AND reference=NEW.session_id
      AND is_deleted=0 AND credit_cents<>debit_cents;
    SELECT CASE WHEN changes()=1 THEN 1
      ELSE RAISE(ABORT,'m08 legacy adjustment race') END;

    INSERT INTO m08_test_links(tenant_id,session_id,phase,entry_id,operation_id)
    VALUES(NEW.tenant_id,NEW.session_id,'closing',NEW.real_entry_id,NEW.operation_id);

    UPDATE m08_test_cash_sessions
    SET expected_cents=opening_cents+(
      SELECT credit_cents-debit_cents FROM m08_test_cash_entries
      WHERE tenant_id=NEW.tenant_id AND entry_id=NEW.real_entry_id),
      variance_cents=counted_cents-(opening_cents+(
        SELECT credit_cents-debit_cents FROM m08_test_cash_entries
        WHERE tenant_id=NEW.tenant_id AND entry_id=NEW.real_entry_id)),
      closing_entry_id=NEW.real_entry_id,
      revision=revision+1
    WHERE tenant_id=NEW.tenant_id AND session_id=NEW.session_id
      AND revision=NEW.revision AND closing_entry_id IS NULL;
    SELECT CASE WHEN changes()=1 THEN 1
      ELSE RAISE(ABORT,'m08 closing session changed') END;

    INSERT INTO m08_test_audit(
      tenant_id,operation_id,actor_id,session_id,real_entry_id,legacy_entry_id,action)
    VALUES(NEW.tenant_id,NEW.operation_id,NEW.actor_id,
      NEW.session_id,NEW.real_entry_id,NEW.legacy_entry_id,'closing-reconciled');
  END`,
  `CREATE TRIGGER m08_test_audit_failure BEFORE INSERT ON m08_test_audit
    WHEN NEW.operation_id='OP-FAIL'
    BEGIN SELECT RAISE(ABORT,'m08 test late audit failure'); END`,
  `CREATE TRIGGER m08_test_receipt_no_update BEFORE UPDATE ON m08_test_receipts
    BEGIN SELECT RAISE(ABORT,'m08 committed receipt immutable'); END`,
  `CREATE TRIGGER m08_test_receipt_no_delete BEFORE DELETE ON m08_test_receipts
    BEGIN SELECT RAISE(ABORT,'m08 committed receipt immutable'); END`,
  `CREATE TRIGGER m08_test_link_no_update BEFORE UPDATE ON m08_test_links
    BEGIN SELECT RAISE(ABORT,'m08 linked explanation immutable'); END`,
  `CREATE TRIGGER m08_test_audit_no_update BEFORE UPDATE ON m08_test_audit
    BEGIN SELECT RAISE(ABORT,'m08 audit immutable'); END`,
  `CREATE TRIGGER m08_test_role_version AFTER UPDATE OF status,can_edit
    ON m08_test_roles
    WHEN NEW.status<>OLD.status OR NEW.can_edit<>OLD.can_edit
    BEGIN
      UPDATE m08_test_roles
      SET auth_version=MAX(NEW.auth_version,OLD.auth_version+1)
      WHERE tenant_id=NEW.tenant_id AND role_id=NEW.role_id;
    END`,
  `CREATE TRIGGER m08_test_user_version AFTER UPDATE OF status,role_id
    ON m08_test_users
    WHEN NEW.status<>OLD.status OR NEW.role_id<>OLD.role_id
    BEGIN
      UPDATE m08_test_users
      SET auth_version=MAX(NEW.auth_version,OLD.auth_version+1)
      WHERE tenant_id=NEW.tenant_id AND user_id=NEW.user_id;
    END`
]);

export async function seedM08Reconciliation(DB){
  for(const [tenant,user,role,token] of [
    ['SHOP-A','USER-A','ROLE-A','a'.repeat(64)],
    ['SHOP-B','USER-B','ROLE-B','b'.repeat(64)]
  ]){
    await DB.prepare(`INSERT INTO m08_test_roles
      VALUES (?,?,'Active',1,1)`).bind(tenant,role).run();
    await DB.prepare(`INSERT INTO m08_test_users
      VALUES (?,?,?,'Active',1)`).bind(tenant,user,role).run();
    await DB.prepare(`INSERT INTO m08_test_sessions
      VALUES (?,?,?,?,1,1,2000,NULL)`).bind(token,tenant,user,role).run();
    await DB.prepare(`INSERT INTO m08_test_cash_sessions
      VALUES (?,'SESSION-1','Closed',1,10000,10000,13000,3000,NULL)`)
      .bind(tenant).run();
    for(const [id,type,ref,credit,debit,description] of [
      ['LEG-1','Day Close Adjustment','SESSION-1',3000,0,'Legacy day close'],
      ['REAL-1','Sale','INV-1',3000,0,'Actual sale'],
      ['REAL-2','Sale','INV-2',3000,0,'Another actual sale']
    ]){
      await DB.prepare(`INSERT INTO m08_test_cash_entries
        VALUES (?,?,?,?,?,?,0,?)`)
        .bind(tenant,id,type,ref,credit,debit,description).run();
    }
  }
}
