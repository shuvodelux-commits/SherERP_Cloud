# M07-B3 — Synthetic Store Credit Return Delete Workerd/D1 Proof

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task; RED → GREEN → refactor → verify.

**Goal:** Prove exact-once reversal of a synthetic, source-linked single-line Store Credit Sales Return without touching Cash, Bank or any other Party account.

**Architecture:** Reuse merged M06 original invoice and M07 Store Credit synthetic posting tables, add test-only immutable correction receipts and an atomic SQL trigger for original-lot inventory undo and original Customer's signed balance restoration. Do not modify `src/**`, public RPC, migrations, production Worker or original source. This is a D1 **safety proof only**, not a production correction writer.

**Tech Stack:** Node 22 ESM, Wrangler 4.161.0, isolated Workerd + D1 SQLite, existing M03 operation fingerprint.

**Spec:** `docs/M07_RETURNS_SOURCE_CONTRACT.md`; source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `SalesReturn.gs::prepareSalesReturnChange_` and `DeleteEngine.gs`.

## Overview (12 sentences)

1. A Store Credit return is a separate historical Sales Return receipt, never an edit to the original sale.
2. A correction must preserve the original immutable return, credit ledger entry, stock movement and invoice evidence for audit.
3. Only the explicitly selected original Customer ID and its reviewed Party link may receive the signed-balance reversal.
4. Returning credit can have created a negative Customer balance, so deleting that return must restore a signed balance without truncating advances.
5. Cash and Bank must remain completely unchanged because no physical payment occurred for Store Credit.
6. The correction may only consume the exact original returned lot quantity if that stock remains available and has not been resold.
7. The existing credit ledger entry must match the original return amount and party provenance within the D1 claim.
8. A changed Customer balance, an active later credit, or an explicit dependent settlement marker must block reversal rather than silently replay settlements.
9. Session closure, unreviewed or reassigned Party links, ambiguous identity and altered original source hashes must block before any financial effect.
10. One tenant-scoped correction operation ID and immutable canonical intent must yield exactly one commit, identical replay or a conflict.
11. Concurrent delete attempts and failures injected into stock or ledger writes must leave at most one complete atomic correction.
12. This local synthetic proof cannot authorize production corrections until M03 transaction, M04 actor/permission, M05 lot, M06 original invoice and M08 ledger/settlement gates are integrated and reconciled.

## File impact / permissions

- Add `tests/fixtures/m07-credit-delete-schema.mjs`: synthetic-only immutable correction receipt, reverse stock movement, signed Customer ledger undo, explicit synthetic dependency marker and active-view projection.
- Add `tests/integration/m07-credit-delete-workerd.spec.mjs`: real local D1 tests for original sale/Store Credit correction, advance sign, replay, concurrence, resale, customer/Party/session/source/settlement rejection, failure-injection rollback, immutable audit, no public route.
- Add `tests/fixtures/m07-credit-delete-contract.mjs` **after RED**: exact-shape canonical intent + SQL-guarded two-statement batch/receipt.
- Add `wrangler.m07-credit-delete-test.jsonc`: isolated local nondeployable D1 binding.
- Add one import to `tests/integration/m03-workerd.spec.mjs` so existing GitHub Actions executes tests.
- This plan is the sixth changed file; no `src/**`, `legacy/source/**`, `migrations/**`, `src/rpc/**`, `wrangler.preview.jsonc` or deployed endpoint changes.

## Tasks

### Task 1 — RED

- [ ] Create plan and test-only schema/config.
- [ ] Write real Workerd tests before the correction contract exists; source sale/return must be exercised using current merged M06/M07 fixtures.
- [ ] Commit test-first code and observe expected `ERR_MODULE_NOT_FOUND` for `tests/fixtures/m07-credit-delete-contract.mjs` in GitHub Actions, not a random failure.

### Task 2 — GREEN

- [ ] Implement minimal test-only SQL claim with immutable receipt, same-transaction original-source, return movement, customer ledger and signed-balance CAS/Party review guard.
- [ ] SQL trigger restores only the original source lot and original Customer signed due, inserts inverse ledger and stock audit.
- [ ] Defer full settlement replay: explicitly fail closed on a dependent activity marker; check newer active credit ledger and current signed balance against source ledger snapshot.
- [ ] Test identical replay, changed actor/return/source, two competing operation IDs and failure-injected stock/ledger rollback in real D1.

### Task 3 — Verify and review

- [ ] Run `npm test`, `npm run verify:source`, `npm run build:frontend`, exact-head full real Workerd/D1 and GitHub PR-only no-secret preview checks.
- [ ] Open/maintain a scoped draft PR, document RED/GREEN SHAs and exact workflow evidence, and leave unmerged pending owner review.
- [ ] Never claim this fixture proves native multi-line/bundle settlement-dependent Store Credit deletion, production staff authority, imported historical data or full ERP readiness.

## Review focus / release gate

Original GAS soft-deletes and filters source rows for Day Book while the synthetic D1 fixture retains immutable inverse entries and views; presentation and historical customer settlement parity require a separate source-readback PR. A separate `m07_credit_delete_dependencies` synthetic marker models later settlement evidence; it is **not** a port of the real Customer Settlement subsystem. No automatic cross-role netting is allowed. All operations must be source-linked, tenant-scoped, and exactly-once in the D1 transaction, with no client-controlled permission or user ID accepted as production authority. Rollback this test proof by reverting six additive/test-only edits; no business data are written or migrated.
