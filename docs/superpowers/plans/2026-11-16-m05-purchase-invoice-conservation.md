# M05 — Source purchase invoice conservation audit (read-only)

Date: 2026-11-16. Branch: `m05/purchase-invoice-conservation-audit-20261116`.

## Twelve-sentence Superpowers implementation overview

1. The frozen business authority is `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, specifically `Purchase.gs::createPurchase` and `PurchaseManagement.gs::updatePurchaseInternal_`.
2. Both source methods record each `PURCHASE_ITEMS.Line Total = Quantity * Unit Price` and accumulate the purchase `Subtotal` from those products.
3. Both then calculate `Grand Total = max(0, Subtotal - Discount)`, clamp `Paid Amount` to `Grand Total`, and store `Due Amount = Grand Total - Paid Amount`.
4. The corresponding source `Payment Status` is `Paid`, `Partial` or `Due`, based on whether the due and paid amounts are positive.
5. The new isolated M05 function will inspect **stored source-shaped purchase headers and items**, not user-supplied checkout amounts.
6. It must report mismatched line totals, subtotal, grand, paid/due conservation and stored status, including over-discount and fully-unpaid purchases.
7. It must flag malformed numeric values, missing IDs, orphan lines, duplicate purchase IDs and duplicate product lines instead of guessing identity.
8. Source purchase rows marked deleted remain in the audit because physical history and original financial amount evidence are retained after the source soft-delete.
9. The audit will not recalculate later supplier settlements or purchase returns as if they updated the historical original purchase header.
10. It will reject ambiguous/untrusted input snapshots and perform **no** D1 access, authenticated RPC, Sheets writes, Cash/Bank/Supplier mutations or adjustment posting.
11. Tests come first and are proven RED in GitHub Actions, followed by minimal pure implementation and full GitHub GREEN CI evidence.
12. This PR is not an M05 production migration and must remain draft until checks pass and the owner reviews it.

## Contract and acceptance

- New `src/modules/m05-purchase-invoice-conservation.js`: export `auditPurchaseInvoiceConservation({purchases,purchaseItems})` returning `{ready,issues,summary}` for trusted, explicit and source-shaped snapshots.
- New `tests/m05-purchase-invoice-conservation.test.mjs`: source expression pinning and synthetic multi-line fixtures; do not load credentials or real data.
- Use an absolute BDT tolerance of **0.004** for binary-float storage comparisons (below one paisa); expose this tolerance in summary, not as permission to round/repair source data.
- Audit must fail closed for an empty/unreviewed dataset; no inferred migration-ready status.
- Preserve purchase and item inputs exactly; issue codes make discrepancies reviewable.
- Affected original RPCs: none. D1 tables/migrations: none. Source GAS: unchanged byte-for-byte. Account/stock/cash/bank impacts: none.
- This test-only parity guard is **not** a substitute for per-account supplier settlement, refund/return, multi-unit historical pricing, concurrent posting or exact integer-paisa D1 integration tests. Those remain gated by M02/M03/M04/M07 and M10.
- Rollback: revert the three new plan/test/module files; no data movement or financial side effects.

## Execution checklist

- [ ] Baseline original source expressions read and pinned
- [ ] RED: new regression tests fail due to missing module on GitHub CI
- [ ] GREEN: minimal code passes the new and existing suites
- [ ] Exact-head Workerd/D1, browser, preview and source-preservation checks verified
- [ ] Reviewable draft PR, no auto-merge, no deployment authorization
