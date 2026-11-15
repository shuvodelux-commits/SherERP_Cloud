# M05 — Remove one unsold SKU from existing purchase (local D1 only)

**Date:** 2026-11-15. **Baseline:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/PurchaseManagement.gs::updatePurchaseInternal_`. Original source computes newQty=0 for removed purchase lines; delta=-original qty and requires the **original purchase lot's remaining unsold quantity** to cover that reduction, plus general product stock >= reduction. Original `PURCHASE_ITEMS` are physically rewritten and the lot is reduced to zero, but this local fixture intentionally retains immutable source header/items/lots and exposes effective views, since `m05ml_lots.qty` has a CHECK(qty>0).

**Requirements:** `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, `docs/M03_PARALLEL_READINESS.md`, ADR-007; M05 PRs #108, #118, #128, #150, #167 now merged. **Scope strictly local Workerd/D1 synthetic proof**; shared SQL and M07 actual correction posting remain separate.

## Precise supported edit

One original Standard SKU removed from a *two-SKU* posted purchase, retaining at least one line. Fixed Supplier, Date, Discount, original paid amount, Cash/Bank tender and other line values; only allowed if recomputed grand amount still covers the unchanged paid amount. Decrease Supplier's **gross payable** by the removed original line's exact integer-paisa cost, and decrease matching product current stock by original qty with version CAS; record movement and actor/reason audit atomically. The affected lot must have `remaining_qty===qty` before removal (no sold units). Preserve immutable original receipt/line/lot, but effective read views omit the removed line, mark its original lot quantity/remaining as 0, and show corrected Supplier obligation. No Customer AR netting, Cash/Bank entries unchanged.

Refuse any active purchase return, allocated settlement, later same-supplier ledger, prior synthetic edit/add/delete or duplicate different removal operation, inactive or unreviewed Supplier link, closed Cash Session, missing/deleted/nonstandard product, missing/ambiguous original lot, insufficient lot or product stock, stale product version, invalid SKU, and overpaid result. Refuse a second correction/delete/add after removing a line until M03/M07 own full historical reconciliation. Same operation/actor/intent replays idempotently; altered identity/payload returns CONFLICT, distinct operation ID refuses. Unknown D1 acknowledgment returns NEEDS_REVIEW. Guard inside **one SQLite INSERT with BEFORE/AFTER triggers**, not just JS preflight; forced late audit failure must rollback stock/payable/movement/receipt.

## Superpowers executable TDD sequence

1. Commit plan now.
2. Write 9-10 additive real Workerd/D1 tests in existing `tests/integration/m05-purchase-multiline-workerd.spec.mjs`, importing absent `tests/fixtures/m05-purchase-remove-line-d1-schema.mjs` and `tests/fixtures/m05-purchase-remove-line-d1-contract.mjs`. Observe GitHub Actions **RED ERR_MODULE_NOT_FOUND**, capture actual run.
3. GREEN: minimal synthetic D1 DDL and trigger (test-only), strict envelope and canonical intent hash caller with operationId claim/readback, no production module/migration. Cover successful unsold removal, original immutable history and effective views, Cash/Bank and Customer AR preservation, sold-lot and insufficient-stock refusal, stale version, return/settlement/later-ledger and session/Party gate, exact replay/concurrency and cross-engine locks, overpayment, late forced failure rollback and malformed IDs.
4. Full GitHub CI 8 workflows, local real Workerd D1, owner review. Reconcile fresh `main` when other modules advance; recheck final-head proof. PR stays draft until all checks pass.

## Scope and rollback

Exactly four files: plan, two `tests/fixtures/m05-purchase-remove-line-d1-*.mjs` files, one additive test extension. New `m05ml_remove_*` tables/views **only in isolated local D1**. No production `src/**`, `src/db/**`, `src/rpc/**`, `migrations/**`, `legacy/**`, Worker bindings, UI or staging/production writes. **M03** owns shared transaction schema/posting, **M07** native corrections/reversal, **M04** authentication. No production financial feature enabled; `PARALLEL-MODULE-READY=false`. Rollback: revert four additive paths, no remote D1 restoration.
