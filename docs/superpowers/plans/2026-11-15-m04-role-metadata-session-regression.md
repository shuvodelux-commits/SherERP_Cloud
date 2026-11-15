# M04 regression reconciliation: role-display metadata rotates session authority

## Cause verified from GitHub CI
After merged PR #106, the synthetic M04 D1 fixture's `trg_auth_role_version` trigger increments `auth_roles.auth_version` when `allowed_modules` changes. This intentionally invalidates previously issued sessions. The older `tests/m03-m04-settings-auth.test.mjs` custom-role test updated `allowed_modules` but then expected its old session epoch to authorize a Settings CAS write.

A later GitHub Actions Node test run on PR #113 reported one failure: `active custom role with literal settings.edit true can CAS...` with `Denied or stale Settings precondition`. This is correct fail-closed behavior, not an application defect.

## Minimal test-only correction
- Preserve source distinction: `Allowed Modules` is UI display metadata, never an authorization grant; `permissions_json.settings.edit===true` remains the backend's authority.
- Assert the **old token is denied immediately** after metadata update, and no Settings rows change.
- Issue a **new synthetic session with current DB role auth_version** and the same verified JSON grant; assert one authorized Settings CAS succeeds.
- Preserve the concurrent/negative test suite; do not alter the tested M04 SQL guard, D1 schema/trigger, production Worker, RPC, source or any financial posting.

## Superpowers evidence
The already observed failing GitHub Actions test is RED. This branch updates only the stale test to match the newly reviewed security contract. Require complete green GitHub Actions, exact-head Cloudflare Preview success and DB-free HTTP 200 before merge. No remote PC or live data.
