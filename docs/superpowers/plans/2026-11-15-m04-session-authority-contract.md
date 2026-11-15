# M04 synthetic D1 session authority contract — TDD plan

> **For agentic workers:** Follow Superpowers TDD, isolated worktree and verification-before-completion.

**Goal:** Verify revocable, expiry-bound opaque token **digest** storage and immediate active user/role revalidation in real local Workerd/D1 without enabling auth.

**Architecture:** One test-only D1 Worker config; synthetic strict DDL created at test time, internal `tests/fixtures/m04-session-repository.mjs`, Workerd suite; import suite through existing M03 test-runner CI entry.

## Task 1 — RED/GREEN integration
- [x] Wrote nine real Workerd/D1 tests covering issue/resolve, revoke/repeat, expiry, disabled and re-enabled users/roles, role reassignment, duplicate digest/unknown user, invalid shape and no Worker route.
- [x] Observed expected RED: missing module before implementation.
- [x] Implemented minimal bound D1 statements with malformed-result refusal and UNIQUE digest constraint.
- [x] GREEN: dedicated real D1 suite 9/9; no production authentication claim.

## Task 2 — integrate safely
- [x] Imported from existing `tests/integration/m03-workerd.spec.mjs` for PR-only local D1 CI without workflow edits.
- [x] Documented original source mapping, version invalidation, finite expiry and authorization race caveats in `docs/M04_D1_SESSION_PREFLIGHT.md`.
- [x] Original source, migrations, deployed Workers, public RPC, Cloudflare config and other workstream code unchanged.

## Task 3 — verify/review/merge
- [x] Fresh local verification: 207/207 Node tests, 42/42 real Workerd/D1 tests, 84 pinned source files, frontend build, 47-source M03 audit, syntax and diff checks all green.
- [ ] Push PR, require five GitHub Actions green + exact-head Cloudflare Preview deployment successful and DB-free.
