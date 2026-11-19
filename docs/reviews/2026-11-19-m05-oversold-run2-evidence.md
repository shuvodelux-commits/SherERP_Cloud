# M05 Run 2 — Oversold Settlement Pure Planner

**Date:** 2026-11-19 (Asia/Dhaka)
**Status:** Code + focused TDD tests on an isolated branch; **NO DB/Sheets writes** and no release.
**Plan:** \`docs/superpowers/plans/2026-11-19-m05-oversold-lot-cost-parity.md\`, Task 2.
**Source contracts:** \`src/modules/stock-fifo-planning.js\`, \`src/modules/m05-fifo-eligibility-gate.js\`; both intentionally unchanged.

## Decision and interface

\`planOversoldSettlement({tenantId,productId,operationId,effectiveDate,canonicalUnit,purchaseLot,oversoldLots})\` is an internal synchronous pure planner. It consumes explicit trusted tenant-scoped snapshots; it does not fetch source data, authenticate the caller, lock stock, run SQL, or mutate rows.

The returned frozen proposal has:
- \`allocations\`: one per used negative lot, with exact lot/purchase/tenant/operation IDs, canonical \`baseQty\`, **allocation totals** in integer paisa for \`provisionalCostMinor\`, \`actualCostMinor\`, and signed \`varianceMinor\`;
- \`purchaseOriginalBaseQty\`, \`purchaseRemainingBaseQty\`, \`totalSettledBaseQty\`, \`updatedDebtBaseQty\` to support future transaction guards;
- \`reviewIssues\`; any source anomaly blocks all allocations and returns \`purchaseRemainingBaseQty:null\`.

\`canonicalUnit\` requires an explicitly supplied base unit, decimal precision (0–6), and per-unit quantity-to-base factors. Source legacy lots that omit \`Quantity Unit\` are interpreted as already measured in that explicitly configured base unit. Each source lot's \`Purchase Price\` is interpreted as price **per that lot's Quantity Unit**. Porting a source dataset to this contract requires a separate verified adapter; never guess its ratio from a product name.

Lot sequence: ascending purchase/effective date, then stable Lot ID. The proposal refuses if a purchase is dated before an outstanding oversold event. Same-day sequencing must be validated from source movement evidence by the posting owner before any live apply; this read-only module does not infer timestamps that are not supplied.

Money: decimal strings or finite numbers with <=2 digits of money precision convert to BigInt minor units. Quantities and explicit conversion factors are rational BigInts. Actual purchase cost is allocated by **cumulative rounding**, so splitting one Box receipt into two debt allocations does not misallocate a paisa. Negative cost variances retain their sign. Neither a candidate variance nor a conditional valuation is posted.

**Conservation:** For approved inputs, \`purchaseOriginalBaseQty\` is unchanged and \`purchaseRemainingBaseQty = purchaseLot remaining base quantity - totalSettledBaseQty\`. Each affected oversold outstanding quantity increases toward zero by exactly its allocated base amount. The arithmetic never creates a Stock Movement and never deducts Product Current Stock again.

## Source-screen illustrative fixture (NOT verified live data)

| Candidate input | Result |
| --- | ---: |
| Purchased | 240 Foot at BDT 64.75 per Foot |
| Old negative lots | 229 Foot + inferred 2 Foot, both at BDT 68 per Foot |
| Planned settled shortage | 231 Foot |
| Proposed remaining available | 9 Foot |
| Hypothetical remainder value | BDT 582.75 |
| Provisional-versus-actual allocation cost variance | +BDT 750.75 |

The other 2 Foot are a **mathematical inference** from screenshots, not a verified historical row. Running this pure planner on the two visible lots only must leave 11 Foot. Historical data must not be repaired using an inferred lot.

## TDD and local checks

- RED: \`node --test tests/m05-oversold-settlement-plan.test.mjs\` failed with ERR_MODULE_NOT_FOUND for the absent new planner.
- GREEN: after implementing the planner, **20/20 tests pass** under Node 22.16.0 in an isolated scratch copy of these two files.
- Mutation check: incorrectly increasing instead of decreasing available quantity failed 7 tests; restore yielded 20/20 pass.
- Verified uploaded GitHub file content by matching local \`git hash-object\` to the two returned blob IDs:
  - planner: \`5edad9a2e7db9b62b13d9b327ab99d0db80e2e81\`
  - tests: \`e51875046bdc56c1b09230fa1ae46c833e19aa81\`
  Both exact GitHub files were then exercised locally and passed 20/20.
- Full \`npm test\` / source parity / browser and exact PR-head GitHub CI results **must be checked independently on the PR**; the isolated focused test is not a claim about the whole repository.

### Test coverage

- 231 debt + 240 new -> 9 remain; 229-only versus 231 scenario.
- Partial replenish, zero debt, stable FIFO order, duplicate IDs and same-ID collision.
- Cross-product and cross-tenant refusal, incorrect source/status, backdated purchase.
- Strict calendar dates and original-vs-remaining quantity.
- Fractional Foot at 0.001 resolution and paisa rounding.
- Explicit Box = 20 Pcs conversion and mixed purchase/debt cost bases.
- Tile 24×24 coverage (4 Sqft per Pcs): 356 Sqft = 89 Pcs; reject 355 Sqft as an implicit fractional piece.
- Exact cumulative cost rounding when a Box price spans several allocations; signed adverse cost variance.
- No input mutation, deterministic replay proposal and frozen result; reject accessor-bearing snapshot rows.

## Release blockers and owner boundaries

This task adds only \`src/modules/m05-oversold-settlement-plan.js\`, \`tests/m05-oversold-settlement-plan.test.mjs\`, and this evidence file. It does **not** change POS, Product stock display, FIFO planner, D1 schema, transaction posting, existing lots, invoices or journals.

Before implementing the later **posting** task, M03 owns the single atomic SQL transaction and source provenance verification, M04 owns tenant/actor rights, M07 owns return reversals, and M08 must approve variance account/rounding policy. Run 3 (net-stock FIFO eligibility) is a separate reviewed scope. Never treat a successful pure planner test as production reconciliation.
