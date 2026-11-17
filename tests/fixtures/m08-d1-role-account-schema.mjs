/**
 * M08 disposable test-only finance/Party role schema, real local Workerd D1.
 * No production migrations or live accounts / financial postings.
 * Duplicate imported original IDs intentionally remain representable for audit.
 */
export const M08_ROLE_DDL=Object.freeze([
  `CREATE TABLE m08_role_persons (
    tenant_id TEXT NOT NULL,
    legacy_row INTEGER NOT NULL CHECK(legacy_row>=2),
    person_id TEXT NOT NULL,
    person_name TEXT NOT NULL,
    person_type TEXT NOT NULL,
    roles TEXT NOT NULL,
    status TEXT NOT NULL,
    phone TEXT NOT NULL,
    description TEXT NOT NULL,
    PRIMARY KEY(tenant_id,legacy_row)
  ) STRICT`,
  `CREATE TABLE m08_role_finance (
    tenant_id TEXT NOT NULL,
    legacy_row INTEGER NOT NULL CHECK(legacy_row>=2),
    finance_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    person TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
    is_deleted INTEGER NOT NULL CHECK(is_deleted IN(0,1)),
    PRIMARY KEY(tenant_id,legacy_row)
  ) STRICT`,
  `CREATE TABLE m08_role_party (
    tenant_id TEXT NOT NULL,
    legacy_row INTEGER NOT NULL CHECK(legacy_row>=2),
    ledger_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN('customer','supplier')),
    legacy_id TEXT NOT NULL,
    date_text TEXT NOT NULL,
    type TEXT NOT NULL,
    debit_cents INTEGER NOT NULL CHECK(debit_cents>=0),
    credit_cents INTEGER NOT NULL CHECK(credit_cents>=0),
    is_deleted INTEGER NOT NULL CHECK(is_deleted IN(0,1)),
    created_at TEXT NOT NULL,
    source_name TEXT NOT NULL,
    PRIMARY KEY(tenant_id,legacy_row)
  ) STRICT`
]);
