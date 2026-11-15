# M04 atomic authorization boundary — execution plan

> Use Superpowers TDD, isolated worktree and verification-before-completion. The source spec is `docs/superpowers/specs/2026-11-15-m04-atomic-authority-design.md`.

## Task 1 — RED, then GREEN
- [x] Wrote 13 real Workerd/D1 tests first: active mutation, wrong tenant, expiry/revocation, disabled user/role and downgrade, reassignments, resource floor, concurrency, input guards, no public route, and forgotten-version invalidation.
- [x] Observed RED missing module; implemented parameterized single SQL `UPDATE ... EXISTS` with current session/User/Role identity and authority versions. Observed 2 new RED tests for grant/status reenable without writer version bump, then added synthetic D1 triggers.
- [x] Dedicated real Workerd/D1 synthetic suite GREEN 13/13.

## Task 2 — CI and boundary
- [x] Separate fake D1/Worker fixture with UUID ending 0006, no routes and no production schema.
- [x] Imported suite through existing `tests/integration/m03-workerd.spec.mjs` PR-only local D1 workflow; no workflow edits.
- [x] Documented prevented TOCTOU for one synthetic mutation, automatic generation invalidation, and residual multi-statement financial posting risks.

## Task 3 — completion
- [x] Fresh `npm test` 229/229, real Worker/D1 63/63 (including 13 synthetic atomic authorization cases), 84 pinned sources, frontend build, 47-source M03 caller audit, JS syntax and diff checks green.
- [ ] Push focused PR; require all 5 GitHub checks and exact-head Cloudflare Preview (HTTP 200 DB-free) before squash merge.
