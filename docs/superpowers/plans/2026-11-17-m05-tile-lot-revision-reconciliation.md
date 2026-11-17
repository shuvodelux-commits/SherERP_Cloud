# M05 — Revision-aware Tiles stock-lot reconciliation (nondeployable)

**Workstream:** M05 · **Tracking:** #314 · **Parallel coordination:** #456
**Base on GitHub main:** `1f068fc3c30c625446c560364fb872ae68cb8bc1`
**File owner:** M05; add only dedicated M05 module, tests and Superpowers plan.
**Dependency versions:** `src/modules/m05-tile-stock-view.js` merged via PR #458; exact `tile-quantity-contract.js` merged M02/M03; source stock-lot audit `m05-source-lot-reconciliation.js` is read-only reference.
**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `StockLots.gs::reconcileProductStocksFromLots_` (sums all lot Remaining Quantity including OVERSOLD and Deleted); tiles area coverage from approved current M02 contract; approved optional source `sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c`.
**Protected paths:** M03 alone owns `src/db/**`, `migrations/**`, shared posting kernel, `src/rpc/**`, `src/index.js`, Worker bindings. None changed.

## 12-sentence source-parity overview

1. Original SherERP stock reconciliation sums each original Product ID's lot Remaining Quantity, including OVERSOLD negative and Deleted historical lots.
2. The approved Tiles model uses canonical signed whole Pcs stock balances and separate versioned box and coverage measurements.
3. Existing PR #458 projects one trusted signed Pcs balance into Box/Pcs/exact Sqft but does not reconcile multiple source lots.
4. Add one internal pure report function `auditTileLotStock(snapshot)` for one explicit original product identity.
5. The caller supplies a trusted current canonical Pcs balance and an array of individual original lot rows with their original versioned catalogs and measurement snapshots.
6. Lot identities, product IDs, integer quantities and snapshot data must be explicit and fail closed when malformed, duplicated or inconsistent.
7. For every lot, reuse the approved `projectTileStockView` to preserve historical measurement revisions, pack sizes, manufacturer coverage and signed OVERSOLD quantity.
8. Sum physical lot Pcs using bounded BigInt rather than floating-point coercion and compare it to the trusted product stock.
9. Include Deleted lots in the physical sum, but flag any Deleted positive remaining balance as an import/reconciliation blocker.
10. Compute an exact rational aggregate historical Sqft only if every lot has the same verified measurement profile; otherwise show per-lot areas and explicitly withhold a misleading mixed-revision aggregate.
11. Return explicit ready/status/issue evidence without modifying inputs, SQL, source records, stock, Party/Cash/Bank balances, FIFO allocations, returns or permission boundaries.
12. Use a test-only RED commit followed by the smallest GREEN helper and full exact-head CI, and leave any future authenticated D1 integration and public read exposure to M03/M04.

## Acceptance and integration notes

- API: `auditTileLotStock({productId,cachedStockPcs,lots})`, with each lot `{lotId,productId,remainingPcs,status,catalog,measurement}`.
- Snapshot identity and revisions must match within each lot; source identities are never inferred from names, SKU labels or phone numbers.
- Report: `{mode,productId,cachedStockPcs,lotStockPcs,differencePcs,status,areaState,aggregateSqft,lotViews,issues,ready,postingAllowed:false}`.
- `status` is `MATCH`, `MISMATCH`, `NO_LOTS_ZERO` or `NO_LOTS_NONZERO`. `areaState` is `UNIFORM_MEASUREMENT`, `MIXED_MEASUREMENTS` or `NO_LOTS`.
- Mixed measurement profiles do not imply stock mismatch, but aggregate Sqft must be null because old vs new coverage may be physically incompatible. No historical data are recalculated through today's measurement version.
- TDD coverage: positive+OVERSOLD sum, revision drift, manufacturer evidence, Deleted positive, missing lots, duplicates/orphans, integer/safe bounds, no mutations, no public RPC.
- New files only: `docs/superpowers/plans/2026-11-17-m05-tile-lot-revision-reconciliation.md`, `tests/m05-tile-lot-revision-reconciliation.test.mjs`, `src/modules/m05-tile-lot-revision-reconciliation.js`.
- **No SQL/RPC/table/financial write surface or original frontend modification**; the M03 readiness gate remains blocked.
- Merge order: #458 verified on main → new M05 PR against main → current-head full CI + review → main merge only after gates → verify all three files landed on main. No production data migration.
- Rollback: revert only the three new files; no database operation or data rollback necessary.
