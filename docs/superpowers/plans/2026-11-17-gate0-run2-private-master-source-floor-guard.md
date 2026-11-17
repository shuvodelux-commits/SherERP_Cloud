# Gate-0 Run 2 — Private Product Master Source-ID Floor Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development; execute RED → GREEN on the isolated branch and request independent Super QA / Super Review before merge.

**Goal:** Ensure the **nondeployable, private** Product Category/Unit atomic D1 creation proof fails closed when its persisted source-ID counter lags a historical source ID.

**Architecture:** Reuse the merged original Product master, M04 SQL-current session/role authorization, M03 snapshot CAS and M03 private sealed-source 38-family counter-floor audit. The narrow missing defense is an *atomic SQLite guard* inside the existing **synthetic test trigger**, not a separate JS preflight or a new public RPC. Guard both PCAT and PUNT before the SQL trigger writes cleanup rows, source-ID receipts, counter increments, or catalog rows. Keep the original schema, source UI and existing D1 runtime untouched.

**Tech Stack:** Node 22+, Node native test runner and sqlite, existing local Workerd/D1 integration harness and GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-17-shererp-gate0-integration-design.md` (Run 1 merged; scope restricted to a private internal proof). See `docs/M03_PARALLEL_READINESS.md`, `docs/M03_RUN6_COUNTER_FLOOR_HANDOFF.md`, M03 #22, M04 #252 and coordination #456.

## Global Constraints

- Base `SherERP_Cloud/main@e75cde4f49f511f3e95f7c07bd896cdd69bd9e81`; original source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
- **M03 is single owner** of shared D1 posting. No concurrent open PR was visible when this branch was reserved. The only executable implementation edit is `tests/fixtures/m03-master-atomic-schema.mjs`, a synthetic test-only SQL trigger. No live migrations, `src/db`, `src/rpc`, `src/auth`, `src/index.js`, CI workflow or Wrangler production changes.
- Continue to deny all public business RPC; `src/rpc/registry.js` stays empty and production Wrangler has no D1 binding.
- Preserve original PCAT/PUNT source identity, stable receipt, M04 current SQL actor and permission, immutable operation ID, stale catalog snapshot CAS, duplicate suppression, rollback and source-name/Unicode rules. Do not derive issued IDs from `MAX(id)+1`; existing reviewed counter remains the allocator.
- This guard is defense-in-depth **only for the local test trigger** and does not authorize actual source-ID floor installation, private data import or production launch. Counter audit #604 is an independent, read-only prerequisite and still reports `idIssuanceAuthorized:false`.
- Run Superpowers test-first, full exact-head CI, independent QA/Review and human-approved merge. Keep draft until all gates pass.

## Review Focus
1. An old `PCAT-000090` exists while the counter is 16: issuing `PCAT-000017` without first verifying floor must be rejected with **no state change**.
2. An old `PUNT-000090` exists while its counter is 7: reject a new Unit with no state change.
3. Correct 16/7 source floors must continue creating PCAT/PUNT; the guard cannot falsely reject original zero-padded valid IDs.
4. On SQL abort, catalog row compaction, receipt, operation intent and counter must all rollback atomically, even in Workerd/D1.
5. A forged malformed source ID or absent counter row should fail closed, not be normalized silently into a new ID.

---

### Task 1: Write RED source-ID floor regression against native local SQLite

**Files**
- Modify: `tests/m03-m04-authorized-master-create.test.mjs`
- Verify source only: `tests/fixtures/m03-master-atomic-schema.mjs`

**Interfaces**
- Existing: `createM04AuthorizedProductMasterCreator(env,{businessId:'BUS-A'})`, `createCategory_({token,nowMs,operationId,name})`, `createUnit_(...)`.
- No new exported production interface.

- [ ] Add a test per family using existing isolated `fixture()`: insert an original `PCAT-000090` / `PUNT-000090` into its catalog with a unique `legacy_sheet_row` while leaving counter at 16 / 7.
- [ ] Capture `state()`; call authenticated fresh create with a new stable operation ID and valid name; assert rejection `/counter floor|source ID|mismatch/i` and exact unchanged catalog/counter/intents/receipts after the attempt.
- [ ] Run `node --test tests/m03-m04-authorized-master-create.test.mjs` on test-first branch and **observe expected failing assertion**, not a syntax/test setup error.

### Task 2: GREEN — guard inside the synthetic atomic master trigger

**Files**
- Modify: `tests/fixtures/m03-master-atomic-schema.mjs`

**Interfaces**
- Reuse `createTrigger(table,key,id,name)` with fixed, trusted category/unit table and ID columns.
- No dynamic user SQL/table input and no JS authority preflight.

- [ ] Before the trigger mutates catalog or inserts a source-ID receipt, require an existing tenant/id-key/prefix counter and prove each already-imported source master ID is canonical (`PCAT-000001` / `PUNT-000001` or higher) and its suffix is at or **below** that counter.
- [ ] Use an SQL `RAISE(ABORT,...)` guard against missing/malformed/lagging counter. Ensure the guard executes within the SAME SQLite trigger statement as intent, cleanup, receipt and append.
- [ ] Rerun `node --test tests/m03-m04-authorized-master-create.test.mjs`; expected all cases pass. Run also `node --test tests/m03-product-master-atomic-create.test.mjs` to check the existing non-authenticated synthetic planner is unaffected.

### Task 3: Verify actual local Workerd/D1 failure atomicity

**Files**
- Modify: `tests/integration/m03-m04-authorized-master-workerd.spec.mjs`

**Interfaces**
- Existing Workerd harness `DB`, `worker.fetch` and `state()`.

- [ ] Add a **new last test** to the Workerd suite. Insert a high source ID with a new physical source row while counter stays lower; call private `/__m04_master__/private-rpc` with an authenticated category operation; assert generic non-success and identical full `state()` including no ID burned. Do the same for Unit if test fixture supports it.
- [ ] Keep the test nondeployable; do not expose public RPC or modify original UI.
- [ ] Run the existing M03-M04 local Workerd suite, followed by required full exact-head GitHub CI; expected 0 failures.

### Task 4: GitHub PR, independent review and handoff

**Files**
- Modify: this plan (progress evidence as needed)
- No other shared changes

- [ ] Open one scoped draft M03 integration PR into latest `main` with exact-file ownership, source SHA, RED/GREEN evidence, Workerd/Node tests and rollback.
- [ ] Independently verify diff has only test fixture, tests and this plan; verify no production binding, migration or public RPC change.
- [ ] Require **44/44 current-head workflows** and separate Super QA / Super Review, M03 SQL owner and M04 security approval.
- [ ] Human-approved merge, reverify files on main; issue #456 and #22 updated. If review/CI remains open, leave draft and report precise blockers.
- [ ] Do **not** mark M02 49-group source reconciliation, M03 production posting or M11 cutover ready from this private proof.

**Risk/rollback:** A test-fixture SQL-trigger change can invalidate existing local synthetic source-master proofs. Reverting this scoped PR removes it; no production data or schema is modified. Any failure in existing Workerd/Node CI blocks merge.
