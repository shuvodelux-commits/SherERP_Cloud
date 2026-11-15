/**
 * Test-only schema for M03/M04 atomic session-authorized posting.
 * Never imported by deployed Workers and never applied as a migration.
 */
export const AUTHORIZED_POST_DDL=Object.freeze([
 `CREATE TABLE synthetic_post_roles(
    tenant_id TEXT NOT NULL,role_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('Active','Inactive')),
    auth_version INTEGER NOT NULL CHECK(auth_version>=1),
    can_post INTEGER NOT NULL CHECK(can_post IN (0,1)),
    PRIMARY KEY(tenant_id,role_id)
  ) STRICT`,
 `CREATE TABLE synthetic_post_users(
    tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,role_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('Active','Inactive')),
    auth_version INTEGER NOT NULL CHECK(auth_version>=1),
    PRIMARY KEY(tenant_id,user_id),
    FOREIGN KEY(tenant_id,role_id) REFERENCES synthetic_post_roles(tenant_id,role_id)
  ) STRICT`,
 `CREATE TABLE synthetic_post_sessions(
    token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
    tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,role_id TEXT NOT NULL,
    user_version INTEGER NOT NULL,role_version INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,revoked_at INTEGER,
    FOREIGN KEY(tenant_id,user_id) REFERENCES synthetic_post_users(tenant_id,user_id),
    FOREIGN KEY(tenant_id,role_id) REFERENCES synthetic_post_roles(tenant_id,role_id)
  ) STRICT`,
 `CREATE TABLE synthetic_post_stock(
    tenant_id TEXT NOT NULL,sku TEXT NOT NULL,
    available INTEGER NOT NULL CHECK(available>=0),
    PRIMARY KEY(tenant_id,sku)
  ) STRICT`,
 `CREATE TABLE synthetic_auth_post_receipts(
    tenant_id TEXT NOT NULL,operation_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,operation_type TEXT NOT NULL,
    payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
    units INTEGER NOT NULL CHECK(units>0),
    amount TEXT NOT NULL CHECK(length(trim(amount))>0),
    result_ref TEXT NOT NULL CHECK(length(result_ref)>0),
    committed_at TEXT NOT NULL,
    PRIMARY KEY(tenant_id,operation_id)
  ) STRICT`,
 `CREATE TABLE synthetic_post_movements(
    tenant_id TEXT NOT NULL,operation_id TEXT NOT NULL,
    sku TEXT NOT NULL,units INTEGER NOT NULL CHECK(units>0),
    PRIMARY KEY(tenant_id,operation_id),
    FOREIGN KEY(tenant_id,operation_id) REFERENCES synthetic_auth_post_receipts(tenant_id,operation_id)
  ) STRICT`,
 `CREATE TRIGGER synthetic_post_receipt_apply AFTER INSERT ON synthetic_auth_post_receipts
    BEGIN
      UPDATE synthetic_post_stock SET available=available-NEW.units
      WHERE tenant_id=NEW.tenant_id AND sku='PIPE-1'
        AND available>=NEW.units;
      SELECT CASE WHEN changes()=1 THEN 1
        ELSE RAISE(ABORT,'synthetic posting stock assertion failed') END;
      INSERT INTO synthetic_post_movements(tenant_id,operation_id,sku,units)
      VALUES(NEW.tenant_id,NEW.operation_id,'PIPE-1',NEW.units);
    END`,
 `CREATE TRIGGER synthetic_post_journal_failure BEFORE INSERT ON synthetic_post_movements
    WHEN NEW.operation_id='OP-BAD'
    BEGIN SELECT RAISE(ABORT,'synthetic posting journal failure'); END`,
 `CREATE TRIGGER synthetic_post_receipt_no_update BEFORE UPDATE ON synthetic_auth_post_receipts
    BEGIN SELECT RAISE(ABORT,'synthetic posting receipt immutable'); END`,
 `CREATE TRIGGER synthetic_post_receipt_no_delete BEFORE DELETE ON synthetic_auth_post_receipts
    BEGIN SELECT RAISE(ABORT,'synthetic posting receipt immutable'); END`,
 `CREATE TRIGGER synthetic_post_movement_no_update BEFORE UPDATE ON synthetic_post_movements
    BEGIN SELECT RAISE(ABORT,'synthetic posting movement immutable'); END`,
 `CREATE TRIGGER synthetic_post_movement_no_delete BEFORE DELETE ON synthetic_post_movements
    BEGIN SELECT RAISE(ABORT,'synthetic posting movement immutable'); END`,
 `CREATE TRIGGER synthetic_post_role_version AFTER UPDATE OF status,can_post ON synthetic_post_roles
    WHEN NEW.status<>OLD.status OR NEW.can_post<>OLD.can_post
    BEGIN
      UPDATE synthetic_post_roles
      SET auth_version=MAX(NEW.auth_version,OLD.auth_version+1)
      WHERE tenant_id=NEW.tenant_id AND role_id=NEW.role_id;
    END`,
 `CREATE TRIGGER synthetic_post_user_version AFTER UPDATE OF status,role_id ON synthetic_post_users
    WHEN NEW.status<>OLD.status OR NEW.role_id<>OLD.role_id
    BEGIN
      UPDATE synthetic_post_users
      SET auth_version=MAX(NEW.auth_version,OLD.auth_version+1)
      WHERE tenant_id=NEW.tenant_id AND user_id=NEW.user_id;
    END`
]);

export const AUTHORIZED_POST_TENANTS=Object.freeze([
  ['TENANT-A','USER-A','ROLE-A','a'.repeat(64),2],
  ['TENANT-B','USER-B','ROLE-B','b'.repeat(64),2],
  ['TENANT-C','USER-C','ROLE-C','c'.repeat(64),2],
  ['TENANT-D','USER-D','ROLE-D','d'.repeat(64),1],
  ['TENANT-E','USER-E','ROLE-E','e'.repeat(64),2]
]);

export async function seedAuthorizedPost(DB){
  for(const [tenant,user,role,token,qty] of AUTHORIZED_POST_TENANTS){
    await DB.prepare(`INSERT INTO synthetic_post_roles
      (tenant_id,role_id,status,auth_version,can_post)
      VALUES (?,?,'Active',1,1)`).bind(tenant,role).run();
    await DB.prepare(`INSERT INTO synthetic_post_users
      (tenant_id,user_id,role_id,status,auth_version)
      VALUES (?,?,?,'Active',1)`).bind(tenant,user,role).run();
    await DB.prepare(`INSERT INTO synthetic_post_sessions
      (token_hash,tenant_id,user_id,role_id,user_version,role_version,expires_at,revoked_at)
      VALUES (?,?,?,?,1,1,2000,NULL)`).bind(token,tenant,user,role).run();
    await DB.prepare(`INSERT INTO synthetic_post_stock(tenant_id,sku,available)
      VALUES (?,'PIPE-1',?)`).bind(tenant,qty).run();
  }
  // Legitimate second user in tenant A, no shared session or receipt ownership.
  await DB.prepare(`INSERT INTO synthetic_post_users
    (tenant_id,user_id,role_id,status,auth_version)
    VALUES ('TENANT-A','USER-OTHER','ROLE-A','Active',1)`).run();
  await DB.prepare(`INSERT INTO synthetic_post_sessions
    (token_hash,tenant_id,user_id,role_id,user_version,role_version,expires_at,revoked_at)
    VALUES (?,'TENANT-A','USER-OTHER','ROLE-A',1,1,2000,NULL)`).bind('f'.repeat(64)).run();
}
