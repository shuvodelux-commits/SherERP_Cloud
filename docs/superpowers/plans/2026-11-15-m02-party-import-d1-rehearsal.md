# M02-P3 Synthetic Party → Local D1 Rehearsal Plan

**Source:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
**Scope:** isolated test-only M02-P fixture, no src/db, migrations, src/party edits or M04 logic.

- [x] Write failing test `tests/integration/m02-party-plan-workerd.spec.mjs` for reviewed source-to-D1 readback, unreviewed/quarantine blocking, duplicate rerun, failure atomicity and no RPC.
- [x] Write minimal `tests/fixtures/m02-party-plan-batch.mjs`: validate plan from existing importer, deterministic prepared SQL statements in safe Party/role/link order. Never use outside synthetic tests.
- [x] Add `tests/fixtures/m02-party-plan-worker.mjs` and `wrangler.m02-plan-test.jsonc`; run real local workerd/D1 with existing two migrations.
- [x] Add PR-only local D1 workflow `.github/workflows/m02-plan-local-d1.yml`, explicit locked npm install and pinned Wrangler, no deploy.
- [x] Run tests with RED→GREEN evidence; full Node suite, pinned source check, original frontend build, JS syntax/diff check.
- [ ] Rebase/merge fresh main safely; publish narrow PR and verify all CI checks.
- [x] Record approvalRef schema gap as release blocker; no production import approval claim.