# M05 — Purchase transaction atomicity proof (2026-11-15)

## Scope

Use Superpowers RED → GREEN → retest in a fresh GitHub branch. This PR supplies a deliberately **nondeployable local D1 test harness**, not a production purchase writer. The source oracle is pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/Purchase.gs::createPurchase` (blob `4fe2ec112384153a0c88a625c7f22cd11df2a758`) and `StockLots.gs`. Review `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, ADR-007.

M05 owns only test-only fixture files, Wrangler local fake binding and integration test. M03 retains exclusive production schema and atomic posting ownership. M04 staff session authorization is not simulated as a production security proof. No public RPC, `src/db/**`, real `migrations/**`, UI, secret, live spreadsheet, Cloudflare preview D1, staging or production write.

## Original source behavior pinned

- Create one supplier-specific lot for the purchased item; copy the **purchase date**, not the write timestamp, onto the lot (for FIFO).
- Increase physical stock and record purchase item + movement; do not permanently bind Product to Supplier.
- Amounts: grand = max(0, price × qty - discount), paid ≤ grand, supplier due = grand - paid; source supplier ledger treats purchase due as **Debit**.
- Cash/Bank purchase payment is a debit from the respective book, not an incoming sale.
- Preserve selected source Supplier ID linked to reviewed Party identity, with independent payable account; no auto-offset against Customer AR.
- Cash Session policy is unresolved in source (entrypoint calls requireActiveCashSession_ even on bank payment). Fixture **requires Open session for every case** conservatively; do not claim real source parity for bank closed sessions.
- No UI/date permission, multiple items, partial returns, OVERSOLD debt settlement, purchase edit/delete or signed ledgers are in this narrowly bounded proof.

## Test-first implementation plan

1. Commit this plan and test-only RED spec with its aggregation hook. Required RED: M05 fixture/contract modules intentionally absent; GitHub M03 Workerd integration must fail specifically at missing test modules.
2. GREEN: test-only schema/trigger and contract using actual `wrangler createTestHarness` and D1, synthetic IDs/actor, one standard-product row. Validate exact integer paisa, amount reconciliation, explicit operation ID and canonical content hash.
3. Demonstrate actual Workerd/D1: atomic stock/lot/movement/paid cash/bank/supplier due posting; supplier legacy-link enforcement; stale stock version/disabled supplier/bank/session; replay and conflict; concurrency last-version race; late constraint failure rollback; uncertain-commit reconciliation. Transactional CHECK and `changes()` inside trigger, not stale JS preflight.
4. Run all affected integration tests and full CI; PR must identify RED/GREEN commits and exact CI run. **Do not merge** until all checks and isolated preview safety gates are reviewed.

## Deployment and rollback

All new tables are prefixed `m05_` in **fixture code only**. A nondeployable Worker always returns HTTP 404. No production D1 migration or RPC activation. Backout by reverting tests/docs/config; there is no production data change.

## Still blocked

Versioned M02 source schema/Party account reconciliation, reviewed production M03 SQL posting authority+identity, M04 verified D1 session RBAC, source FIFO/OVERSOLD/multi-supplier and full purchase payment policy, integer amount parity and rounding, operation receipts, all imports and reconciliation, and M10/M11 cutover. `PARALLEL-MODULE-READY=false`.
