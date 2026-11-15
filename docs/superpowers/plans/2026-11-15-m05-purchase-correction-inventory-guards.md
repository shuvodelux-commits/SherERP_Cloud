# M05: Purchase correction inventory eligibility guards (2026-11-15)

**Workstream:** M05 inventory, purchases and sourcing; **source of truth:** pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/PurchaseManagement.gs::updatePurchaseInternal_` and `legacy/source/DeleteEngine.gs::deletePurchase`. Read `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, ADR-007 and M03 readiness contract.

## Objective and boundaries

Introduce **read-only internal inventory eligibility** for correcting an existing purchase, not a new edit/delete engine or write path. Produce exact source blocked-reason strings for consumed lot cost edits, over-reductions, missing lots, negative product stock, already-returned/deleted purchases and historical duplicate item ambiguity. The selected original purchase date and supplier identity remain unchanged. No change to settlement, cash, bank, due balance or source data. Existing native M07 corrections remain sole eventual reversal owner.

**File ownership:** M05 may add a pure module `src/modules/purchase-correction-guards.js` and isolated tests. Do not edit `src/db/**`, `src/rpc/**`, `migrations/**`, Worker auth, UI or source; M03 owns SQL/posting, M04 owns authenticated staff, M07 owns reversal engine.

## Superpowers plan and acceptance

1. **Plan first** (this file), then write Node regression tests using explicitly supplied frozen-source-shaped purchases, purchase items, lots, products, returns and proposed inventory quantities/costs. Assert source **error text** for key safety refusals. New helper import is deliberately absent; commit RED and verify actual GitHub Action `ERR_MODULE_NOT_FOUND` before implementation.
2. **Test local real D1:** Extend the existing **synthetic M05 multi-line Workerd/D1** integration suite with a regression for an already-posted two-product purchase. Map synthetic D1 rows to frozen source shapes. Check successful correction planning, then simulate a consumed lot from a sale, verify edit/delete denial and unchanged balances, and show revalidation required when a stale preflight becomes invalid. Use no actual edit/delete writer.
3. **GREEN:** minimum pure helper exposing `planPurchaseInventoryEdit` and `planPurchaseInventoryDelete`. These are **not** mutation/reversal plans or RPC handlers. The edit function accepts one product-level edited quantity/unit purchase cost for each proposed item and returns only read-only delta observations, and the delete function returns only stock-reversal eligibility observations. Ambiguous duplicate original purchase IDs, multiple lots for the same product and invalid snapshot conditions fail closed rather than guessing.
4. **Revalidate:** full GitHub CI at final head, including actual Workerd/D1 regression and Cloudflare PR no-secret/preview safety. Publish RED/GREEN run links, explicit rollback, ownership, missing gates in the PR. Do not merge without review.

## Contracts

- No returns on original purchase; missing, deleted and duplicate source IDs rejected.
- Historical purchase with same product in multiple item rows cannot be edited (source message). Quantity reduction must be no greater than **this purchase lot's unsold remainder**, and must not make current product stock negative, **even if other suppliers have stock**. Quantity increase must not be blocked when product stock is currently negative (source source permits OVERSOLD).
- Purchase unit cost cannot change if original lot consumed units, or source lot missing. New line price change is unrestricted by that historical-cost constraint.
- Delete refuses if **any** purchase lot was consumed or a product lacks enough current stock for its original purchase quantity; active purchase returns block both edits and deletes. Do not perform delete or recalc money.
- Source first-error ordering retained when feasible. Numeric inputs in source-shaped snapshots are untrusted observations; D1 posting kernel must independently validate integer quantities, amount precision, authority and CAS at commit time.

## Inventory and rollback

- Add this plan.
- Add `src/modules/purchase-correction-guards.js` after RED.
- Add `tests/m05-purchase-correction-guards.test.mjs` before implementation.
- Extend `tests/integration/m05-purchase-multiline-workerd.spec.mjs` with local D1 read-only gate test before implementation.
- No new Wrangler binding, no D1 migration, public route, deployment, production financial posting or cross-role auto-net.
- Rollback: revert this additive plan/helper/tests; no remote schema or data rollback needed. `PARALLEL-MODULE-READY=false` until independent M02–M04/kernel acceptance.
