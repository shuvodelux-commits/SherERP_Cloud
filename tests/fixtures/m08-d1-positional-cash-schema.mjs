/**
 * Disposable D1 tables for original Cash Session/Cash Book row order.
 * Test-only: never import into production migrations or public Workers.
 */
export const M08_POSITIONAL_DDL=Object.freeze([
  `CREATE TABLE m08_positional_sessions (
    tenant_id TEXT NOT NULL,
    legacy_row INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    status TEXT NOT NULL,
    opening_cents INTEGER NOT NULL,
    counted_cents INTEGER,
    opening_entry_ids TEXT NOT NULL,
    closing_entry_ids TEXT NOT NULL,
    PRIMARY KEY (tenant_id,legacy_row),
    CHECK (legacy_row>=1)
  ) STRICT`,
  `CREATE TABLE m08_positional_cash (
    tenant_id TEXT NOT NULL,
    legacy_row INTEGER NOT NULL,
    entry_id TEXT NOT NULL,
    type TEXT NOT NULL,
    reference TEXT NOT NULL,
    credit_cents INTEGER NOT NULL,
    debit_cents INTEGER NOT NULL,
    is_deleted INTEGER NOT NULL CHECK (is_deleted IN (0,1)),
    date_text TEXT NOT NULL,
    PRIMARY KEY (tenant_id,legacy_row),
    CHECK (legacy_row>=1)
  ) STRICT`
]);
