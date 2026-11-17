# M07-B17 — Original Mixed-Unit Purchase Delete Lineage & Reversal Handoff

> **Execution method:** Superpowers RED → GREEN → refactor if needed → full exact-head CI. No production financial writes.

**Starting main:** `e8f0107c0457f518edb73011660de9a271e24718`, verified M07-B16 PR #520 merged to main. **Issue:** #314. **Coordination:** #456. **Exclusive file owner:** M07; shared integration owner M03.

## Implementation overview (12 sentences)

1. Native `DeleteEngine.gs::deletePurchase` blocks deleting a purchase while active Purchase Returns exist, source-owned lot stock has been consumed, or product stock cannot support reversal.
2. M05 already provides a reusable read-only `planPurchaseInventoryDelete` that mirrors the native stock BLOCK phase.
3. M07-B17 will reuse this existing M05 guard, rather than implement a second deletion or stock-posting engine.
4. It will additionally inspect the persisted historical mixed-unit purchase line and original supplier-owned lot provenance.
5. Historical Bag/Box/Pcs factors and independent prices must reconcile through the merged M05 unit-snapshot audit without consulting current catalog settings.
6. Every original purchase lot must be uniquely identified, match the purchased product and supplier, and account for the full original base quantity.
7. A mixed-unit purchase with no proven original owned lots is not eligible for an inferred legacy fallback.
8. Any consumed lot, active return, deleted purchase, changed source marker, missing product, or insufficient stock blocks the whole proposal.
9. The output will project only historical source lot IDs, physical row references and the expected base-stock reduction.
10. Correction ID and source hash in the proposal are immutable handoff references, not authorization or proof that a database operation has already posted.
11. M03 must still verify the trusted source and version, actor/session rights, SQL guards, and exactly-once financial reversal inside one atomic D1 transaction before acting.
12. The isolated M07 module will never write SQL, call RPC, move Cash/Bank/Supplier balances, mark rows deleted, create an operational journal or touch the original UI.

## Scope and ownership

Create only:
- `docs/superpowers/plans/2026-11-17-m07-b17-purchase-delete-lineage.md`
- `tests/m07-historical-purchase-delete-lineage.test.mjs` (RED first)
- `src/modules/m07-historical-purchase-delete-lineage.js` (GREEN after observed RED)

No `src/db/**`, `migrations/**`, `src/rpc/**`, shared posting or reversal kernel, `src/index.js`, `wrangler*`, original legacy source, M05/M06/M08, authentication, UI or remote D1 edits. This is one reviewable, **source-only/read-only** objective. Adjacent open M03/M09 PRs own different paths.

**Frozen primary authority:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `DeleteEngine.gs::deletePurchase`, `PurchaseManagement.gs` and `StockLots.gs`. **Optional approved unit authority:** `sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c`. **Merged upstream:** M05 `purchase-correction-guards.js`, M05 `m05-purchase-unit-snapshot-conservation.js`, M07-B15/B16.

## Exact B17 contract (synthetic trusted historical source shape)

`planHistoricalMixedUnitPurchaseDeleteLineage(source,intent)` takes a **previously trusted** source containing exactly `{tenantId,purchaseId,supplierId,sourceHash,originalLineTotalPaisa,purchase,line,lots,product,returns}`. The `line` is the original persisted M05 purchase preflight line (not the current catalog) with historical `unitSnapshot` and `pricingSnapshot`. `purchase`/`product`/`lots`/`returns` are original source-shaped records. The caller supplies exactly `{tenantId,purchaseId,correctionId,expectedSourceHash,reason}`, never client-selected quantities, factors, lot IDs, refund amounts, cash rights or auth claims. A marker match does **not** prove authenticity: M03 will compare independent persisted source hashes inside its SQL authorization boundary.

Verify all plain objects have no getters, source and request IDs agree, historical unit and price data conserve, original price-in-paisa matches, owned lot sums equal original base quantity, each owned lot is unsold, active Purchase Returns are absent, product has available stock and M05's native deletion BLOCK phase agrees. For mixed units, missing owned source lots is `DECLINED` rather than the legacy fallback; all other incoherent provenance is `NEEDS_REVIEW`. Return frozen `PLAN_ONLY` evidence only: identifiers, source hash, historical physical quantity/units, original owned lot refs and expected stock after reversal. Never infer Supplier Due/Cash/Bank adjustments or mark a reversal as committed/replayed. `commitAuthorized:false`, `financialCalculationAuthorized:false`, `replayResolved:false` always hold.

## Test-first acceptance / CI

1. Commit test-only RED with import of absent B17 module. Observe actual GitHub Foundation error, distinguish missing-module RED from a business failure.
2. Test 1 Bag+2 Box+5 Pcs = 145 Pcs, preserved original 730 BDT, two original unsold purchase lots, unrelated older lot excluded, original product stock reduction, frozen pure result.
3. Test original return dependence (including soft-deleted exception), earlier stock consumption, insufficient product stock, no-lot fallbacks, supplier/provenance collision, duplicate physical indices/lots, source marker drift, malformed/fraudulent intents and getter safety.
4. Implement minimal GREEN composer using existing M05 guard/audit, not a new writer or price calculation.
5. Require focused and full Node, six-shard local Workerd/D1, Chromium, auth/security, preview/source exact-head GitHub CI and review before merge.
6. Rollback only the three B17-owned files; no migrations, data or remote writes.

## M03 integration handoff — explicitly blocked

M03's future authoritative kernel must bind correction `(tenantId,purchaseId,correctionId)` to trusted original purchase SHA/hash and original lot provenance, reject stale version/actor/cash-session, verify all source lines (not merely B17's single historical product), lock/guard stock and original lot versions, prevent another deletion of the same purchase under a different correction ID, create one immutable audited reversal operation, and post signed Supplier/Cash/Bank/Party/stock effects atomically with all-or-none failure semantics. Identical replay must return the already committed result **only through its SQL idempotency proof**; this read-only M07 preview never decides replay. Cash Session application follows source policy and M04/M08 authorization, and financial balances remain separated by Party role. A passing B17 preflight alone is **not** a production-ready native Purchase Delete.
