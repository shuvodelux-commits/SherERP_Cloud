# M04 — Preserve role authority epochs against role REPLACE and assigned-role deletion

**Date:** 2026-11-15. **Owner:** M04 (isolated local authentication fixture). **Pinned original:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/RoleManagement.gs#deleteRole`, `Auth.gs`. Read `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, `docs/M04_AUTH_SOURCE_CONTRACT.md`. No production staff/role mutation.

## Security bug to reproduce

Merged M04 #137 prevents `INSERT OR REPLACE` takeover of **auth_users**, but SQLite can separately REPLACE a row in `auth_roles` by primary key `role_name`. If a new row resets `auth_version` to its default 1, a previously issued session with `role_auth_version=1` could remain authorized after permissions change. A raw DELETE of a role currently assigned to staff followed by fresh INSERT can likewise resurrect role version 1 and a stale session. Frozen `RoleManagement.gs#deleteRole` explicitly forbids deleting in-use roles. A JS-only policy/preflight cannot make these SQL authority invariants atomic.

## Test-first tasks

1. **RED:** append real local Cloudflare Workerd/D1 tests to `tests/integration/m04-auth-authority-version-workerd.spec.mjs`: (a) seed synthetic `ReplaceGuard` role and staff, log in to obtain a live role-version-1 token, prove `INSERT OR REPLACE INTO auth_roles` with changed permissions is rejected, leaves stored version/permissions unchanged, and leaves the token valid; (b) seed `AssignedGuard` and staff, prove raw DELETE of an assigned role is rejected, token stays valid, and deletion of an **unassigned** role still works. Restore test state in `finally` if red allows unsafe mutation. Record actual GitHub M04 Workerd CI RED failures. Do not change implementation before demonstrated RED.
2. **GREEN:** add the smallest two SQL triggers **only in** `tests/fixtures/m04-auth-migrations/0001_auth_core.sql`: `BEFORE INSERT ON auth_roles` abort when `role_name` already exists (blocks REPLACE) and `BEFORE DELETE ON auth_roles` abort when any `auth_users` row references `OLD.role_name` (including inactive staff). Preserve ordinary new role creation, deletion of unassigned roles, existing role UPDATE authority epoch increments, and source-faithful role mutations.
3. Re-run all GitHub PR Workerd M04/D1, Foundation Node/source, M03, M02, Chromium and Cloudflare preview safety workflows; inspect full logs and exact diff. Never update shared `migrations/` or `src/db/`.

## Acceptance and risk

Role name/version may not be reset while bound to a historical session; current RBAC cannot be bypassed by REPLACE; deleting assigned role is forbidden; unrelated unassigned role deletion remains possible. Both test cases fail for the intended reason before SQL and pass after. No auth role RPC activation, no real import/export, original GAS/HTML, Cloudflare config, secrets, production/staging D1 binding, permissions loosening, or financial data touched.

**Files:** plan, existing M04 real Workerd/D1 authority-version regression test, M04 **test-only** auth SQL fixture. No workflow edit needed: existing PR-only `m04-auth-workerd.yml` includes that regression file. Any real schema migration must be reviewed and promoted exclusively by M03 after approved backup/cutover/first-admin/permissions gates. Public login remains HTTP 503; other staff RPC HTTP 501. The test fixture and this plan are not an approval to deploy public authentication.
