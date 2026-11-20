# M05 Independent Receipt Snapshot Alias QA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, writing the failing test before production code.

**Goal:** Prevent a read-only M05 historical multi-unit purchase audit from accepting a "separate receipt" that is a mutable alias (direct or nested) of the very preflight evidence it purports to verify.

**Architecture:** Preserve the existing `auditHistoricalUnitLotHandoff` interface, source math, supplier/lot checks and fail-closed return. Add a small identity-reference overlap check between each advanced unit's immutable receipt and corresponding preflight unit snapshot, before value comparison. Reject callable/symbol-valued trusted evidence before any String conversion can execute user methods. No schema, API, currency rounding or posting code.

**Tech Stack:** Node.js ESM, built-in node:test, GitHub Actions; no new dependencies.

**Spec:** M05/M06/M07 issue #314; M01–M11 coordination #456; `docs/M03_PARALLEL_READINESS.md`; merged #739 `auditHistoricalUnitLotHandoff`; original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; supplementary unit contract `sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c`.

## Twelve-sentence overview

1. The recently merged #739 cross-checks historical mixed-unit snapshots, purchase items and original stock lots.
2. Its central assumption is that a purchase-time receipt and preflight snapshot represent separate evidence.
3. That assumption is currently untested for JavaScript object identity.
4. A caller can give both fields the same object or share nested component arrays.
5. If that happens, a later mutation of one snapshot mutates both without making their value comparison fail.
6. This task introduces a fail-closed alias detection safeguard at the internal evidence boundary.
7. The safeguard recognizes shared nested objects/arrays without inspecting or recomputing business quantities.
8. Deeply independent identical snapshots will still be accepted.
9. Source supplier, product, purchase date, original Lot ID, quantity and cost semantics are unchanged.
10. A malicious callable in trusted evidence will be rejected before implicit string conversion executes it.
11. The scope is restricted to an M05-owned module, a new regression test and this plan.
12. The result remains review-only and cannot authorize a purchase, stock movement, cash or ledger write.

## Global constraints

- Start from `main@a4995ed69616ab1d3e05a675bc19d39414f94878` on dedicated branch `m05/independent-receipt-alias-qa-20261120`.
- Modify only `src/modules/m05-historical-unit-lot-handoff.js`; create only `tests/m05-historical-receipt-alias-qa.test.mjs` and this plan.
- No changes to M02, M03-owned DB and migrations, M04 auth, M08 money, M01 UI, M11 workflows, original source, private data, staging/prod D1 or public RPC.
- Preserve original FIFO, OVERSOLD, multi-supplier lots, immutable unit-price snapshot, legacy no-breakdown purchase and exact source rate; no invented rounding tolerances.
- This does **not** authenticate a deliberately fabricated *cloned* receipt; it only prevents an accidental in-process alias from masquerading as independent data. M02/M03/M10 still must prove archival provenance and authenticated D1 custody.

## Review focus: adverse inputs to cover

1. `receipt.unit === line.unit` (full alias) must block readiness.
2. `receipt.unit = {...line.unit}` (nested arrays shared) must block readiness.
3. Freshly cloned arrays but one shared nested component object must block readiness.
4. A changed historical conversion factor and matching supplier/lot rewrite using aliased receipt must not be accepted.
5. A callable `purchaseHeader['Is Deleted'].toString` must throw at validation without executing callbacks, while normal deep clones, source lots and legacy purchase data continue to pass.

## Task 1 — RED

**Files:** create `tests/m05-historical-receipt-alias-qa.test.mjs`.

**Interface:** import `prepareMultiUnitPurchasePreflight`, `auditHistoricalUnitLotHandoff`. Construct synthetic supplier-specific purchase with 145 base Pcs, historical `730/145` base cost, two unit conversions and a separate receipt.

- [ ] Commit tests only and open one draft PR.
- [ ] Run full GitHub-hosted Foundation tests on exact RED head; observe expected assertion failure **not** a missing import, syntax error or unrelated source issue.

## Task 2 — GREEN

**Files:** update `src/modules/m05-historical-unit-lot-handoff.js`.

- [ ] Reject function and symbol fields recursively in `trustedTree` before any coercion.
- [ ] Walk the already-validated plain unit snapshot nested records and detect any shared object identity by reference.
- [ ] When `receipt.unit` and `line.unit` share an object, add `UNIT_RECEIPT_ALIASED` as a human-review issue and keep `postingAllowed:false`; otherwise retain existing exact `UNIT_RECEIPT_MISMATCH` behavior.
- [ ] Run full GitHub Foundation Node suite and all required source, Playwright, local Workerd/D1 and Cloudflare preview safety checks at exact head.

## Task 3 — QA/review handoff

- [ ] Confirm only three authorized paths differ from `main`, no public Worker call path, no new data producer or financial write.
- [ ] Review test coverage, original-source limitations, failure results and branch safety.
- [ ] Record full verified RED/GREEN/CI evidence on the PR and coordination #456; request independent reviewer /super qa → /super review.
- [ ] **Do not merge without explicit owner approval.** Keep PR draft even when green.
