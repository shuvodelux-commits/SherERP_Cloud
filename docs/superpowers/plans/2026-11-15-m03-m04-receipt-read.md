# M03/M04 Schema-Aligned Receipt Read — TDD Plan

1. Read AGENTS.md, docs/WORKSTREAMS.md, M03 receipt docs, M04 `d1-auth-core.js` and actual test migration schema. Set isolated branch; no production writes.
2. Save design `docs/superpowers/specs/2026-11-15-m03-m04-auth-receipt-design.md` and plan here.
3. Build only test fixture `tests/fixtures/m03-m04-receipt-schema.mjs`, with future committed immutable receipts. Write failing Node test `tests/m03-m04-receipt-read.test.mjs` using M04 migration SQL and exact M04 authority version triggers. Record RED missing adapter. Implement `src/db/m04-operation-receipt-read.js` (read-only, no public RPC), then GREEN.
4. Add test-only Worker `tests/fixtures/m03-m04-receipt-worker.mjs` and fake D1 `wrangler.m03-m04-receipt-test.jsonc`. Write Workerd tests first and observe RED on stub routes. Use actual fixture migration `applyD1Migrations('DB')`, insert only synthetic users/session/receipts in disposable local D1. Verify matching M04 salted token digest, expiry/idle/revoke/role/credential version and other actor privacy. GREEN.
5. Add exactly one import to existing `tests/integration/m03-workerd.spec.mjs`; publish `docs/M03_M04_SCHEMA_ALIGNED_RECEIPT_READ.md`. Run npm test, targeted Workerd, full integration suite when host memory permits, source checks, frontend build, 47-file M03 caller audit, M03 async graph, syntax/diff.
6. Rebase latest main, rerun. Push one review PR; do not merge automatically, no remote migrations, no production or preview D1.
