# M02-P Actual Workerd Party Identity Constraints — Execution Plan

> Use superpowers:executing-plans or equivalent guarded TDD; no production data.

## Workstream and ownership
M02-P independent verification, frozen 47 GAS sources; uses existing D1 migrations, **no modifications to existing schemas or shared M03 runtime**.

## Tasks
- [x] Write tests under `tests/integration/m02-party-workerd.spec.mjs` for seven role invariants, repeated names, source ID/row provenance, human review, immutable history, review queue, atomic batch failure and concurrent duplicate.
- [x] Observe RED with missing dedicated test harness config.
- [x] Add `tests/fixtures/m02-party-test-worker.mjs` and `wrangler.m02-party-test.jsonc`; verify local actual Workerd/D1 tests GREEN.
- [x] Add `.github/workflows/m02-party-workerd.yml` with `pull_request` only, no secrets or remote operations; pin Node and Wrangler.
- [x] Run full `npm test`, `npm run verify:source`, `npm run build:frontend`, and isolated workerd test; prove no shared runtime/schema changes.
- [ ] Reconcile latest `origin/main`, rerun checks, publish narrow PR, verify all GitHub CI and new M02 workerd workflow; leave for review.

## Blockers
This does not satisfy full M02-P financial reconciliation; M03 atomic posting/async call propagation and M04 authenticated allowlist remain pending. Do not switch PARALLEL-MODULE-READY.