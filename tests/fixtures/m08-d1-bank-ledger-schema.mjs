/**
 * Isolated real local Workerd D1 Bank Account / Bank Book test tables.
 * NOT a migration: source legacy_row is original physical order, and duplicate
 * imported Account/Entry IDs remain representable to detect ambiguity.
 */
export const M08_BANK_DDL=Object.freeze([
  `CREATE TABLE m08_bank_accounts (
    tenant_id TEXT NOT NULL,
    legacy_row INTEGER NOT NULL CHECK(legacy_row>=1),
    account_id TEXT NOT NULL,
    account_name TEXT NOT NULL,
    bank_name TEXT NOT NULL,
    account_number TEXT NOT NULL,
    opening_cents INTEGER NOT NULL,
    current_cents INTEGER NOT NULL,
    status TEXT NOT NULL,
    account_type TEXT NOT NULL,
    PRIMARY KEY (tenant_id,legacy_row)
  ) STRICT`,
  `CREATE TABLE m08_bank_book (
    tenant_id TEXT NOT NULL,
    legacy_row INTEGER NOT NULL CHECK(legacy_row>=1),
    entry_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    date_text TEXT NOT NULL,
    type TEXT NOT NULL,
    reference TEXT NOT NULL,
    description TEXT NOT NULL,
    debit_cents INTEGER NOT NULL,
    credit_cents INTEGER NOT NULL,
    status TEXT NOT NULL,
    reversal_of TEXT NOT NULL,
    notes TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    is_backdated INTEGER NOT NULL CHECK(is_backdated IN (0,1)),
    backdated_days INTEGER NOT NULL,
    backdated_reason TEXT NOT NULL,
    PRIMARY KEY (tenant_id,legacy_row)
  ) STRICT`
]);
