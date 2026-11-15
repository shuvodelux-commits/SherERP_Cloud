# M03 synthetic D1 posting contract — TDD execution plan

> **For agentic workers:** use Superpowers TDD and verify-before-completion. All work local test-only; do not activate posting.

**Goal:** Validate D1 SQL atomicity, exactly-once replay and contention with synthetic counter stock, without editing M02 migrations or live RPC.

**Architecture:** A dedicated local-only Worker config/fixture and `tests/fixtures/m03-transaction-contract.mjs` export a small synthetic batch SQL contract. A single Workerd+D1 integration suite runs in existing M03 PR-only CI by import from `tests/integration/m03-workerd.spec.mjs`.

**Source:** `docs/superpowers/specs/2026-11-15-m03-d1-posting-contract-design.md`.

## Task 1 — RED: real local D1 integration
- [x] Eight tests for COMMITTED/REPLAY/CONFLICT/DECLINED, concurrent last-unit race, trigger-injected rollback, malformed inputs and public-route isolation; observed RED missing fixture.
- [x] Minimal test-only synthetic four-statement D1 `batch` using bound values and explicit result-shape validation; adjusted DDL execution to `prepare(...).run()` as local D1 `exec()` splits multiline statements.
- [x] GREEN: all 8 dedicated tests against actual Workerd+D1 (not mocked).

## Task 2 — integration and safety
- [x] Imported dedicated suite into existing `tests/integration/m03-workerd.spec.mjs` CI entry; no GitHub Actions workflow changes.
- [x] Synthetic-only UUID and no public route; checks confirm no deployed `src/index.js` or `src/rpc/**` imports; zero migration changes.
- [x] Documented difference between D1 transaction behavior and full ERP ledger/lot consistency in `docs/M03_D1_TRANSACTION_CONTRACT.md`.

## Task 3 — verify/PR/merge
- [x] Fresh verification: 192/192 Node tests; 28/28 real Workerd/D1 tests (includes 8 synthetic contract); 84 original source files; frontend build; frozen 47-file M03 audit; syntax and diff checks.
- [ ] Push isolated branch. Require GitHub Actions, Chromium smoke and exact Cloudflare Preview before squash merge.
