# M03 Authorized Receipt Readback — TDD Plan (2026-11-15)

**Objective:** Tie M03 immutable receipt readback to M04 synthetic active session/role authority in one tenant-scoped D1 SQL SELECT. No live auth or posting.
**Design:** `docs/superpowers/specs/2026-11-15-m03-authorized-receipt-design.md`.
**Scope:** new `src/db/authorized-operation-receipt.js`, new Node test, new isolated local Workerd tests/fixture/config, docs, one import in existing M03 Workerd CI aggregator. Existing `src/db/operation-receipt-reconcile.js`, M04 fixtures, migrations and deployed Worker remain unchanged.

1. Inspect `AGENTS.md`, M03 receipt contract, M04 atomic authority test fixtures and staging schema gate. Write test-only schema `tests/fixtures/m03-authorized-receipt-schema.mjs` including session+user+role version checks and committed immutable receipts.
2. RED Node `tests/m03-authorized-operation-receipt.test.mjs`: fresh session owner replay; changed payload conflict; missing -> review; other actor/tenant denied; expiry/revoke/user-role version disabled; input validation; no writes; malformed/error fail closed. Verify missing new module failure.
3. Implement fixed-bound, single-statement SELECT + canonical digest using trusted actor derived from D1. GREEN Node tests.
4. RED real Workerd `tests/integration/m03-authorized-receipt-workerd.spec.mjs` (stub fixed Worker 404) then GREEN with test-only routes and fixed synthetic inputs; can use real local D1 bindings and mutation of test auth rows. Verify no client body influence.
5. Integrate suite with `tests/integration/m03-workerd.spec.mjs`; document `docs/M03_AUTHORIZED_RECEIPT_READ.md`. Full `npm test`, full real Workerd+D1, `verify:source`, frontend build, caller inventory, static source guard, syntax and diff.
6. Check latest `main`, resolve conflicts retaining concurrent imports/tests, rerun checks, commit and push isolated PR for review. Do not auto-merge or enable module readiness.
