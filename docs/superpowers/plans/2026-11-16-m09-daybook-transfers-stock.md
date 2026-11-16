# M09 Bank Transfer / Stock Adjustment Day Book — Superpowers TDD plan

**Source:** Mohim_ERP pinned `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, preserved `legacy/source/DayBook.gs`. **Design:** `docs/superpowers/specs/2026-11-16-m09-daybook-transfers-stock-design.md`.

**Goal:** Reproduce original two zero-money Day Book sections, not bank postings, valuation or an RPC route.

**Architecture:** Internal pure `projectDayBookTransferStockRows({bankTransfers,stockMovements})`. Both arrays are mandatory complete, already-authorized source-equivalent inputs with canonical shop-local dates. Exact original `dayBookRow_` output. Implement independently of open PR #381/#386, merged Bank Book dedup #342 and other source rows.

## Task 1 — RED first
- [ ] Create spec/plan and `tests/m09-daybook-transfers-stock.test.mjs` before production source.
- [ ] Tests extract and run **unmodified** frozen Bank transfers and Stock adjustments blocks, open/delete maps and `dayBookRow_` via Node VM. Normalize only trusted `safeDateOnly_` shop date function.
- [ ] Verify exact full row object and source section order; one bank transfer row zero money/Bank method; Stock Type case-sensitive `Adjust`; movement Product ID vs Movement ID navigation; plus/minus quantity `(+qty)`, `(-qty)`, `(-0)`; date-only and local timestamp; original default audit fields; empty legacy Transfer ID behavior; no mutations, malformed IDs/snapshots/quantities and unchanged UI/closed RPC.
- [ ] Commit test-only RED, open draft GitHub PR, observe expected missing projector fail in **actual GitHub Actions** before creating source module. Record SHA, URL, counts.

## Task 2 — Minimal GREEN implementation
- [ ] Add `src/modules/daybook-transfers-stock.js` after verified RED. No shared M03/M08/Bank/D1 writer edits.
- [ ] Validate full trusted arrays/records, canonical dates and finite quantities, safe unique source IDs; project exact source-shaped rows.
- [ ] Verify full Node, frozen original integrity, build, Workerd, browser and PR safety checks at exact GREEN SHA. Fix regression/test fixture if needed, always read failing logs. Do not extrapolate D1 accounting parity from pure model.

## Task 3 — Owner review
- [ ] Update PR with TDD run evidence, changed-file inventory, remaining integration gates and rollback.
- [ ] Compare to latest main for mergeability; keep draft/unmerged. No local Desktop, production D1 or business-data import.
- [ ] Next: complete authorized and tenant-isolated D1 source adapter that assembles all original Day Book rows, match Cash Book chronology and standalone Bank Book dedup, reconcile aggregate Cash/Bank with posted M07/M08 source ledgers before enabling public RPC, then M10/M11 separately approved cutover.

## Shared M07 Workerd D1 check unblock (2026-11-16)

Historical M03 D1 integration failed solely on `unpaid original purchase Supplier Credit correction never creates Cash entry` (485/486 passing): an M07 synthetic test supplied a blank **input** payment method despite the purchase writer requiring `Cash` or `Bank`. The original business rule remains that **zero paid amount persists no tender method and posts no Cash/Bank entry**. The independent source-compatible repair is owner-merged [#390](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/390) (20/20 checks at fix SHA `5a586e75d86cd40bcef3da739179ad70ace5f46d`). This branch now merges `main@0e4dbd5c17f3e33077e1b81f7799a8d42c29758e`, with the M07 fixture fix and all four original M09 files preserved. No M09 projector/financial writer was changed for this CI issue. **Verify fresh exact-head M03 Workerd/D1 and all PR checks before treating this PR as GREEN.**
