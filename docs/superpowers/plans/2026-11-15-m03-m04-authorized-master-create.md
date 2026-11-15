# M03/M04 Product Master SQL Authorization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task. Each task uses RED → GREEN → verification before review.

**Goal:** Prove real proposed M04 `products.add` authority is checked inside the same D1 master creation mutation and actor-bound receipt replay.

**Architecture:** Separate internal authorized creator with auth-sourced SQL INSERT SELECT; test-only DDL overlay extends merged synthetic master receipts with SQL-derived actor. No edit of existing unguarded M03 proof and no deployed RPC.

**Tech Stack:** JS ESM, Cloudflare Workerd/D1, `node:sqlite`, `node:test`, GitHub PR/CI.

**Spec:** `docs/superpowers/specs/2026-11-15-m03-m04-authorized-master-create.md`

## Global Constraints
GitHub only; KISS; pinned original GAS untouched. No live D1 or deployable migration. No client-supplied actor, business ID, clock, or SQL identifiers. Use real proposed M04 schema in local-only tests. Review and maintain all 11 CI gates.

## Review Focus
- Current session permission at exact mutation, not earlier JS read
- Replay after revocation/password/role change and replay by a different actor
- Blank/Unicode duplicate behavior with no unauthorized catalog disclosure
- Concurrent revoke/creation and late D1 failure all-or-nothing
- No public RPC or preview data binds

### Task 1 — RED
**Create:** `tests/fixtures/m03-m04-authorized-master-schema.mjs`, `tests/m03-m04-authorized-master-create.test.mjs`, `tests/fixtures/m03-m04-authorized-master-worker.mjs`, `wrangler.m03-m04-authorized-master-test.jsonc`, `tests/integration/m03-m04-authorized-master-workerd.spec.mjs`.
**Modify:** one additive test import in `tests/integration/m03-workerd.spec.mjs`.
- [ ] Write and commit tests before `src/modules/m04-authorized-product-master-create.js`.
- [ ] Observe expected GitHub RED failure in Foundation or staging-local suite for missing module, not test syntax.
### Task 2 — GREEN
**Create:** `src/modules/m04-authorized-product-master-create.js`.
**Interface:** `createM04AuthorizedProductMasterCreator(env,{businessId}).createCategory_({token,nowMs,operationId,name})` and `createUnit_(...)`.
- [ ] Validate exact input keys, use M04 digest over raw token bytes and trusted clock.
- [ ] Authorize readback and scan, then authorize **again at INSERT statement** from current M04 SQL session/role.
- [ ] Bind SQL-derived actor to immutable synthetic creation receipt; scope replay to same authorized actor.
- [ ] Preserve merged M03 snapshot CAS/inactive cleanup/source ID trigger and exact source success envelope.
- [ ] Run Node tests, local real Workerd D1, and full 11-check GitHub CI on exact HEAD; fix observed failures only.
### Task 3 — Review
- [ ] Compare branch to current main; ensure only docs, isolated source module, test fixtures/integration.
- [ ] Document RED/GREEN evidence, precise test counts and remaining production gates in draft PR.
- [ ] Do not merge without owner review and complete green CI. Do not mark M04 public ready.
