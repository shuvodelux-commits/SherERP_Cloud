# M05 — Fail-closed FIFO lot eligibility preview gate (2026-11-16)

## 12-sentence implementation overview

1. SherERP M05 must preserve the frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` source behavior until a deliberate source/accounting review.
2. The already-source-identical `planStockConsumption_` selects positive-remaining `Status: Deleted` lots, but `buildLotPricingLadder_` excludes them.
3. This mismatch is proven in `tests/m05-fifo-planning.test.mjs` and is explicitly blocked by `docs/M05_FIFO_PLANNING_SOURCE_CONTRACT.md`.
4. Add a **new, internal, read-only** `planConsistentStockPreview` wrapper that refuses a target product snapshot with any deleted positive lot before calling either source planner.
5. The wrapper must not change the nine byte-for-byte source function bodies in `src/modules/stock-fifo-planning.js`.
6. With clean snapshots, preserve earliest purchase-date then Lot ID ordering, multi-supplier ownership, OVERSOLD negative lots, unchanged vendor net-owned shortage, and the same price-ladder outputs.
7. Invalid quantity, missing snapshots and product-ID mismatch must fail closed rather than trigger an implicit GAS read.
8. Deleted zero-remaining lots and deleted lots belonging to a different product must not block a valid preview.
9. Input product and lot snapshots must remain unmodified; the wrapper must issue no SQL, journal, operation ID or stock write.
10. The RED phase adds a Node test importing a non-existent module; capture the missing-module failure from GitHub Actions on this PR.
11. The GREEN phase introduces only the minimal wrapper, reruns exact-head Node/source checks and reports any CI gaps honestly.
12. This is **not** approval to integrate the wrapper into public POS, perform live purchases or sell stock; final M05 requires reviewed D1 lot SQL predicates, Party-role-safe posting, return reversal and authenticated real Workerd/D1 proof.

## Inventory / ownership

- **Read-only source:** `legacy/source/StockLots.gs` (unchanged), source manifest (unchanged), existing M05 planner.
- **New source:** `src/modules/m05-fifo-eligibility-gate.js` only; no shared `src/db`, `src/auth`, `src/rpc` or `src/index.js`.
- **New test:** `tests/m05-fifo-eligibility-gate.test.mjs`.
- **D1 tables/RPC:** none. No production migration, import, Worker binding, Cloudflare Preview change or public API.
- **Rollback:** revert the two added runtime/test files and this plan. No data migration or transaction reversal required.

## Acceptance

- [ ] RED exact GitHub Actions log demonstrates missing wrapper.
- [ ] GREEN passes all new tests on exact commit head; all existing original source-function equality tests remain valid.
- [ ] Existing `npm test`, immutable source verification and PR checks are inspected.
- [ ] No production or staging deployment, source Sheet mutation or financial transaction activation.
