# M07-B12 — Historical Partial Mixed-Unit Return Consumption Preflight

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and test-driven-development, run test-first RED, verify expected failure, then minimal GREEN and all exact-head CI.

**Goal:** Characterize a safe read-only historical partial mixed-unit Sales Return with original sale-time component factors and exact remaining `SALE_ITEM_LOTS` consumption rows, without guessing current FIFO, Cash/Store Credit money or live transaction authorization.

**Architecture:** Add one independent M07-only pure adapter `planHistoricalPartialUnitReturn(originalSale,intent)` and its original M06 sale snapshot characterization tests. Source `StockLots.gs::planSaleReturnRestoration_` sorts matching original sale consumption rows in **descending `_rowIndex`** and restores against their outstanding quantities before any fallback. Persisted original M06 `fifoDraws` must match immutable linked consumption-row origins, with active earlier return quantities reconciled against source remaining. Restrict B12 to one owned, non-bundle SKU, positive integer base pieces, known explicit original lots, and no Vendor/Negative/OVERSOLD/LEGACY fallback. The output is a **PLAN_ONLY** read projection and cannot authorize refund or posting.

**Tech:** ES modules, built-in `node:test`, original source `legacy/source/StockLots.gs` pinned to `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, and approved multi-units `sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c` (see issue #314 for canonical SHA).

**Ownership/coordination:** M07, issue #314, central #456. Base `main@bcd2d3adbd03f35612c50c1a144a472b1683b412`. Depends on fully merged PR #481 (head `06e7cdd8`, 44/44 CI), original B11 full-line proof. Own only `docs/superpowers/plans/2026-11-17-m07-b12-partial-unit-consumption.md`, `tests/m07-historical-partial-unit-return.test.mjs`, and `src/modules/m07-historical-partial-unit-return.js`. No overlap with other current M07 PR. All `src/db/**`, `src/rpc/**`, `migrations/**`, shared posting, `wrangler*`, M05/M06/M08, original source, Cash Session, production and UI are out of scope.

## Exact contract

The trusted `originalSale` is a plain own-data object with `tenantId,invoiceId,productId,stockUnit,sourceLineHash,baseQty,shortageMode,shortfallBaseQty,lineTotal,lineTotalPaisa,activeReturnedBaseQty,unitBreakdownSnapshot,unitPricingSnapshot,fifoDraws,consumptionRows`.

- Original M06 unit and pricing snapshots must be consistent. Historical conversion rows have positive integer factor and qty; `BASE` factor is one and all original components sum to `baseQty`.
- `fifoDraws` have distinct original lot IDs and positive base counts that sum to `baseQty`.
- Trusted consumption rows carry `{rowIndex,invoiceId,productId,lotId,sourceLinkId,remainingBaseQty}` for every original `fifoDraws` row; links and row indices are unique, positive and immutable. Source row remaining is between zero and original lot allocation.
- Sum of the current consumption remaining exactly equals `baseQty - activeReturnedBaseQty`. A claimed active return without identical historic consumption decrease needs review. This is not permission to silently net role balances.
- The strictly shaped intent is `{tenantId,invoiceId,productId,returnId,unitBreakdown:[{conversionId,qty},...]}` with positive integer selected quantities and no browser-supplied factor, price, lot or SQL. Missing, forged, duplicate, or inconsistent identity cannot be used.
- For a genuine partial request (`0 < selectedBaseQty < baseQty`), validate selected original unit quantities and original remaining capacity; if over the remaining total, decline without a restore preview.
- Restore only exact original lots in **descending source consumption rowIndex**, never current-date FIFO. A single request can span original rows without deduplicating them by product.
- Amount is intentionally **NOT projected**: historic component unit prices may have been rounded from a FIFO stream, and invoice discount/paid split require original M06/M08 journal. Do not compute `refundPaisa`, even from `lineTotalPaisa`; return `financialCalculationAuthorized:false`.
- No cash, bank, signed Customer or inventory changes; output excludes private purchase costs, supplier IDs, Party or Cash Session data.
- Decline unsupported shortage/fallback and existing FULL return case (B11), block invalid source provenance with `NEEDS_REVIEW` rather than using a fabricated lot.
- Original edited/deleted sale, linked returns in concurrent execution, actor/session permissions, future availability and debit/credit depend on M03+M04+M05+M06+M08 integrated checks, not this preview.

## TDD

- [ ] Commit this plan.
- [ ] Write 15+ test-first cases using the real merged M06 `planMultiUnitPosLine` output: 1 Bag+2 Box+5 Pcs = 145 Pcs, 100/45 original lots; partial 1 Box +5 Pcs gives 25 from latest lot; 1 Bag gives 45+55; previously returned 20 gives 25+10; current product price/factor change has no effect; no refund calculation.
- [ ] Assert strict negative cases: unknown unit, tampered source factor/pricing, stale consumption outstanding, missing/duplicate links/rowIndices/lots, wrong shop/invoice/product, previously fully returned, arbitrary extra intent keys, unsupported Own/Vendor/OVERSOLD, overflow.
- [ ] RED commit **without implementation**, verify exact GitHub Foundation log indicates intended missing M07 module (existing tests passing).
- [ ] Implement smallest pure read-only M07 module. Do not change B11 or M06.
- [ ] Run Foundation Node, source parity, M03 six-shard Workerd/D1, Cloudflare preview, security, Playwright/Chromium, all exact-head CI. Fix real failures on M07 files only and record test runs.
- [ ] Scoped PR with merge order B11→B12, exact SHA, rollback revert of three owned files, nonposting limitations, no conflict, and owner review. Do not merge before full required green CI.

**Review blocker / production gate:** An original FIFO source row's `_rowIndex` is *ordering evidence*, not a stable DB primary key by itself. M02 import and M03 atomically versioned `SALE_ITEM_LOTS` identity and actual source linkage must be reviewed before using this in real financial operations. M07-B12 is intentionally a source-shape preflight only.
