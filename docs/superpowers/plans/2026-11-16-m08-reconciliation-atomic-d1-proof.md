# M08 — Local real D1 reconciliation atomicity proof: TDD execution plan

**Spec:** `docs/superpowers/specs/2026-11-16-m08-reconciliation-atomic-d1-proof-design.md` — test-only, no public RPC/migrations/production cash data.

1. **RED:** Add `tests/integration/m08-reconciliation-atomic-workerd.spec.mjs` importing missing fixture schema and contract and testing authorized commit, replay/collision, wrong sign, reused entry, stale revision, revocation, race and late audit failure rollback. Add it to `tests/integration/m03-workerd.spec.mjs` to run in existing no-secret PR workflow. Run CI and inspect expected `ERR_MODULE_NOT_FOUND`. Introduce no implementation before RED is verified.
2. **GREEN:** Add `tests/fixtures/m08-reconciliation-atomic-schema.mjs` fixed disposable SQLite DDL and seed, `tests/fixtures/m08-reconciliation-atomic-contract.mjs` fixed prepared SQL + immutable intent hash and status checks, `tests/fixtures/m08-reconciliation-atomic-worker.mjs` deny-all 404 worker, `wrangler.m08-reconciliation-test.jsonc` fake D1 binding. No SQL migrations or public Worker mutation.
3. **VERIFY:** In CI inspect actual Workerd D1 integration outcomes (not mocks only), full `npm test`, `verify:source`, frontend build, mergeability and file scope. Correct failures with test-first changes and repeat. Leave PR unmerged for owner review, document remaining multi-entry/source-parity and production integration gaps.

The proof is deliberately one selected *closing* explanation only; cannot be described as a complete M08 migration or safe live financial posting. Stable idempotency must be rebuilt against the actual authenticated tenant schema before enabling any finance endpoints.
