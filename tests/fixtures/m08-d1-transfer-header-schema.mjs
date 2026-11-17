/**
 * Local M08 Workerd/D1 synthetic BANK_TRANSFERS header storage only.
 * Not a production migration, transfer writer, foreign-key policy or RPC.
 * Original IDs deliberately lack UNIQUE constraints to detect bad imports.
 */
export const M08_TRANSFER_DDL=Object.freeze([
  `CREATE TABLE m08_transfer_headers (
    tenant_id TEXT NOT NULL,
    legacy_row INTEGER NOT NULL CHECK(legacy_row>=2),
    transfer_id TEXT NOT NULL,
    date_text TEXT NOT NULL,
    from_account_id TEXT NOT NULL,
    to_account_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    is_deleted INTEGER NOT NULL CHECK(is_deleted IN(0,1)),
    notes TEXT NOT NULL,
    created_by TEXT NOT NULL,
    PRIMARY KEY(tenant_id,legacy_row)
  ) STRICT`
]);
