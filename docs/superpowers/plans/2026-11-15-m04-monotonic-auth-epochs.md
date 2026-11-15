# M04 — Monotonic staff authorization epoch safety (stacked on #157)

**Date:** 2026-11-15. **Workstream:** M04 internal authentication test fixture only. **Depends on:** draft PR #157 (SQL role replacement/assigned-delete guard). This branch is based on `m04/d1-role-epoch-replace-currentmain-20261115`, not current `main`; merge order is mandatory. See `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, `docs/M04_AUTH_SOURCE_CONTRACT.md`, and immutable `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` Auth.gs/RoleManagement.gs/UserManagement.gs.

## Specific threat and constraints

An M04 opaque session stores `user_auth_version`, `role_auth_version` (custom roles) and `credential_version`. Existing SQL triggers increase user/role auth versions when authority changes. However direct SQL `UPDATE ... SET auth_version=<old snapshot>` or `credential_version=<old snapshot>` could move counters backward and resurrect a revoked token once other conditions are restored. D1 auth is not public; this is an internal schema safety contract for future M03-owner promotion. Privileged access to a database cannot be fully isolated by triggers: this work specifically prevents accidental/rogue **counter rollback**, not every privileged write.

## Superpowers TDD steps

1. RED: add real local Workerd/D1 regression cases to the existing `tests/integration/m04-auth-authority-version-workerd.spec.mjs` (already in PR-only M04 CI). Use synthetic fresh staff identities and a role. Issue real token, change permission/disable-and-reactivate account, then try direct lowering of `auth_roles.auth_version` and `auth_users.auth_version`. These must reject at SQL boundary, leave current higher version intact, and leave old token denied. Separately increase `credential_version` (simulating credential rotation); attempts to lower it must reject. Positive legitimate higher-version changes continue to work. Ensure RED run fails on the expected two/three `assert.rejects` checks.
2. GREEN: in **only the nondeployable** `tests/fixtures/m04-auth-migrations/0001_auth_core.sql`, add minimal `BEFORE UPDATE OF auth_version` triggers on `auth_users` and `auth_roles`, and `BEFORE UPDATE OF credential_version` trigger on `auth_users`, which reject `NEW < OLD`. Do not prevent legitimate trigger-owned monotonic increments or normal credential upgrade. No runtime code, migrations or DB repo changes.
3. Run fresh GitHub Actions M04 real Workerd D1, Foundation source tests, M03, M02, original M01 Chromium and Cloudflare preview safety. Capture RED/GREEN log totals and unexpected failures. Keep draft pending review.

## Acceptance

Direct version rollbacks cannot resurrect old sessions, version increments still invalidate old sessions, valid new logins still work, unrelated admin/role updates unaffected. Schema is local **test fixture only**. Changed files: this plan, existing Workerd authority-version tests, existing test-only M04 SQL. `src/db/**`, `migrations/**`, `src/index.js`, `src/rpc/**`, Cloudflare bindings and secret stores, user import/export, original UI/source, financial/Party kernel are **not** touched. Public login remains HTTP 503, protected staff RPC HTTP 501. M03 exclusive schema owner must review any promotion independently; no user-approved production cutover is implied.
