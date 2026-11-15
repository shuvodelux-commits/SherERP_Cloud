# M07-A4 Store Credit Batch — test-first execution plan

> Required method: Superpowers TDD (RED → GREEN → verify), KISS, GitHub-only source code/branches/PRs; local PC only for actual Workerd/D1 execution because GitHub tool has no test runtime.

**Spec:** `docs/superpowers/specs/2026-11-15-m07-store-credit-batch-design.md`
**Goal:** Verify all-or-nothing Store Credit over 2–20 original Customer-linked invoices, signed due and child ledger balance order, no Cash/Bank effects.
**Tech stack:** original M06/M07 synthetic fixtures, local Workerd/D1, Node ESM, GitHub Actions aggregate.

## Task 1 — Test RED

**Create:** `tests/integration/m07-store-credit-batch-workerd.spec.mjs`, `wrangler.m07-credit-batch-test.jsonc`, `tests/fixtures/m07-credit-batch-worker.mjs`.
- [ ] Set up two real synthetic M06 original invoices, explicitly seeded M07 source lots, `m07_batch_source_policy`, verified Customer→Party source link and one **signed test-only** Customer balance.
- [ ] Real D1 tests: two child Store Credits cause ledger balances in deterministic order (e.g. 20000→13000→5000), fully paid original source creates a negative balance, no Cash/Bank/Supplier side effects.
- [ ] Add replay/changed intent/actor/batchId, duplicate invoice or return IDs, walk-in/split tender/other Customer, stale hash/source quantity or Party link, closed session, concurrent last unit, late ledger and stock movement failures, Cash ↔ Credit parent collision, immutable receipt and HTTP 404 tests.
- [ ] Run test with no contract yet. Assert expected RED module-not-found.

## Task 2 — Implement minimal isolated D1 GREEN

**Create:** `tests/fixtures/m07-credit-batch-schema.mjs`, `tests/fixtures/m07-credit-batch-contract.mjs`.
**Modify:** `tests/fixtures/m07-cash-batch-schema.mjs` (test-only cross-parent collision safety).
- [ ] Strict bounded input parsing (2–20; one SKU/line per invoice), SHA256 M03 operation fingerprint, returnId and child operation ID unique, one exact Customer.
- [ ] D1 guarded parent receipt and AFTER INSERT child `m07_credit_returns` inserts (reusing M07-A2 child trigger) with ordered child ledger balances and member receipts; SQL failure rolls back everything.
- [ ] SQL original invoice hash/customer/item/movement/lot/price + split-payment provenance + reviewed Party/customer-signed-account + Cash Session checks.
- [ ] Existing Cash parent cannot claim a previously used Credit batch identifier.
- [ ] Demonstrate GREEN and prove all effects/rollback with actual Workerd/D1, not mocks.

## Task 3 — Verify, publish PR

**Modify:** `tests/integration/m03-workerd.spec.mjs` (single test import).
**Create:** `docs/M07_STORE_CREDIT_BATCH_D1_PROOF.md`.
- [ ] Rerun focused M07-A1 Cash, M07-A2 Store Credit, M07-A3 Cash batch plus new Store Credit batch D1 tests.
- [ ] `TZ=UTC npm test` (M06 Bangladesh timezone issue #92 tracked separately); source SHA validation; frontend build, SQL, syntax, diff, changed-file inventory.
- [ ] Create GitHub scoped PR; report RED/GREEN and CI status without claiming production-ready or merging unreviewed financial code.
- [ ] Check branch divergence/CI before final handoff.
