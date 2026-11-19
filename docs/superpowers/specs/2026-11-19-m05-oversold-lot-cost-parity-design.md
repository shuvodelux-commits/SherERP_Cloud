# Oversold Lot Settlement and Cost Parity — Design Specification

**Status:** Proposed for owner review; planning only. No transaction writes, live correction, merge, or deployment authorized by this document.

**Date:** 2026-11-19 (Asia/Dhaka)
**Primary integration:** SherERP_Cloud (M03/M05/M06/M07, M01 UI and M10 QA)
**Source-of-truth behavior:** Mohim_ERP main source and frozen SherERP_Cloud legacy/source snapshot; review the source pin before porting.
**Related workstream rules:** AGENTS.md, docs/PARALLEL_EXECUTION.md, docs/M03_PARALLEL_READINESS.md, docs/WORKSTREAMS.md.
**Related plan:** docs/superpowers/plans/2026-11-19-m05-oversold-lot-cost-parity.md

## Intent

Correct three coupled business defects: (1) a Product/POS purchase-cost label displays the product master default rather than the active FIFO lot cost, (2) positive net owned stock can have a negative inventory valuation because unresolved oversold rows are summed with replenishment lots, and (3) a purchase adds a new positive lot but does not settle earlier negative OVERSOLD obligations.

The photographed source-system case reports 9 Foot and -168 BDT stock value, product/POS cost 68 BDT, latest purchase lot 240 Foot at 64.75 BDT, and a visible OVERSOLD lot of -229 Foot at 68 BDT. The two visible lots net to 11 Foot and -32 BDT; an additional -2 Foot/-136 BDT is an inference that MUST be verified against every product lot and movement before any repair. Conditional target if all outstanding debt is 231 Foot: 9 Foot at 64.75 BDT = +582.75 BDT; 231 * (68 - 64.75) = +750.75 BDT favorable cost difference. Never treat conditional numbers as an instruction to mutate a real record.

## Goals

1. Preserve lot-level cost, supplier provenance, purchase quantity, FIFO order, multi-unit canonical quantities, tiles dimensions/coverage and full sale/return traceability.
2. Replenishment settles oldest outstanding **eligible** negative OVERSOLD lot portions first; no new stock movement quantity is invented by settlement itself.
3. Available-owned inventory and sellable FIFO quantity are constrained by net stock, never gross positive lots while debts remain.
4. Inventory valuation comes from the reconciled unsold lot quantity and actual lot costs; uncovered or contradictory data is flagged Needs Review rather than clamped to zero.
5. A cost-privileged Products view displays an explicitly labeled **Next FIFO lot cost**; POS displays **estimated FIFO cost for the cart quantity**, showing a breakdown if several lots contribute. Both use the same authorized server-side lot-planning/valuation contract.
6. Historical sale invoice totals, payment allocation, Party balances, posted sale COGS snapshots, supplier obligations and Cash/Bank records must NOT be silently rewritten.
7. Recognize the difference between provisional oversold cost and actual replenishment cost through an explicit, balanced, reviewable cost-variance accounting policy. Keep it nonposting until M03/M08 integration policy is approved.
8. Preserve exact-once reversal and audit evidence through returns, purchase edits/deletes, and duplicated/replayed requests.

## Non-goals and safety boundaries

- Do not fix the display by applying Math.max(0, stockValue), by overwriting Product master cost with a new supplier price, or by pretending an OVERSOLD lot never existed.
- Do not reassign historical SALE_ITEM_LOTS to newly purchased lot IDs automatically.
- Do not change historical invoice revenue, cash session, supplier/customer ledgers, invoice profit or journal entries without a separately reviewed accounting correction.
- Do not merge product, supplier or Party identities by name or phone.
- Do not modify or deploy the live Mohim_ERP Apps Script project from SherERP_Cloud. If source production requires immediate mitigation, its own preview branch/tests and existing preview Script ID gate are mandatory.
- Do not expose cost data to an unauthorized user or public Worker preview. No production D1 migration/backfill without backup, dry-run, independent QA and explicit cutover authorization.
- Current SherERP_Cloud M03 shared SQL/posting and M04 auth gates are independent blockers. A pure module test or a green PR does not unblock deployment.

## Alternatives considered

**A. UI-only patch / clamp negatives:** fastest appearance change, rejected because stock lot debts, FIFO consumption and accounting remain wrong.

**B. Rewrite historical sale COGS and replace negative lots with replenishment lots:** mechanically easy to make current numbers agree, rejected as a default because it mutates posted sale economics and can break returns, audit and historical reports.

**C. Auditable settlement links + authoritative net-stock FIFO + explicit variance:** recommended. Preserves historical evidence, prevents double stock consumption, supports deterministic reversals and can be tested as a pure planner before DB mutations. This is the proposed technical decision, not yet owner-approved.

## Required domain model

Use a pure deterministic planner with trusted snapshots and canonical base quantities. For each product, allocate newly acquired eligible positive quantity to existing eligible negative OVERSOLD obligations, ordered by event-effective date then stable Lot ID; do not infer cross-product or cross-tenant links. Keep original negative lot rows, original purchase records and original sale allocations as immutable provenance; update only outstanding remaining fields under a guarded posting transaction. Once an oversold lot is fully settled, outstanding remaining goes to zero and its status may become Settled; a purchased lot still records the original bought quantity and retains only the unallocated remainder available for new sales.

A settlement record must carry: immutable settlement ID, tenant ID, idempotent operation ID, product ID, oversold lot ID, replenishment purchase lot ID, purchase transaction ID, settled canonical quantity, provisional oversold unit cost, actual replenishment unit cost, signed variance minor units, effective/recorded timestamps, authenticated actor, reversal relation and reason/provenance. Enforce a unique operation/allocation key, positive quantity, nonnegative costs and source-identity constraints.

M03 owns any D1 schema and SQL transaction kernel; M05 owns pure planning and inventory contracts; M06 consumes cost display/profit projections; M07 owns return/reversal contract and M08 approves variance posting policy; M01 owns UI patch consistency. This must not create competing posting kernels.

## Accounting policy to approve before live writes

At purchase time, a previously negative inventory valuation is cleared by settlement and the positive remainder is the real inventory asset. For an oversold quantity Q at provisional cost C_old replenished at C_new, favorable cost difference is Q * (C_old - C_new). This is an **inventory/COGS variance** requiring a posted journal policy agreed with M08 and tested with financial reports; it must not silently rewrite original paid invoices or create another purchase/sale cash event. A source system with no approved journal mechanism must report the variance for review, not silently fabricate a ledger balance.

Money uses an exact minor-unit policy; quantities respect source base-unit precision and product-specific conversions. For fractional Foot or Tiles Sqft, never use binary floats as authoritative stored financial amounts; retain canonical quantity and provenance to recompute audit totals exactly.

## Correctness invariants

- Sum of included lot remaining quantities equals Product Current Stock after every completed operation; any mismatched or orphan/deleted evidence fails closed.
- Settlement by itself has zero net quantity effect: oversold outstanding increases toward 0 by Q, replenishment available decreases by Q.
- A settled negative lot cannot be settled twice; no settlement exceeds the original outstanding shortage or purchase-lot eligibility.
- Future own-stock consumption <= max(0, net available stock), even if gross positive lots are greater.
- 240 acquired, 231 previously oversold => 9 available, not 240 or 11; when the additional 2-foot shortage is not present in the trusted snapshot, do not force the 231 target.
- Replayed purchase/repair/return operation returns the original result without duplicate lot links or variance.
- Return/reversal of a settled sale or its funding purchase must reverse or reallocate the linked settlement exactly once or fail Needs Review; never leave an untraceable positive lot.
- Backdated, duplicate, orphan, missing consumption evidence, negative adjustments and ambiguous multi-lot links are flagged for manual review instead of guessed.

## Products and POS UX contract

Products: change the existing Purchase column to an accurately named active FIFO cost column for eligible cost viewers (or expose a separately named cost column while retaining the reference master cost in a detail tooltip). Show lot ID, remaining eligible quantity and unit; for multiple eligible lots, the first lot cost is a reference, not a promise that an entire future sale uses it. On no eligible lot, show Unavailable/Needs Review rather than an unexplained stale master price.

POS: next to a line, show estimated cost for the *entered quantity*, aggregated from the exact FIFO allocation (including multiple lots); display "Estimate" and a breakdown accessible via existing compact UI. Keep selling-price behavior distinct from purchase cost, preserve existing permission double-gate, keyboard navigation, multi-unit and Tiles conversion/rounding, and small-screen behavior. Do not embed restricted costs in client payloads that a staff member lacks permission to read.

## Execution and review gates

1. Reproduce and audit with read-only snapshots, including full lots, purchase line, sale consumption, stock movements and historic corrections.
2. Approve settlement/cost-variance/return rules after source parity and accounting design review.
3. Implement pure deterministic M05 planner with RED -> GREEN -> refactor tests and no writes.
4. Only after approved M02/M03/M04 gates: M03-owned atomic D1 writer, strict tenant/auth/idempotency guard and real Workerd/D1 concurrency/failure tests.
5. M07 reversals and M06 cost projections, M01 UI QA and M09 report reconciliation.
6. Separate migration/backfill dry-run: produce before/after diff, unresolved Needs Review queue, rollback/reversal plan and backup verification; human approval before live apply.
7. Run all required checks, independent Super QA -> Super Review and owner-approved merge/cutover; production deployment is outside this design approval.

## Evidence and limitations

Source files inspected: Mohim_ERP Products.gs (valuation), StockLots.gs (FIFO/OVERSOLD), Purchase.gs (purchase lot creation), Sales.gs (POS cost payload/profit), products.html (cost display); SherERP_Cloud src/modules/stock-fifo-planning.js, src/modules/m05-source-lot-reconciliation.js, src/modules/pos-profit-standard.js and workstream rules. No live database read was performed and the extra -2 Foot remains an inference.
