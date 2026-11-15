# M04 — Invalidate existing D1 staff sessions after identity-profile update

**Date:** 2026-11-15. **Depends on:** unmerged draft PR #157 (`m04/d1-role-epoch-replace-currentmain-20261115`); this is a stacked branch. **Source of behavior:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/UserManagement.gs` `updateUser`, which writes `Full Name`, `Mobile Number`, `Role` and calls `bumpAuthCacheGeneration_()`. Read current `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, `docs/M04_AUTH_SOURCE_CONTRACT.md` and the owner-approved Party ADR. Staff authorization is independent of Unified Party roles.

## Security behavior to preserve

Internal M04 `auth_sessions.user_auth_version` is checked on each server-backed session restore. The *test-only* D1 `trg_auth_user_version` currently increments on status/role/password/credential changes, but not `auth_users.phone_key` or `full_name`. Consequently an old bearer may outlive a staff phone change (sensitive login identity rotation), or continue to expose new staff profile data after an owner-authorized user update. We must not depend on stale JS preflight or best-effort session cache eviction.

## Test-first implementation

1. **RED:** in the existing `tests/integration/m04-auth-authority-version-workerd.spec.mjs`, add two synthetic independent real Workerd+D1 cases. Issue real opaque bearer, update `auth_users.phone_key`, then show old token is rejected, new phone works and old phone does not. Separately update `auth_users.full_name`, then show old token is rejected and re-login obtains new name. Check auth_version increments exactly once for each changed identity field, while a no-op profile update does not spuriously increment. Commit tests before SQL.
2. Run actual GitHub Actions M04 Workerd/D1 CI against RED; record expected failing test names and job/log evidence. Do not claim a failure if tests are merely queued or unrelated jobs fail.
3. **GREEN:** minimally extend only the existing `AFTER UPDATE OF ... ON auth_users` trigger column list and `WHEN` predicate in the **nondeployable local auth SQL fixture** `tests/fixtures/m04-auth-migrations/0001_auth_core.sql` to include `phone_key` and `full_name`. Retain previous auth counter monotonicity, role replacement and last Administrator constraints from PR #157. Do not create a second invalidation engine.
4. Verify GitHub M04 real Workerd+D1, Foundation source tests, preview safety, M01 Chromium, M02 and M03 local Workerd/D1. Review exactly the changed files and document RED/GREEN.

## Scope and release gates

Only three files: this plan, `tests/integration/m04-auth-authority-version-workerd.spec.mjs`, and M04 **test-only** `tests/fixtures/m04-auth-migrations/0001_auth_core.sql`. No live user or Party data, `migrations/`, `src/db/`, public Worker `src/index.js` or `src/rpc/`, frontend, Cloudflare bindings, sensitive credentials, or production/staging D1 reads/writes. M03 has exclusive schema promotion authority. Public login stays HTTP 503; unimplemented staff RPC stays 501. This regression does not implement updateUser authorization; any eventual staff mutation must prove live actor RBAC and SQL-level CAS independently. PR #157 must merge into main before this stacked PR is retargeted.
