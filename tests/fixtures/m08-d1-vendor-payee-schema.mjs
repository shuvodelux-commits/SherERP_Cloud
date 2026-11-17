/**
 * M08 #580 disposable local Workerd/D1 only.
 * Retain duplicate source identifiers for import-reconciliation rejection.
 * No production migration, canonical posting, transaction semantics or RPC.
 */
export const M08_VENDOR_PAYEE_DDL=Object.freeze([
  `CREATE TABLE m08_vp_vendors (
    tenant_id TEXT NOT NULL,
    legacy_row INTEGER NOT NULL CHECK (legacy_row>=2),
    vendor_id TEXT NOT NULL,
    vendor_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    due_cents INTEGER NOT NULL,
    receivable_cents INTEGER NOT NULL,
    status TEXT NOT NULL,
    is_deleted INTEGER NOT NULL CHECK (is_deleted IN (0,1)),
    PRIMARY KEY (tenant_id,legacy_row)
  ) STRICT`,
  `CREATE TABLE m08_vp_ledger (
    tenant_id TEXT NOT NULL,
    legacy_row INTEGER NOT NULL CHECK (legacy_row>=2),
    ledger_id TEXT NOT NULL,
    vendor_id TEXT NOT NULL,
    date_text TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    reference TEXT NOT NULL,
    balance_type TEXT NOT NULL,
    debit_cents INTEGER NOT NULL,
    credit_cents INTEGER NOT NULL,
    stored_balance_cents INTEGER NOT NULL,
    is_deleted INTEGER NOT NULL CHECK (is_deleted IN (0,1)),
    created_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id,legacy_row)
  ) STRICT`,
  `CREATE TABLE m08_vp_payees (
    tenant_id TEXT NOT NULL,
    legacy_row INTEGER NOT NULL CHECK (legacy_row>=2),
    payee_id TEXT NOT NULL,
    payee_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    status TEXT NOT NULL,
    is_deleted INTEGER NOT NULL CHECK (is_deleted IN (0,1)),
    PRIMARY KEY (tenant_id,legacy_row)
  ) STRICT`,
  `CREATE TABLE m08_vp_expenses (
    tenant_id TEXT NOT NULL,
    legacy_row INTEGER NOT NULL CHECK (legacy_row>=2),
    expense_id TEXT NOT NULL,
    payee_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    payment_method TEXT NOT NULL,
    status TEXT NOT NULL,
    is_deleted INTEGER NOT NULL CHECK (is_deleted IN (0,1)),
    PRIMARY KEY (tenant_id,legacy_row)
  ) STRICT`
]);
