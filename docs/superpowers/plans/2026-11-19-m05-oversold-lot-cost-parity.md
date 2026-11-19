# Oversold Lot Settlement and Cost Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Reconcile old OVERSOLD lots on purchase, preserve historical accounting, ensure future FIFO consumes only net owned inventory, and display actual lot-based purchase cost in Products and POS.

**Architecture:** Build a deterministic, no-write M05 settlement/valuation planner from exact source-shaped snapshots. Once M03/M04 shared gates are approved, the single M03 integrator wires it to guarded, idempotent D1 transactions, M07 implements linked returns/reversals, and M06/M01 expose permission-gated costs in the existing UI. Historic data is repaired only through an independently approved dry-run/backfill gate.

**Tech Stack:** JavaScript ES modules, Node >=22 and node --test, Cloudflare Workers, Hono, D1 SQLite/Workerd, original HTML/CSS/JavaScript UI, Playwright.

**Spec:** docs/superpowers/specs/2026-11-19-m05-oversold-lot-cost-parity-design.md

**Status:** PLAN ONLY. This document does not approve a schema migration, ERP mutation, PR merge, source Apps Script release or production cutover.

## Global Constraints

- Read current AGENTS.md, docs/PARALLEL_EXECUTION.md, docs/M03_PARALLEL_READINESS.md, docs/WORKSTREAMS.md, and the spec before creating implementation branches. Re-read fresh main and open PR overlap at each execution run.
- GitHub main is integration truth; use isolated branches/worktrees, one file owner per lane and small reviewed PRs. Source Mohim_ERP is frozen/read-only for the Cloudflare port.
- M03 is the ONLY owner of shared src/db, migrations, SQL transaction kernel and authenticated RPC integration; M05 must not independently create a second inventory writer.
- Gate: parallel safe preparation is permitted, shared transaction writes blocked until documented M02/M03/M04 and kernel readiness are explicitly approved. This plan must not be used to bypass those gates.
- Never write historical business data during reproduction or read-only audit. A new D1 schema/test fixture is not permission to run a remote production migration.
- No hidden zero-clamp valuation, auto-net Party accounts, stale client price trust, unauthorized cost payload, or historical invoice rewrite.
- Preserve canonical unit conversions (Box/Pcs/Foot, Tiles dimensions/Sqft), mixed lots, bundles/vendor sourcing, backdated dates, return lineage, dual currencies if supported and stock audit history.
- Each task uses Superpowers RED -> verify expected failure -> minimum GREEN -> full affected tests -> refactor -> re-run tests -> scoped commit and review. No production code before a failing test.
- Cross-module D1 transactions/reversals require real local Workerd/D1 tests including concurrency, replay and failed-in-between operations; a JS mock alone is inadequate.

## Review Focus: five failure conditions

1. A second purchase or sale arrives concurrently during settlement: exactly one valid allocation commits; no duplicate depletion or negative availability.
2. The purchase is backdated earlier than the negative-stock event: fail Needs Review instead of silently rewriting historical FIFO/COGS.
3. Old SALE_ITEM_LOTS links are blank, duplicate or inconsistent: no inferred product/date match and no retroactive cost edit.
4. A supplier purchase return tries to remove goods already allocated to oversold obligations: block or reverse proven links atomically; do not create phantom stock or supplier credit.
5. A staff member lacks posCost view permission: raw RPC responses and HTML/JS state must contain no cost or variance details.

## Dependency map and pull-request series

- **PR-A (M05 only):** reproduction, snapshot audit, read-only discrepancy report. No shared DB or UI changes.
- **PR-B (M05 only):** pure settlement planner, FIFO net-eligibility and read-only valuation/cost projections; no posting.
- **PR-C (M03-owned, after gate):** numbered schema + authenticated, atomic, idempotent settlement writer; M05 supplies planner, M08 signs off accounting treatment.
- **PR-D (M07 + M03 integrator):** exact-once return/edit/delete reversal against settlement links.
- **PR-E (M01/M06 coordination):** Products and POS cost fields via authorized read adapter; no UI redesign.
- **PR-F (M10/M11, separately approved):** historical import/backfill dry-run, independent QA, pilot, rollback/cutover proposal.

No two PRs may modify M03 shared DB/posting paths concurrently. PR-E read-only UI tests can be prepared in parallel after the read-model contract is frozen, but it cannot activate an unauthenticated cost endpoint.

## Task 1: Reproduce exact defect and generate safe preflight evidence (PR-A / M05)

**Files:**
- Create: src/modules/m05-oversold-exposure-audit.js
- Test: tests/m05-oversold-exposure-audit.test.mjs
- Reference only: legacy/source/Products.gs, StockLots.gs, Sales.gs, Purchase.gs; src/modules/m05-source-lot-reconciliation.js

**Interfaces:**
- Consumes: trusted immutable snapshot {products, stockLots, saleItemLots, purchaseItems, stockMovements}; no D1 access.
- Produces: auditOversoldExposure(snapshot) -> {products, issues, summary}, including exact net lot quantity, current product stock, signed valuation, oversold debt, positive unencumbered quantity and source-lot provenance.

- [ ] Step 1: Write RED tests for source-shaped generic product at +240 purchased / -229 oversold and separate -2 oversold, reporting 9 current feet, -168 source lot valuation, and a conditional +582.75 reconciled remainder; assert zero input mutation. Also test a snapshot with only -229 (expected 11, not a fabricated 9).
- [ ] Step 2: Run: node --test tests/m05-oversold-exposure-audit.test.mjs. Expected: FAIL because new audit is absent or its expected diagnoses are missing.
- [ ] Step 3: Implement auditOversoldExposure in the new module, reusing existing stock reconciliation identity validation and rejecting malformed IDs, deleted-positive lots, nonfinite quantities and ambiguous lineage.
- [ ] Step 4: Run focused test; expected PASS. Run npm test and npm run verify:source; record exact command results.
- [ ] Step 5: Commit only this module, tests and the evidence description; create reviewed PR-A. No production data is fetched by this task.

**Acceptance:** report explicitly marks the unseen -2 Foot as unverified until full source rows are inspected; never auto-fills the missing quantity.

## Task 2: Deterministic oversold settlement allocation planner (PR-B / M05)

**Files:**
- Create: src/modules/m05-oversold-settlement-plan.js
- Test: tests/m05-oversold-settlement-plan.test.mjs
- Reference: src/modules/stock-fifo-planning.js and src/modules/m05-fifo-eligibility-gate.js

**Interfaces:**
- Consumes: planOversoldSettlement({tenantId, productId, purchaseLot, oversoldLots, operationId, canonicalUnit, effectiveDate}) with validated trusted snapshots.
- Produces: immutable {allocations:[{oversoldLotId, purchaseLotId, baseQty, provisionalCostMinor, actualCostMinor, varianceMinor}], purchaseRemainingBaseQty, updatedDebtBaseQty, reviewIssues}; planner does NOT post, edit a row or infer a missing historical link.

- [ ] Step 1: Write RED tests: 231 old shortage and 240 incoming leaves 9, full/partial allocations across several debts, chronological tie-break, insufficient replenishment, same-lot repetition, inconsistent product/tenant, fractional Foot, Box-to-Pcs, tile exact coverage, and backdated Needs Review.
- [ ] Step 2: Run: node --test tests/m05-oversold-settlement-plan.test.mjs. Expected: FAIL on missing planner.
- [ ] Step 3: Implement the smallest deterministic pure planner. Quantity conservation is a mandatory assertion; signed provisional-minus-real cost variance is returned but NOT posted.
- [ ] Step 4: Run both focused test and node --test tests/m05-fifo-planning.test.mjs tests/m05-source-lot-reconciliation.test.mjs (adjust exact filenames if current main differs). Run npm test; require no regressions.
- [ ] Step 5: Commit and review PR-B; freeze interface for M03/M06 consumers.

**Acceptance:** previously sold quantity is not subtracted from product Current Stock again during settlement; purchase retains original bought quantity and separately records available residual.

## Task 3: Prevent future sale of stock committed to old oversold debts (PR-B / M05)

**Files:**
- Modify: src/modules/stock-fifo-planning.js
- Modify: src/modules/m05-fifo-eligibility-gate.js
- Test: tests/m05-fifo-planning.test.mjs
- Test: tests/m05-fifo-eligibility-gate.test.mjs

**Interfaces:**
- Consumes: trusted lot list and authoritative Product Current Stock; settlement outstanding from Task 2.
- Produces: a net-stock guarded FIFO selection for owned sale inventory and an explicit new oversold shortfall; preserve vendor/consignment and bundle handling as existing contracts require.

- [ ] Step 1: Write RED test where positive purchase lots total 240 but net stock is 9, and 10 Foot requested must draw at most 9 own-stock and create exactly 1 oversold shortfall (or choose a vendor for the shortfall when explicitly requested). Verify the planner never returns a draw from deleted lot.
- [ ] Step 2: Run the two focused test files; expected FAIL under the current positive-only lot draw.
- [ ] Step 3: Make the minimal source-documented deliberate contract change, and ensure selling-price ladder and sale-profit preview use the same net-eligible quantity. Do not remove the original StockLots source oracle or silently change historical receipts.
- [ ] Step 4: Run all M05 + M06 POS profit tests and npm test; verify any source-parity test change is explicitly justified as a bug fix.
- [ ] Step 5: Commit under PR-B, with read-only assertions proving no write path is introduced.

**Acceptance:** original invoice/receipt total remains unchanged; only future stock allocation eligibility is corrected.

## Task 4: Atomic authenticated D1 settlement writer and variance evidence (PR-C / M03 integration gate)

**Files:**
- Proposed migration: migrations/0015_oversold_lot_settlements.sql (only if 0015 is still unused on fresh main; M03 assigns a nonconflicting next number).
- Create: src/db/oversold-settlement-posting.js
- Test: tests/integration/m05-oversold-settlement-workerd.spec.mjs
- Integrate through: M03-approved source-shaped purchase posting service/RPC after an interface review; never edit src/rpc directly from M05.

**Interfaces:**
- Consumes: validated purchase posting record, Task 2 plan, authenticated actor/tenant from M04 server session, stable operation ID.
- Produces: persistOversoldSettlement({DB, actor, tenantId, operationId, expectedLotVersions, plan}) -> one committed {settlementIds, remainingQty, varianceMinor} or an atomic conflict/Needs Review; replay returns original result.

- [ ] Step 1: Write RED real Workerd/D1 integration test for full/partial settlement, two simultaneous requests, conditional row version/quantity mismatch, retry/replay, injected constraint failure, and tenant isolation. Assert no partially committed stock, lot links, accounting or purchase rows.
- [ ] Step 2: Run the real integration test against a local Workerd/D1 fixture; expected FAIL because schema/service is absent. Record the failure and environment.
- [ ] Step 3: Only after documented readiness and M08 accounting policy sign-off, have the single M03 owner implement the schema, unique idempotency/allocation keys, SQL-level quantity/identity guards (not JS preflight alone), same-transaction lot/debt updates, authoritative purchase and settlement link provenance, and approved balanced cost-variance journal behavior.
- [ ] Step 4: Run focused Workerd/D1 test, existing tests/integration/m05-purchase-posting-workerd.spec.mjs, full npm test and migration checks; verify no public unauthenticated RPC access.
- [ ] Step 5: Review schema/financial SQL independently; open PR-C. Do not migrate remote staging or production until separate authorization.

**Acceptance:** SQL rejects double allocation even when two requests pass identical preflight snapshots; no settlement occurs before authenticated purchase commit.

## Task 5: Returns, purchase edits and linked reversal contract (PR-D / M07 with M03)

**Files:**
- Create: src/modules/m07-settlement-reversal-plan.js
- Test: tests/m07-settlement-reversal-plan.test.mjs
- Test: tests/integration/m07-settlement-reversal-workerd.spec.mjs
- Integrate: M07 native return/correction service, M03 shared posting owner only.

**Interfaces:**
- Consumes: original sale/purchase movement + exact settlement link IDs, active return quantities, actor/operationId.
- Produces: planSettlementReversal(snapshot, correction) -> deterministic link deltas/variance reversal plan or Needs Review; corresponding M03 transaction applies exactly once.

- [ ] Step 1: RED tests for partial sales return on a fully settled oversold sale, purchase return of 1 of 240 while 231 have funded previous sales, purchase delete, repeated partial return, over-return, reversed credit and ambiguous historical sale link.
- [ ] Step 2: Verify expected RED via node --test tests/m07-settlement-reversal-plan.test.mjs and the local D1 integration test.
- [ ] Step 3: Implement pure reversal planner, then integrate as the only M03-owned atomic write with original purchase/sale audit links, correct supplier/customer accounting semantics and no fabricated inventory.
- [ ] Step 4: Run focused tests plus M05/M06/M07 and full suite, real D1 fault injection and permission checks.
- [ ] Step 5: Independent review/PR-D. Gate PR-C live activation on PR-D or explicit fail-closed handling for unsupported linked corrections.

**Acceptance:** historical quantity and money cannot be credited twice.

## Task 6: One authoritative read model for valuation and cost presentation (PR-E, M05/M06)

**Files:**
- Create: src/modules/m05-stock-lot-valuation-read.js
- Create: src/modules/m06-pos-fifo-cost-read.js
- Test: tests/m05-stock-lot-valuation-read.test.mjs
- Test: tests/m06-pos-fifo-cost-read.test.mjs
- Reference: src/modules/m05-product-bootstrap-valuation.js, src/modules/pos-profit-standard.js, src/modules/m05-products-ui-metadata-read.js

**Interfaces:**
- Consumes: exact active lot/settlement snapshots, product, requested canonical sale quantity and separate authorization result.
- Produces: getStockLotValuation(snapshot, productId) -> netQty, stockValueMinor, nextFifoLotCostMinor, lotCostBreakdown, warnings; getAuthorizedPosFifoCost(snapshot, cartLine, permissionContext) -> estimatedCostMinor, costPerUnitDisplay, draws or NO_COST_PERMISSION.

- [ ] Step 1: RED tests for net 9 Foot -> 582.75 BDT stock value after verified 231 settlement; unsolved mismatches must return Needs Review, not a forged positive value; 1 Foot estimated unit cost is 64.75 BDT, 10 Foot crossing shortage reports explicit fallback/unknown cost, and mixed-cost lot demand yields correct weighted unit cost and total.
- [ ] Step 2: Run two focused tests and verify RED.
- [ ] Step 3: Reuse the FIFO planner/settlement provenance for both read projections; preserve product master default price separately, and enforce server-side posCost permission before including purchase costs.
- [ ] Step 4: Run tests/m05-product-bootstrap-valuation.test.mjs plus M06 profit tests and npm test; confirm cost hidden from unauthorized payload.
- [ ] Step 5: Commit model changes with PR-E or a separate read-model PR gated ahead of UI.

**Acceptance:** no frontend calculation reads product master purchase cost as a substitute for a known active lot cost.

## Task 7: Existing Products page cost display (PR-E / M01)

**Files:**
- Reference UI: legacy/source/products.html and existing M01 compiled-only frontend patch pattern.
- Create or extend narrowly: scripts/patch-m01-products-preview.mjs (only if this remains the established patch entrypoint on current main).
- Test: qa/m01-products-cost-parity.spec.mjs

**Interfaces:** consumes Task 6 authorized Products read model only.

- [ ] Step 1: Before any UI code, complete UI-consistency finding-patterns/adjusting checklist for Products table, responsive cost cell, modal and permissions; preserve the existing product filtering, keyboard and compact table conventions.
- [ ] Step 2: RED Playwright test that labels Next FIFO cost 64.75 BDT and does not incorrectly label product master 68 BDT as current lot cost. Include multiple lots, insufficient stock, mobile horizontal scroll and restricted role.
- [ ] Step 3: Implement minimal Products UI patch with accurate label, lot info tooltip and Needs Review warning (no redesign).
- [ ] Step 4: Run node --test qa/m01-products-cost-parity.spec.mjs, npm run build:frontend and npm run test:m01:browser; verify compiled screenshot at desktop and mobile widths.
- [ ] Step 5: Commit scoped UI change/review with PR-E.

## Task 8: Existing POS purchase-cost display and profit consistency (PR-E / M06 + M01)

**Files:**
- Reference UI: legacy/source/posv2.html, src/modules/pos-profit-standard.js, existing compiled POS patch mechanism.
- Create: qa/m01-pos-cost-parity.spec.mjs
- Test: tests/m06-pos-fifo-cost-read.test.mjs (Task 6)

**Interfaces:** consumes Task 6 cost read model; must not bypass cost permission gates.

- [ ] Step 1: UI-consistency checklist for POS cart, stock/profit row, cost permission and responsive layout; keep Enter loop, drafts, multi-payment and Tiles unit conversion unchanged.
- [ ] Step 2: RED browser tests: 1 Foot @ 64.75 BDT cost, selling 70 BDT, profit 5.25 BDT; 9 owned and requested 10; multi-lot weighted cost; unauthorized staff sees no cost in page state/network payload.
- [ ] Step 3: Add minimal cost display integration, labeled Estimated FIFO purchase cost, with breakdown for multiple lot draws; preserve separate selling-price controls.
- [ ] Step 4: Run targeted browser tests, npm run test:m01:browser, npm test and a verified authenticated local preview smoke test once authorized endpoint exists.
- [ ] Step 5: Independent QA and PR-E review; require no visual/keyboard regressions.

## Task 9: Historical correction dry-run and one-time repair proposal (PR-F / M02/M10/M11)

**Files:**
- Create: scripts/dry-run-oversold-settlements.mjs
- Test: tests/m10-oversold-backfill-dry-run.test.mjs
- Create: docs/runbooks/M10_OVERSOLD_SETTLEMENT_REPAIR.md

**Interfaces:**
- Consumes: explicit, authorized, read-only export of historical Products, Stock Lots, Sale Item Lots, Purchase Items, Stock Movement and correction log with stable source IDs.
- Produces: per-product before/after quantity/valuation/variance diff, unresolved review queue, link proposal, exact evidence hash, backup/rollback checklist. Never writes the source or production D1.

- [ ] Step 1: RED test for screenshot-like synthetic case and malformed/missing 2 Foot, incomplete lineage, zero-price lots, prior partial settlement, double-run, source ID mismatch and transaction dates.
- [ ] Step 2: Verify RED on dry-run test.
- [ ] Step 3: Implement no-write report and manual-review gates; no automatic repair of unknown or ambiguous link evidence.
- [ ] Step 4: Run npm test, verify:source and Workerd/D1 reconciliation proof; independent reviewer signs every proposed historical delta and variance. Verify backup and restore rehearsal in isolated environment.
- [ ] Step 5: Create review PR-F; separate owner authorization is mandatory before any real source/D1 mutation. Only the M03 posting owner may implement a separately approved apply command.

**Acceptance:** re-running an approved repair cannot duplicate a historical settlement or profit variance.

## Task 10: Release verification, operations and source-ERP mitigation boundary

**Files:**
- Update (after tests): docs/runbooks/M10_OVERSOLD_SETTLEMENT_REPAIR.md
- Create: docs/reviews/m05-oversold-lot-settlement-final-review.md
- Reuse: docs/runbooks/M11_PRODUCTION_CUTOVER.md, docs/M03_PARALLEL_READINESS.md

- [ ] Run npm run verify:source, npm test, npm run build:frontend, npm run test:m01:browser and all affected real Workerd/D1 integration tests on the exact PR HEAD. Record commands, pass counts and failures.
- [ ] Run Super QA (independent) -> Super Review (independent), account for all comments, then owner-controlled merge sequence PR-A -> PR-B -> PR-C -> PR-D -> PR-E -> PR-F (PR-E read-model work may prepare earlier, not activate before backend).
- [ ] Pilot with sanitized data: 229 oversold + 240 purchase => 11 stock if no other debt; 229 + 2 oversold + 240 => 9 stock, 582.75 BDT valued remainder. Verify no customer/supplier/cash/bank drift and variance accounting sign in M08.
- [ ] Verify stored/derived stock quantity equality, settlement count, valuation, invoice profit and all returns. Record old/new screenshot and SQL evidence without publishing private customer/supplier data.
- [ ] If the photographed ERP is the original live Mohim_ERP Apps Script, create a **separate** source-repo preview plan/PR and execute the original preview Script ID guard before any staging test; do not treat a SherERP_Cloud PR as a fix already deployed to that live screen.
- [ ] Obtain explicit sign-off for every production data correction and for the Cloudflare cutover. No automation may merge/deploy a draft plan PR as an approved transactional release.

## Mandatory handoff

Start with Task 1 and present the audit results and exact existing-open-PR collision check. Stop before schema writer/backfill if M03/M04 shared readiness is still blocked. Do not claim that these tasks, migrations, tests or deployments have already been performed.

**Recommended execution mode:** Superpowers subagent-driven development with dedicated M05 planner reviewer, single M03 transaction owner, M07 return reviewer, M06/M01 UI reviewer and M08 independent financial review; execution must be serialized at the shared D1/posting boundary.
