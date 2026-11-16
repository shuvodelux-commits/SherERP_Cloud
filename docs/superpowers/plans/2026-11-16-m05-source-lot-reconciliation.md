# M05 — Read-only source stock-lot reconciliation gate (2026-11-16)

**Source:** Frozen `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `StockLots.gs::reconcileProductStocksFromLots_` and `Config.gs::HEADERS.STOCK_LOTS/PRODUCTS`. **Target:** `shuvodelux-commits/SherERP_Cloud`, fresh `main` branch. Follow `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md` and ADR-007.

## Thirteen-sentence implementation overview

1. The original stock reconciliation routine totals **every** Stock Lot Remaining Quantity by exact Product ID, including negative OVERSOLD and Deleted lots.
2. It then updates a Product's cached Current Stock only when that Product has at least one matching lot and the cached numeric quantity differs.
3. That legacy routine is a mutating repair operation and must not be executed during a Cloudflare D1 migration audit.
4. Introduce an internal `auditSourceStockLotBalances` which computes the same source totals from explicit trusted snapshots but makes no writes.
5. Return one deterministic read-only row per Product with cached stock, lot total, difference, lot count and review status.
6. Preserve the original exact numeric comparison without silently rounding or filtering lots.
7. A negative OVERSOLD lot participates in the total and is reported as inventory context, not automatically treated as corruption.
8. Any positive-remaining Deleted lot is a review blocker because the source FIFO consumption and price ladder disagree about its eligibility.
9. Duplicate Product IDs, duplicate Lot IDs, orphan lots and nonfinite or malformed stock quantities must block readiness rather than be silently dropped.
10. Positive or negative cached stock with no lot evidence must be flagged, while zero-stock products with no lots remain legitimate.
11. The test suite must compare resulting totals and proposed mismatches with the frozen original GAS function executed against synthetic no-write stubs.
12. Commit RED tests importing a missing module, prove expected GitHub CI failure, then add the smallest GREEN implementation and validate all exact-head checks.
13. Do not change the original GAS code or source-faithful M05 planners, and do not add SQL migration, RPC, inventory mutation, Cash/Bank/Party posting or live cutover.

## Changed files / responsibility boundaries

- `docs/superpowers/plans/2026-11-16-m05-source-lot-reconciliation.md`: plan.
- `tests/m05-source-lot-reconciliation.test.mjs`: synthetic fixtures, original GAS oracle, safety and immutability checks.
- `src/modules/m05-source-lot-reconciliation.js`: pure read-only audit.
- **No shared file changes:** `src/db/**`, `migrations/**`, `src/auth/**`, `src/rpc/**`, `src/index.js`, `legacy/source/**`, `src/modules/stock-fifo-planning.js` or the original UI.
- No D1 tables, RPC surface, branch preview DB binding or live data export. No link between supplier identity and Party role accounts and no cross-role balance netting.

## Acceptance and merge gate

- Record RED GitHub Actions failure from missing new module.
- GREEN Node tests prove original GAS totals/mismatch parity, deleted positive-lot blocker, duplicate/orphan/invalid data flags, negative quantities, zero/no-lot treatment, stable output and unchanged inputs.
- Verify `npm test`, pinned-source checksum, existing browser/Worker safety checks and exact-head CI; do not claim real D1 posting was tested.
- Draft PR, owner review and dependency confirmation before merge. Revert the three added files to roll back; no business data changes.

## Relation to other M05 work

PR #322 was merged into the branch of still-open PR #313, not into main. This read-only audit starts from current main and does not import or edit that multi-unit branch. The full M05 Products/Stock Lots/Purchases schema, authorized D1 posting and historical multi-unit correction remain blocked until M02/M03/M04 owner-shared contracts are approved.
