# M07-A2 Store Credit Real D1 Proof — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans task by task with RED → GREEN → refactor → verify.

**Goal:** Prove exact-once Store Credit restores physical stock but changes only the original customer's **signed** due and source credit ledger.
**Architecture:** Extend existing isolated M07/M06 Workerd/D1 test fixture, no public schema/RPC, no independent production engine. Transactionally SQL-guard source and Party provenance; use M03 intent fingerprints for replay.
**Tech Stack:** Node ESM, Cloudflare local Workerd/D1, existing M06/M07 fixtures and GitHub CI.
**Spec:** `docs/superpowers/specs/2026-11-15-m07-store-credit-d1-design.md`.

## Global Constraints
- Original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` bytes unchanged.
- No modification to `src/**`, `migrations/**`, `wrangler.preview.jsonc`, original UI, public RPC or remote D1.
- Tenant/actor supplied by test harness only; not authenticated staff authority.
- Preserve original Customer ID + separate Supplier AP; no Party auto-net or cash/book entries from Store Credit.
- KISS. Frozen M06/M07 receipt/source stock effects must remain supported.
- One GitHub branch/PR, all GitHub checks before merge.

## Review Focus
1. Same operation ID used across Cash vs Store Credit: conflict with no double effect.
2. Forged source lot capacity: reject when lot sold exceeds actual sale.
3. Customer due 0 with Store Credit: produce **negative** signed due (advance), not truncate.
4. Invalid/unreviewed original Customer link: reject, no auto-inferred Party or different customer credit.
5. Injected ledger failure: no return receipt, stock restoration, account balance or stock movement.

## Task 1 — Write RED Workerd tests
**Files:** `tests/integration/m07-store-credit-workerd.spec.mjs`, `wrangler.m07-store-credit-test.jsonc`, `tests/fixtures/m07-store-credit-worker.mjs`.
**Interface:** `createSyntheticD1StoreCreditContract(DB).post(input)`, returns `COMMITTED|REPLAY|CONFLICT|DECLINED` or `NEEDS_REVIEW`. Exact fields: tenantId,actorId,operationId,returnId,invoiceId,sku,lotId,originalHash,customerId,units,creditPaisa,reason.
- [ ] RED: original M06 sale and lot evidence + signed customer starting balance; Store Credit decreases from 20000 to 12500 and zero to -7500, preserves other Parties and cash/bank; import nonexistent implementation fails expected.
- [ ] GREEN: after Task 2, run focused Workerd suite; test same/different intent, last unit, price, tenant, customer/Party link, forged source quantity and rollback.

## Task 2 — SQL-guarded test-only implementation
**Files:** `tests/fixtures/m07-store-credit-contract.mjs`; modify existing `tests/fixtures/m07-cash-return-schema.mjs`, `tests/fixtures/m07-cash-return-contract.mjs`.
- [ ] Add credit-specific synthetic signed balance, immutable receipt, ledger and SQLite trigger to M07 test schema; no production SQL.
- [ ] RED cross-method operation/return ID reuse against A1 Cash path. GREEN add SQL-level sibling-method guard and lookup to A1 Cash.
- [ ] Insert guarded Store Credit receipt + same-statement trigger for stock and signed account and ledger. Compare source invoice/customer and reviewed link inside SQL.
- [ ] Add fault injection tests proving all effects roll back.

## Task 3 — CI and PR
**Files:** one-line `tests/integration/m03-workerd.spec.mjs` import; `docs/M07_STORE_CREDIT_D1_PROOF.md`.
- [ ] Run focused real Workerd/D1 test, previous M07 Cash test, `node --test tests/integration/m03-workerd.spec.mjs`, `npm test`, `npm run verify:source`, `npm run build:frontend`, `git diff --check`.
- [ ] Open scoped GitHub PR with RED/GREEN evidence, files, RPC/schema impact and absent production gates. Wait on CI/owner review before merge.
