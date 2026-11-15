# M03 Synthetic Reversal — TDD Execution Plan

**Goal:** Prove exactly-once, tenant-scoped owned-stock reversal in actual D1, with source identity, evidence and late-write rollback.
**Type:** Test-only contract and design; no production reversal feature.
**Source:** `DeleteEngine.gs#deleteSalesInvoice`, `SalesReturn.gs#deleteSalesReturn`, `StockLots.gs#planSalesReturnStockUndo_`.
**Design:** `docs/superpowers/specs/2026-11-15-m03-synthetic-reversal-contract.md`.

## Task 1 — Fixture schema + Node RED/GREEN
**Files:** new `tests/fixtures/m03-reversal-schema.mjs`, `tests/fixtures/m03-reversal-contract.mjs`, `tests/m03-reversal-contract.test.mjs`.
- Read frozen source and document which rules are/aren't modeled.
- Write independent Node SQLite tests for exact-once reversing original committed owned source, replay, actor/intent/source conflicts and second reversal ID.
- Validate negative cases: no original, wrong payload hash, vendor-only movement, active return, missing stock, journal constraint failure.
- Test parallel two distinct reversal IDs, cross-tenant same IDs, invalid input, unknown/malformed D1 batch response.
- Run RED before implementation; implement fixed, parameterized D1 batch with trigger-enforced stock+journal effects, prove GREEN.

## Task 2 — Actual local Workerd+D1 RED/GREEN
**Files:** new `tests/fixtures/m03-reversal-worker.mjs`, `wrangler.m03-reversal-test.jsonc`, `tests/integration/m03-reversal-workerd.spec.mjs`; existing `tests/integration/m03-workerd.spec.mjs` gains one import.
- Stub Worker responds 404, record RED.
- Install test-only schema in disposable local Workerd binding, no D1 migrations, no remote writes.
- Fixed synthetic routes exercise reverse, replay, changed reason, second reversal ID, no original, existing return, vendor-only source, rollback when stock missing/journal blocked, concurrent claims and tenant isolation.
- Worker ignores body and query; no arbitrary SQL or user-supplied actor.

## Task 3 — Documentation and verification
**Files:** `docs/M03_REVERSAL_ATOMICITY_CONTRACT.md`, this plan and design.
- Fresh `npm test`, real full M03 Workerd test suite, source-integrity, frontend build, M03 caller inventory, JS syntax and diff checks.
- Commit and push isolated branch from latest main; open narrow PR for review, do not auto-merge or modify Cloudflare deployment.
- Report exact evidence and blocked readiness, not falsely full financial reversal parity.
