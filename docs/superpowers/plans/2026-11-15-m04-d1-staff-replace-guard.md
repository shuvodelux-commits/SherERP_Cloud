# M04 — Prevent staff identity replacement from bypassing last-Administrator SQL protection

**Date:** 2026-11-15. **Owner:** M04 local authentication fixture, not M03 production migrations. Pinned legacy `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `UserManagement.gs` requires that the last active Administrator cannot be deleted, demoted or deactivated. Read `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/M04_AUTH_SOURCE_CONTRACT.md`, and merged M04 guard PR #131.

## Specific security hypothesis

The M04 **test-only** SQL fixture `tests/fixtures/m04-auth-migrations/0001_auth_core.sql` has last-admin BEFORE DELETE/UPDATE triggers and authority-version triggers. In SQLite, `INSERT OR REPLACE` may delete and replace a conflicting row without firing ordinary DELETE triggers when recursive trigger execution is disabled. The result could be removal of the only active Administrator or recreation of existing staff identity under a new role without the intended SQL guarantee. There must be no unsafe REPLACE-based bypass, regardless of whether the source is an importer or future staff management.

## TDD tasks

1. **RED:** add real local Workerd/D1 regression in a standalone `tests/integration/m04-admin-identity-replacement-workerd.spec.mjs`, using a freshly migrated synthetic local D1 with exactly one active Administrator. Attempt `INSERT OR REPLACE INTO auth_users ... SELECT ...` to change that user's role to Cashier, verifying the statement is denied and the original active Administrator preserved. Also attempt new user ID with the existing staff phone (unique-key alias), verifying neither can replace an existing staff identity; new unique staff insertion still works. Assert no credential material or personal data enters failure output. Include a concurrent two-admin deactivation test that must never leave zero active admins. Record actual GitHub M04 workflow RED failure before SQL change.
2. **GREEN:** add a minimal `BEFORE INSERT ON auth_users` local fixture SQL trigger, rejecting any new row whose `user_id` **or** `phone_key` already exists in `auth_users`. Normal duplicate `INSERT` already fails on UNIQUE; this closes only the `OR REPLACE` bypass at INSERT time. Preserve valid first admin/second staff creation and all existing auth version/last-admin triggers. No other D1 triggers or production SQL changes.
3. Add the one new M04 Workerd regression file to the existing PR-only M04 workflow test list, run new GitHub Workerd/D1 suite, all Foundation Node/source, M03, M02, Chromium and preview checks. Record RED/GREEN jobs and verify diff scope.

## Boundary and acceptance

Exactly this plan, **new M04 Workerd/D1 integration test**, **test-only** M04 SQL fixture and **PR-only M04 test workflow**; no `migrations/`, `src/db/`, `src/index.js`, `src/rpc/`, authenticating production Worker code, original frontend/GAS, real staff data, Cloudflare D1 or secrets. No remote D1 writes, no live staff management and no public login. The local SQL proposal requires separate exclusive M03 owner review and promotion before any protected staging rollout.

Acceptance: last active Administrator survives attempted ID or phone-based replacement and two competing deactivations; old users retained; unrelated new staff insert works; all GitHub checks green. This test demonstrates SQL invariants only and does **not** authorize an actor or implement user mutation RPC. Public `login` remains HTTP 503; staff APIs HTTP 501.
