# M03 atomic master create proof — Superpowers TDD implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Prove source-faithful Category/Unit creation and exactly-once ID issuance as one atomic local D1 operation, without enabling public writes.
**Architecture:** Existing awaited catalog reader produces a complete JS-verified snapshot and inactive cleanup candidates. One new nondeployable SQLite trigger receives a source-shaped intent and makes snapshot CAS, cleanup, row compaction, sequential ID receipt and Active catalog append a single abortable SQLite statement. Stable operation receipt reconciles replay.
**Tech Stack:** GitHub PRs/Actions, JavaScript ESM, Cloudflare Workerd/D1 SQLite, node:test, node:sqlite.
**Spec:** docs/superpowers/specs/2026-11-15-m03-atomic-product-master-create.md

## Global constraints

Main stays review-only. No remote D1 migrations or production RPC. Pinned source stays frozen. Current business architecture is one D1 binding per business; no client tenant. Source prefixes PCAT and PUNT; default status Active; Unicode JS name matching; preexisting source IDs must be reconciled before counters are seeded.

## Review focus

- Two concurrent independent requests for the same name: one commit, other stale refusal, no duplicate.
- Same operation ID with different normalized name: immutable intent collision, no counter burn.
- Inactive Unicode duplicates and physical row gaps: either exact cleanup+stable compaction or total rollback.
- Compaction, counter, receipt or final catalog insert failure: SQL ABORT rolls back everything.
- Future auth revocation: not yet enforced, so method must remain test-only/internal and cannot be registered on public RPC.

### Task 1 — RED acceptance (GitHub branch)

**Files:** tests/m03-product-master-atomic-create.test.mjs, tests/fixtures/m03-master-atomic-schema.mjs, tests/fixtures/m03-master-atomic-worker.mjs, wrangler.m03-master-atomic-test.jsonc, tests/integration/m03-master-atomic-workerd.spec.mjs, one import in tests/integration/m03-workerd.spec.mjs.
- [ ] Commit tests and fixed test-only schema/Worker before implementation.
- [ ] Verify expected GitHub RED failure: missing src/modules/m03-product-master-atomic-create.js (not test syntax).

### Task 2 — GREEN internal repository method

**Create:** src/modules/m03-product-master-atomic-create.js.
- [ ] Implement stable operation/name hash, strict request validation, replay readback, one awaited catalog snapshot and JS duplicate check.
- [ ] Commit only source module. Verify local Node SQLite, full Foundation, and real local Workerd/D1 tests.
- [ ] Fix only evidenced failures, verify again on exact branch HEAD. Never register live RPC.

### Task 3 — Review

- [ ] Inspect diff for schema scope and source fidelity. Confirm no numbered migrations, live Cloudflare config, original source/UI, authorization bypass or financial writes.
- [ ] Update draft PR with RED/GREEN run IDs, tests and remaining gates, only ready after ten exact-head green checks.

### Next independent PRs

Step 2 M04 authority design/test boundary; Step 3 async graph findings and owned blockers; Step 4 parallel readiness evidence review. No premature readiness promotion.