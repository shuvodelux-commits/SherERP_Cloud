/**
 * Disposable strict local D1 schema for M08 opening explanation parity.
 * Original source row positions and integer cents remain isolated by tenant.
 * TEST-ONLY; never import from production migrations, Worker or RPC.
 */
export const M08_OPENING_DDL=Object.freeze([
  `CREATE TABLE m08_opening_sessions(
    tenant_id TEXT NOT NULL,
    legacy_row INTEGER NOT NULL CHECK(legacy_row>=2),
    session_id TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    status TEXT NOT NULL,
    opening_cents INTEGER NOT NULL,
    expected_cents INTEGER,
    counted_cents INTEGER,
    variance_cents INTEGER,
    opening_entry_ids TEXT NOT NULL,
    closing_entry_ids TEXT NOT NULL,
    PRIMARY KEY(tenant_id,legacy_row)
  ) STRICT`,
  `CREATE TABLE m08_opening_cash(
    tenant_id TEXT NOT NULL,
    legacy_row INTEGER NOT NULL CHECK(legacy_row>=2),
    entry_id TEXT NOT NULL,
    type TEXT NOT NULL,
    reference TEXT NOT NULL,
    date_text TEXT NOT NULL,
    description TEXT NOT NULL,
    credit_cents INTEGER NOT NULL,
    debit_cents INTEGER NOT NULL,
    is_deleted INTEGER NOT NULL CHECK(is_deleted IN (0,1)),
    PRIMARY KEY(tenant_id,legacy_row)
  ) STRICT`
]);
