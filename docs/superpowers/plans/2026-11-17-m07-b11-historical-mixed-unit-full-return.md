# M07-B11 — Historical Mixed-Unit Full-Line Sales Return Read-Only Preflight

**Issue / coordination:** #314 (M05/M06/M07 multi-unit transaction parity); #456 (M01–M11 workstream board). **Workstream:** M07. **Base main SHA:** `1f068fc3c30c625446c560364fb872ae68cb8bc1`.

**Goal:** Make a source-faithful M07-owned read-only preflight for *one full mixed-unit sale line* using only the trusted persisted sale-time M06 line, rather than today's M05 product unit configuration. Do not claim a partial mixed-unit return, stock restoration writer or original GAS parity.

**Frozen source:** Original FIFO/stock/Return: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (`StockLots.gs`, `SalesReturn.gs`). Approved conversion rules: `sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c`. Current merged proof: `src/modules/m06-multi-unit-pos-line.js` (`planMultiUnitPosLine` output with `unitBreakdownSnapshot`, `unitPricingSnapshot`, `fifoDraws`, `baseQty`, `lineTotal`, `shortfallBaseQty`). B6/B7/B8/B9/B10 local return proofs are merged. This work composes source evidence and does not copy/modify frozen source.

## Scope, file owners and independence

Only three **M07-owned** files:
1. `docs/superpowers/plans/2026-11-17-m07-b11-historical-mixed-unit-full-return.md`
2. `tests/m07-historical-mixed-unit-full-return.test.mjs` (Node source-intent characterization)
3. `src/modules/m07-historical-mixed-unit-full-return.js` (pure read-only planner; GREEN only)

No `src/db/**`, `src/rpc/**`, `migrations/**`, Worker entry or `wrangler*.jsonc`, source posting kernel, Cash Session, M05/M06 owned code, UI, original GAS or live/staging data. No new dependencies, SQL, D1, auth or API. Since this slice is a **pure read-only calculation** from already persisted trusted rows, the verification is Node/source tests plus full existing GitHub CI, not a claim of new D1 posting integration. M03 must verify provenance atomically at any future real return writer.

## Behavioral contract

`planHistoricalMixedUnitFullReturn(source, intent)` consumes a **trusted immutable sale-time snapshot** and a strictly shaped return request (IDs plus original unit quantities only), never today's product/conversion catalog.

- Source is `{tenantId,invoiceId,productId,stockUnit,sourceLineHash,baseQty,shortageMode,shortfallBaseQty,lineTotal,lineTotalPaisa,activeReturnedBaseQty,unitBreakdownSnapshot,unitPricingSnapshot,fifoDraws}`.
- Expected snapshot rows are exactly those emitted by merged M06: `{conversionId,unitName,factor,qty}`, `{conversionId,unitName,factor,qty,unitPrice}`, and `{lotId,baseQty}`.
- Intent is exactly `{tenantId,invoiceId,returnId,productId,unitBreakdown:[{conversionId,qty}]}`; browser-supplied factors, prices, lot IDs, actor authorization or SQL are rejected, not used.
- Every historical factor and qty is a strictly positive safe integer in this initial physical-piece use case; unsupported fractional/base units **fail closed** for separate review. Multi-unit rows must be complete and match one original sale line, including `BASE` with factor 1.
- Historical component base quantities must sum exactly to persisted `baseQty`. Distinct positive FIFO lot draws must sum to that same base quantity; `shortageMode:Own` and `shortfallBaseQty:0` are mandatory.
- Pricing snapshot IDs/names/factors/quantities must match unit snapshot. `lineTotalPaisa` is the authoritative saved monetary evidence, not a fresh multiplication of rounded effective unit prices; source `lineTotal` and `lineTotalPaisa` must agree to one paisa.
- A requested full-line return must match all historical component conversion IDs and quantities. Partial/subset return is explicitly **DECLINED** rather than assigning source FIFO lots without item-lot evidence.
- If active returns already consume any quantity, full-line return is **DECLINED**. Deleted earlier returns must be excluded by the trusted active-return projection upstream; the planner does not independently infer deleted-row state.
- Return result contains **only** original sale facts and restore-lot feasibility intention, with `readOnly:true,commitAuthorized:false`; no stock/cash/ledger mutations or M04 permission claims.
- Missing/duplicate original IDs, malformed trusted source (including getters), mismatched lot quantities, forged intent fields, hostile money/price snapshots or unsafe integers must throw an explicit validation / `NEEDS_REVIEW` error.

## Superpowers RED → GREEN

1. Commit the plan and acceptance tests first; tests import a not-yet-created M07 module and fail as expected.
2. Verify actual GitHub Node/source CI RED for the missing contract (no D1 or production changes).
3. Commit only the minimal pure M07 planner implementing this test contract.
4. Run all current-head required CI (including M03's existing full Workerd/D1 shards, UI/Chromium and source policies), fix genuine failures, and record RED/GREEN SHAs and test runs in the PR.
5. Leave PR unmerged for owner review even if full checks pass. Check `main`/merge conflicts before merge and verify actual files on main afterward.

## Representative acceptance

- Frozen M06 1 Bag + 2 Box + 5 Pcs = **145 Pcs**, sale total **৳1,340**, original FIFO lots **100 + 45**. A full-line read-only return shows exactly 145 Pcs, 134000 paisa and original lot restore intentions.
- After changing/removing current product unit conversions and selling prices, that historical output is unchanged.
- Browser-provided `factor`, `unitPrice`, `sourceLot`, account/permission or SQL is rejected.
- Missing source breakdown/pricing, changed source factors, lost lot, duplicated ID, unsafe decimal/overflow, mismatched money, unsupported vendor/negative shortage or partial return all fail closed.
- No mutation of either input; returned arrays are separate immutable copies; no Supplier/Customer/Cash/Bank balance appears in the projection.

**Production blockers:** M03 atomic source-of-truth financial and lot reversal, M04 trusted actor/tenant roles and Cash Session, M05 multi-lot/OVERSOLD/vendor/bundle unit provenance, M06 authoritative persisted line/pricing snapshots and split tenders, M08 exact Party/Cash/Bank settlement, M02 source ID import, M09 UI/print. No separate duplicate correction engine or production transaction writer is created.
