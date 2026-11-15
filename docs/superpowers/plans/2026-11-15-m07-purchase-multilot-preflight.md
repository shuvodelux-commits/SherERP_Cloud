# M07-B3 — Source-faithful Purchase Return multi-lot preflight (small TDD slice)

## Scope and source
Frozen Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2, StockLots.gs: compareLotsFifo_, lotSellPrice_, planStockConsumption_, planPurchaseReturnLotReduction_, and PurchaseReturn.gs: completePurchaseReturn. Read AGENTS.md, docs/WORKSTREAMS.md, docs/MIGRATION_PLAN.md, ADR-007 and previous M07-B1/B2 proof. M07-B1/B2 cover **single original purchase lot** only.

## Goal
Add a pure internal preflight helper to plan a Purchase Return across multiple eligible original purchase lots, without modifying any lot, stock, supplier balance, cash, or bank. Compare results against the byte-pinned real native StockLots.gs function executed as a test oracle, instead of inventing a second financial posting mechanism. Never enable a public return RPC, actual D1 financial writes, or production D1 schema through this PR.

## Acceptance
1. Match native purchase-lot filter (Purchase ID AND Product ID), positive remaining and FIFO purchase date then Lot ID; do not use another purchase's lots if the source purchase has any lot rows.
2. Draw across two or more same-purchase lots exactly; preserve original row index, lot cost and remaining-after values; never mutate input rows.
3. If source purchase has zero matching lot rows, preserve native legacy fallback to the product's positive stock lots in FIFO order, with explicit `legacyFallback: true` for future M07/M05 review.
4. Insufficient quantities decline *before writing* with native source messages. Handle exhausted source lots, zero, partial and fractional quantities.
5. Fail closed for invalid untrusted input and ambiguous duplicate Lot IDs; never use browser-provided actor/Party/account data.
6. Commit tests first (RED: missing module), then the minimal source-derived helper (GREEN), and verify the full GitHub CI. Do not claim real D1 transaction proof from a pure in-memory function.

## File and ownership boundaries
- Add `tests/m07-purchase-multilot-preflight.test.mjs`: byte-pinned original oracle and regressions.
- Add `src/modules/purchase-return-lot-plan.js`: pure isolated preflight, no I/O, no RPC.
- Add this plan. No modification to `src/db/**`, `src/rpc/**`, migrations, shared M05/M06/M08 posting kernel, original source/HTML, Cloudflare bindings or credentials.
- Input is trusted, sanitized source-shaped normalized stock-lot rows from future M03; normalizing DB records, resolving reviewed Party links, cash-session authorization and actual purchase-return SQL batch remain separately gated work.

## Follow-up
M07-B4 must prove atomic multi-lot Purchase Cash/Supplier Credit posting in **real local Workerd/D1**, including same-purchase and SKU ownership, concurrent returns/rollback, paid Cash ceiling, source signed Supplier account and cross-method IDs. Block production activation until M03/M04/M05/M06/M08 financial gates and owner approval. Rollback is PR revert; no remote data changed.
