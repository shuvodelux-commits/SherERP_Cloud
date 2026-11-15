# M03/M04 — Atomic Administrator-Authorized Shell Settings CAS

**Date:** 2026-11-15. **Owner:** M03 `src/db` integration only, M04 schema dependency.
**Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Base:** `main@071ee378`, including merged M03 #85 and M04 #88.
**Status:** Internal experimental compatibility contract; no public Settings editing or deployed M04 schema.

## Contract and security decision

PR #85's `createGuardedShellSettingsUpdateAdapter` is a correct SQL compare-and-set helper for two existing low-risk Settings keys, but has **no authentication**. A separate JS permission preflight would race a session revocation or staff-role change before the D1 UPDATE. The next M03 step adds *one SQL UPDATE* whose WHERE predicate checks both the value preimage and the **current M04 session**.

New internal `src/db/m04-settings-update.js` exposes `createM04AuthorizedShellSettingsUpdateAdapter(env).updateExisting_({token,nowMs,key,newValue,expectedValue})`. The token is an M04 raw 64-hex opaque session secret; digest the **decoded 32 bytes** with SHA-256 as in `src/auth/d1-auth-core.js`. `nowMs` must come from a trusted Worker clock, never browser input; there is **no HTTP route** and no UI change. Exact five own-property keys, no accessors or additional actor/role/SQL fields. Only Shop Name and Currency Symbol are writable; preserve source trim behavior (new text only), Shop Name nonempty, no creates/deletes, no private Settings.

The static UPDATE statement must include `WHERE settings.key=? AND settings.value=? AND EXISTS(SELECT 1 FROM auth_sessions s JOIN auth_users u ...)`, checking the session digest, no revocation, `created_at_ms<=nowMs`, absolute expiration `>nowMs`, activity `> nowMs-30min` and `<=nowMs`, active user and matching session `user_auth_version` and `credential_version`, `credential_state='Modern'`, built-in `Administrator` and NULL `role_auth_version`. All permission checks are in the same SQLite write, not a separate JS read. **Deny all custom staff roles**, even if they have settings permissions, pending reviewed source-faithful M04 role map. No claim of final `settings.edit` RBAC. For revocation/stale/missing, return a generic refusal with no information about which condition failed; malformed or uncertain D1 outcomes => `NEEDS_REVIEW`. Existing `src/db/settings-update.js` remains unchanged.

**Schema limitation:** M04 `auth_sessions` has no tenant id; only intended for **one business per isolated D1**, never a shared tenant database. Use the **unchanged, test-only** M04 migration fixture from `tests/fixtures/m04-auth-migrations/0001_auth_core.sql` together with the **actual M02** `migrations/0001_core_catalog.sql` in local SQLite/D1 tests. Do not add `migrations/**`, production/staging D1 bindings, `src/rpc/**`, `src/index.js`, or any real staff or financial records.

## Superpowers TDD steps

1. Read current `AGENTS.md`, migration plan, ADR-007, `src/auth/d1-auth-core.js`, M04 D1 fixture and merged #85.
2. Commit this plan on isolated GitHub branch.
3. RED: commit `tests/m03-m04-settings-auth.test.mjs` using actual `node:sqlite` migrations, plus a new real Workerd/D1 integration suite `tests/integration/m03-m04-settings-workerd.spec.mjs`, local-only fixture Worker/JSONC, one import in `tests/integration/m03-workerd.spec.mjs`. Open draft PR and **capture CI failure** on missing adapter.
4. GREEN: implement smallest internal adapter `src/db/m04-settings-update.js`. Validate exact input before D1; compute SHA-256 token digest; one fixed bound SQL UPDATE with current M04 authority and preimage in the WHERE clause. Reject missing/stale/disabled/expired/role-changed/credential-changed with no writes. Never create keys. Rerun PR CI and repair only test-confirmed errors.
5. Verify TDD red/green with GitHub CI logs, Node regressions, actual workerd D1, source checksum, original frontend build, Party checks, Chromium desktop/mobile/A4 and Cloudflare Preview. Document precise boundaries in `docs/M03_M04_AUTHORIZED_SETTINGS_CAS.md`.
6. Keep PR isolated for owner review. Only M04 owner may authorize later production migration/permission mapping; `PARALLEL-MODULE-READY=false`.

## Negative boundaries

- No bulk Settings or invoice-logo update; no Cash/Bank/Party/stock write.
- Never expose a raw bearer to logs, URL parameters or a public test Worker; test-only routes are 404.
- Caller cannot impersonate an actor or infer whether a particular key exists from unauthorized results.
- No automatic retries after an uncertain DB response.
- No direct commits to main, no Remote Desktop Commander for routine GitHub work.
