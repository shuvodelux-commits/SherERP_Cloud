# Superpowers TDD plan — M08 synthetic marker retirement

**Design:** `docs/superpowers/specs/2026-11-17-m08-marker-retirement-atomic-local-design.md`. **Issue:** #452. **Coordination:** #456. File owner **M08** for new fixtures and the existing M08 Workerd test only. M03 owns all shared D1/posting/kernel surfaces.

## Task 1 — RED

1. In the existing dedicated real Workerd/D1 integration test `tests/integration/m08-d1-opening-explanation-workerd.spec.mjs`, import intentionally absent M08 test-only marker schema/contract. Append tests for matching close adjustments (multiple rows), Session Open marker retention, source-description parity, wrong session/tenant, deleted/zero/balanced real entries, duplicate same-payload replay, changed intent, stale/revoked role/session/token, concurrency and failure-injected second-row/audit rollback.
2. Commit only tests to branch from latest main, open a draft PR using the repository PR template, and verify the actual CI failure is `ERR_MODULE_NOT_FOUND`, **not** a runner/setup defect.

## Task 2 — GREEN

1. Create `tests/fixtures/m08-marker-retirement-atomic-schema.mjs` with isolated `m08_marker_*` STRICT tables, SQL-atomic trigger, guarded revision and audit, no real migrations/Worker bindings. Keep Cash Book `legacy_row`, `entry_id`, `type`, `reference` immutable under retirement.
2. Create `tests/fixtures/m08-marker-retirement-atomic-contract.mjs` with strict synthetic request validation, canonical intent fingerprint, bound SQL authentication at commit time, one SQL guarded claim + trigger + receipt readback in `D1.batch`, replay/conflict/declined/uncertain states. **No client-derived actor accepted in production**; this is a synthetic fixture contract.
3. Inspect real Workerd/D1 job, iterate failing RED cases without weakening invariants. Run full Node Foundation, `verify:source`, frontend build and all PR checks; keep the PR open until required checks and reviews pass.

## Task 3 — release boundary

Document exact RED/GREEN commits and check-run links. The full #452 **source-positional explanation write** remains pending; do not close #452 after this single sub-slice. No remote staging/production D1, production financial writer, shared M03 file or Cloudflare deployment change. Merge only after full latest-head CI green, mergeability and owner review.
