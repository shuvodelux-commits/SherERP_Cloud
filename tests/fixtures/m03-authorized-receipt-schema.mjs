/**
 * Synthetic M03/M04 receipt authorization schema, used ONLY inside local
 * Node in-memory SQLite and nondeployable Workerd/D1 acceptance tests.
 * Not a numbered migration and not a production auth table definition.
 */
export const AUTHORIZED_RECEIPT_DDL=Object.freeze([
  `CREATE TABLE synthetic_auth_roles(
    tenant_id TEXT NOT NULL, role_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('Active','Inactive')),
    auth_version INTEGER NOT NULL CHECK(auth_version>=1),
    can_read_receipt INTEGER NOT NULL CHECK(can_read_receipt IN (0,1)),
    PRIMARY KEY(tenant_id,role_id)
  ) STRICT`,
  `CREATE TABLE synthetic_auth_users(
    tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('Active','Inactive')),
    auth_version INTEGER NOT NULL CHECK(auth_version>=1),
    PRIMARY KEY(tenant_id,user_id),
    FOREIGN KEY(tenant_id,role_id) REFERENCES synthetic_auth_roles(tenant_id,role_id)
  ) STRICT`,
  `CREATE TABLE synthetic_auth_sessions(
    token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
    tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL,
    user_version INTEGER NOT NULL, role_version INTEGER NOT NULL,
    expires_at INTEGER NOT NULL, revoked_at INTEGER,
    FOREIGN KEY(tenant_id,user_id) REFERENCES synthetic_auth_users(tenant_id,user_id),
    FOREIGN KEY(tenant_id,role_id) REFERENCES synthetic_auth_roles(tenant_id,role_id)
  ) STRICT`,
  `CREATE TABLE operation_receipts(
    tenant_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
    result_ref TEXT NOT NULL,
    committed_at TEXT NOT NULL,
    PRIMARY KEY(tenant_id,operation_id)
  ) STRICT`,
  `CREATE TRIGGER authorized_receipt_immutable_update
    BEFORE UPDATE ON operation_receipts
    BEGIN SELECT RAISE(ABORT,'Committed receipt immutable'); END`,
  `CREATE TRIGGER authorized_receipt_immutable_delete
    BEFORE DELETE ON operation_receipts
    BEGIN SELECT RAISE(ABORT,'Committed receipt immutable'); END`,
  `CREATE TRIGGER authorized_role_version_bump
    AFTER UPDATE OF status,can_read_receipt ON synthetic_auth_roles
    WHEN NEW.status<>OLD.status OR NEW.can_read_receipt<>OLD.can_read_receipt
    BEGIN
      UPDATE synthetic_auth_roles
      SET auth_version=MAX(NEW.auth_version,OLD.auth_version+1)
      WHERE tenant_id=NEW.tenant_id AND role_id=NEW.role_id;
    END`,
  `CREATE TRIGGER authorized_user_version_bump
    AFTER UPDATE OF status,role_id ON synthetic_auth_users
    WHEN NEW.status<>OLD.status OR NEW.role_id<>OLD.role_id
    BEGIN
      UPDATE synthetic_auth_users
      SET auth_version=MAX(NEW.auth_version,OLD.auth_version+1)
      WHERE tenant_id=NEW.tenant_id AND user_id=NEW.user_id;
    END`
]);

export const AUTHORIZED_RECEIPT_SEED=Object.freeze([
  [`INSERT INTO synthetic_auth_roles(tenant_id,role_id,status,auth_version,can_read_receipt)
    VALUES ('TENANT-A','ROLE-A','Active',1,1),('TENANT-B','ROLE-B','Active',1,1)`,[]],
  [`INSERT INTO synthetic_auth_users(tenant_id,user_id,role_id,status,auth_version)
    VALUES ('TENANT-A','USER-A','ROLE-A','Active',1),
           ('TENANT-A','USER-C','ROLE-A','Active',1),
           ('TENANT-B','USER-B','ROLE-B','Active',1)`,[]],
  [`INSERT INTO synthetic_auth_sessions(token_hash,tenant_id,user_id,role_id,
      user_version,role_version,expires_at,revoked_at)
    VALUES (?,'TENANT-A','USER-A','ROLE-A',1,1,2000,NULL),
           (?,'TENANT-A','USER-C','ROLE-A',1,1,2000,NULL),
           (?,'TENANT-B','USER-B','ROLE-B',1,1,2000,NULL)`,
    ['a'.repeat(64),'c'.repeat(64),'b'.repeat(64)]]
]);
