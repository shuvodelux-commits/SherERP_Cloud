# M09 Dashboard Customer/Supplier Due + Low Stock Parity — Design (2026-11-15)

**Source authority:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/Dashboard.gs::getDashboardStats` and `Utils.gs::roundMoney_`.
**Architecture:** Preserve original ERP HTML/JS and source RPC; independently test a read-only projection for three dashboard cards. Do not fabricate M08 finance/cash balances.

## Source contract and non-negotiable semantics

The pinned `getDashboardStats` reads `activeRows_('CUSTOMERS')`, `activeRows_('SUPPLIERS')`, and `activeRows_('PRODUCTS')`. Each call must return already-authorized, **active** rows. The snapshot reader must preserve original Customer/Supplier role/account separation; this adapter does not infer Party identities, merge by phone/name, create debts from Payees, or net one role against another.

- `dueReceivable`: source `roundMoney_(SUM(max(0,Number(customer['Current Due'])||0)))`. Negative individual Customer balances are NOT netted against positive debt of other customers or against supplier roles. In this source UI, this is gross positive Customer Due; advances are not shown.
- `supplierPayable`: source `roundMoney_(SUM(max(0,Number(supplier['Current Due'])||0)))`. Positive Supplier Due, not offset against customer debt, supplier advances or vendor payable.
- `lowStockCount`: for each already-active Product row, skip only exact `Status === 'Inactive'`, otherwise increment if `Number(Current Stock) <= Number(Minimum Stock)`. Blank numeric cells coerce to zero; absent column to `NaN` (therefore not flagged). Negative stock can be flagged and exact boundary qualifies. Do not invent a status or other stock filter.
- Rounding uses original JS `roundMoney_` algorithm. Internal read-only values only; this projection is not an authoritative ledger reconciliation or financial posting operation.

**API:** `projectDashboardDueStock(snapshot)` -> `{dueReceivable, supplierPayable, lowStockCount}`. `snapshot` is a plain object with `customers`, `suppliers`, `products` arrays of trusted source-shaped plain rows (each already filtered for active status). Fail closed for missing arrays, leaked Promise, missing/null row, accessor fields, and nonfinite numeric amounts rather than leaking invalid metrics. Do not mutate input. No hidden state, fetch, SQL or date dependency.

## Alternatives considered

1. Implement the full live Dashboard RPC with D1 finance joins now — rejected: upstream M05/M07/M08 and auth read gates are still independently owned.
2. Compute a single cross-role Party net — rejected by owner-approved ADR-007 and the native Dashboard behavior.
3. **Selected:** small pure projection and native GAS oracle. Future authorized D1 reader will provide separately mapped active Customer/Supplier/Product groups, including source Current Due semantics. Its actual DB filters and financial reconciliation require a later integration PR.

## Verification, impact and residual gates

- New Node test file executes frozen original `getDashboardStats` and `roundMoney_` in `node:vm`, with inert stubs for unrelated daily activity, cash and finance. Tests compare exact three source fields on positive, negative, decimal, missing, inactive, zero/negative stock, and cross-role same-ID fixtures.
- Test-first commit must produce expected RED failure on GitHub Actions. Minimal module commit must produce GREEN; report exact-head suite and preview safety checks, never infer results.
- No changes to GAS, browser DOM, RPC allowlist, permission code, shared `src/db` or `src/rpc`, schema, D1, posting, cash, bank, Party identity/linking or returns. No source file copying or mechanical rewrite. Revert four new files to roll back.
- Full M09 waits for authenticated D1 snapshots, existing account/stock writers, full dashboard tiles, report totals, browser with real fixtures, and reconciliation across the seven distinct Party role balances.
