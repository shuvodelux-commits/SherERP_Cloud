# M03 Receipt Reconciliation — Implementation Plan

> **For agentic workers:** Execute under superpowers:executing-plans and test-driven-development: observe RED then GREEN.

**Goal:** Fail-closed, tenant/actor-verified readback of an immutable committed operation receipt after unknown D1 result.
**Architecture:** Internal read-only adapter using the merged canonical fingerprint primitive and fixed D1 SELECT. Test-only synthetic schema and local D1 Worker prove commit/rollback and lost-response recovery.
**Tech:** Node 24, node:sqlite, Wrangler 4.161 local Workerd+D1, ESM WebCrypto.
**Design:** `docs/superpowers/specs/2026-11-15-m03-immutable-receipt-reconciliation.md`

## Boundary
Keep `migrations/**`, staging guards, src/index.js, src/rpc/**, legacy/source/**, existing SQL writers, frontend and deployed D1 bindings untouched. The only DDL is `tests/fixtures/m03-receipt-schema.sql`, never migrated remotely.

## Task 1 — Node TDD for read-only reconciliation
**Files:** `src/db/operation-receipt-reconcile.js`, `tests/m03-operation-receipt-reconcile.test.mjs`, `tests/fixtures/m03-receipt-schema.sql`.
- [ ] Test real sqlite receipt, matching hash and result ref using #51 hash helper, changed payload/actor/type, cross-tenant no leak, missing -> NEEDS_REVIEW.
- [ ] Validate exact input, operation ID, malformed D1 responses, duplicates, read-only assertions, insert-only receipt immutability and separate tenants.
- [ ] Record RED on missing module, then implement fixed SQL SELECT and response policy. GREEN focused Node tests.

## Task 2 — Local Workerd+D1 proof
**Files:** `tests/fixtures/m03-receipt-worker.mjs`, `wrangler.m03-receipt-test.jsonc`, `tests/integration/m03-receipt-workerd.spec.mjs`, `tests/integration/m03-workerd.spec.mjs` (single import).
- [ ] RED real Workerd tests with stub Worker: expected routes fail.
- [ ] Test Worker defines only hardcoded fixture actions, not caller-controlled SQL, IDs or actor; install test-only DDL in actual local D1.
- [ ] Run transaction: insert receipt, decrease dummy stock, write dummy journal. Intentionally return 503 despite committed batch, then reconciling exact intent must be REPLAY.
- [ ] Different payload/actor/type => CONFLICT. Different tenant / unknown ID => NEEDS_REVIEW. Later journal failure => whole D1 batch rollback and no receipt.
- [ ] Verify no financial or other production tables touched; no real Worker imports/remote writes.

## Task 3 — Checks and PR
- [ ] Add docs `docs/M03_OPERATION_RECEIPT_RECONCILIATION.md`, source/file/table/RPC impact, limitations.
- [ ] Full npm test, real `node --test tests/integration/m03-workerd.spec.mjs`, verify:source, frontend build, caller inventory, node syntax, diff-check.
- [ ] Rebase on latest main and rerun checks. Commit, push and open PR for review, never auto-merge. Explicitly flag PARALLEL-MODULE-READY false and no live receipt table.
