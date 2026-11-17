/**
 * M08 disposable local-D1 marker-retirement atomicity fixture.
 * Real Cloudflare Workerd tests ONLY. Not a D1 migration or finance writer.
 * The physical Cash Book legacy_row and Session Open Type/Reference remain.
 */
export const M08_MARKER_DDL=Object.freeze([
  `CREATE TABLE m08_marker_roles(
    tenant_id TEXT NOT NULL,role_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('Active','Inactive')),
    can_edit INTEGER NOT NULL CHECK(can_edit IN (0,1)),
    auth_version INTEGER NOT NULL CHECK(auth_version>=1),
    PRIMARY KEY(tenant_id,role_id)
  ) STRICT`,
  `CREATE TABLE m08_marker_users(
    tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,role_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('Active','Inactive')),
    auth_version INTEGER NOT NULL CHECK(auth_version>=1),
    PRIMARY KEY(tenant_id,user_id)
  ) STRICT`,
  `CREATE TABLE m08_marker_tokens(
    token_hash TEXT NOT NULL PRIMARY KEY CHECK(length(token_hash)=64),
    tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,role_id TEXT NOT NULL,
    user_version INTEGER NOT NULL,role_version INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,revoked_at INTEGER
  ) STRICT`,
  `CREATE TABLE m08_marker_cash_sessions(
    tenant_id TEXT NOT NULL,session_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('Open','Closing','Closed')),
    revision INTEGER NOT NULL CHECK(revision>=1),
    PRIMARY KEY(tenant_id,session_id)
  ) STRICT`,
  `CREATE TABLE m08_marker_cash(
    tenant_id TEXT NOT NULL,
    legacy_row INTEGER NOT NULL CHECK(legacy_row>=2),
    entry_id TEXT NOT NULL,
    type TEXT NOT NULL,
    reference TEXT NOT NULL,
    credit_cents INTEGER NOT NULL CHECK(credit_cents>=0),
    debit_cents INTEGER NOT NULL CHECK(debit_cents>=0),
    is_deleted INTEGER NOT NULL CHECK(is_deleted IN (0,1)),
    description TEXT NOT NULL,
    PRIMARY KEY(tenant_id,legacy_row),
    UNIQUE(tenant_id,entry_id)
  ) STRICT`,
  `CREATE TABLE m08_marker_receipts(
    tenant_id TEXT NOT NULL,operation_id TEXT NOT NULL,
    session_id TEXT NOT NULL,phase TEXT NOT NULL,
    actor_id TEXT NOT NULL,revision INTEGER NOT NULL,
    intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
    committed_at INTEGER NOT NULL,
    PRIMARY KEY(tenant_id,operation_id),
    UNIQUE(tenant_id,session_id,phase),
    CHECK(phase IN ('opening','closing'))
  ) STRICT`,
  `CREATE TABLE m08_marker_audit(
    tenant_id TEXT NOT NULL,operation_id TEXT NOT NULL,
    session_id TEXT NOT NULL,phase TEXT NOT NULL,
    actor_id TEXT NOT NULL,action TEXT NOT NULL,
    PRIMARY KEY(tenant_id,operation_id),
    CHECK(action='synthetic-marker-retired')
  ) STRICT`,
  `CREATE TRIGGER m08_marker_atomic_retire AFTER INSERT
    ON m08_marker_receipts BEGIN
    UPDATE m08_marker_cash
    SET credit_cents=0,debit_cents=0,
      description=CASE WHEN trim(description)<>''
        THEN trim(description)||' — legacy automatic adjustment retired by Cash Reconciliation'
        ELSE 'legacy automatic adjustment retired by Cash Reconciliation'
      END
    WHERE tenant_id=NEW.tenant_id
      AND reference=NEW.session_id
      AND type=CASE WHEN NEW.phase='opening'
        THEN 'Session Open' ELSE 'Day Close Adjustment' END
      AND is_deleted=0
      AND credit_cents<>debit_cents;
    SELECT CASE WHEN changes()>0 THEN 1
      ELSE RAISE(ABORT,'m08 marker no eligible source adjustment') END;

    UPDATE m08_marker_cash_sessions
    SET revision=revision+1
    WHERE tenant_id=NEW.tenant_id
      AND session_id=NEW.session_id AND revision=NEW.revision
      AND status IN ('Open','Closing','Closed');
    SELECT CASE WHEN changes()=1 THEN 1
      ELSE RAISE(ABORT,'m08 marker revision changed') END;

    INSERT INTO m08_marker_audit(
      tenant_id,operation_id,session_id,phase,actor_id,action)
    VALUES(NEW.tenant_id,NEW.operation_id,NEW.session_id,
      NEW.phase,NEW.actor_id,'synthetic-marker-retired');
  END`,
  `CREATE TRIGGER m08_marker_receipt_no_update
    BEFORE UPDATE ON m08_marker_receipts
    BEGIN SELECT RAISE(ABORT,'m08 marker immutable receipt'); END`,
  `CREATE TRIGGER m08_marker_receipt_no_delete
    BEFORE DELETE ON m08_marker_receipts
    BEGIN SELECT RAISE(ABORT,'m08 marker immutable receipt'); END`,
  `CREATE TRIGGER m08_marker_audit_no_update
    BEFORE UPDATE ON m08_marker_audit
    BEGIN SELECT RAISE(ABORT,'m08 marker immutable audit'); END`,
  `CREATE TRIGGER m08_marker_audit_no_delete
    BEFORE DELETE ON m08_marker_audit
    BEGIN SELECT RAISE(ABORT,'m08 marker immutable audit'); END`,
  `CREATE TRIGGER m08_marker_role_auth_version
    AFTER UPDATE OF status,can_edit ON m08_marker_roles
    WHEN NEW.status<>OLD.status OR NEW.can_edit<>OLD.can_edit
    BEGIN UPDATE m08_marker_roles
      SET auth_version=MAX(NEW.auth_version,OLD.auth_version+1)
      WHERE tenant_id=NEW.tenant_id AND role_id=NEW.role_id; END`,
  `CREATE TRIGGER m08_marker_user_auth_version
    AFTER UPDATE OF status,role_id ON m08_marker_users
    WHEN NEW.status<>OLD.status OR NEW.role_id<>OLD.role_id
    BEGIN UPDATE m08_marker_users
      SET auth_version=MAX(NEW.auth_version,OLD.auth_version+1)
      WHERE tenant_id=NEW.tenant_id AND user_id=NEW.user_id; END`
]);

export async function seedM08Marker(DB){
  const entries=[
    [2,'OPEN-1','Session Open','SESSION-1',4000,0,0,'  Original marker  '],
    [4,'CLOSE-1','Day Close Adjustment','SESSION-1',3000,0,0,'Legacy day close'],
    [5,'CLOSE-2','Day Close Adjustment','SESSION-1',0,500,0,'  সংশোধন  '],
    [6,'OTHER','Day Close Adjustment','OTHER-SESSION',900,0,0,'Other session'],
    [7,'REAL','Sale','INV-1',2000,0,0,'Real sale'],
    [8,'DELETED','Day Close Adjustment','SESSION-1',100,0,1,'Deleted adjustment'],
    [9,'BALANCED','Day Close Adjustment','SESSION-1',100,100,0,'Balanced adjustment'],
    [10,'NOOP','Day Close Adjustment','SESSION-1',0,0,0,'Already zero']
  ];
  for(const [tenant,user,role,token] of [
    ['SHOP-A','USER-A','ROLE-A','a'.repeat(64)],
    ['SHOP-B','USER-B','ROLE-B','b'.repeat(64)]
  ]){
    await DB.prepare("INSERT INTO m08_marker_roles VALUES (?,?,'Active',1,1)")
      .bind(tenant,role).run();
    await DB.prepare("INSERT INTO m08_marker_users VALUES (?,?,?,'Active',1)")
      .bind(tenant,user,role).run();
    await DB.prepare("INSERT INTO m08_marker_tokens VALUES (?,?,?,?,1,1,2000,NULL)")
      .bind(token,tenant,user,role).run();
    await DB.prepare("INSERT INTO m08_marker_cash_sessions VALUES (?,'SESSION-1','Closed',1)")
      .bind(tenant).run();
    for(const [legacyRow,entryId,type,reference,credit,debit,deleted,description]
      of entries){
      await DB.prepare("INSERT INTO m08_marker_cash VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(tenant,legacyRow,entryId,type,reference,credit,debit,deleted,description)
        .run();
    }
  }
}
