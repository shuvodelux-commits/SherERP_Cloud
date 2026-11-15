# M03/M04 — Role-Based Settings Edit in the Same D1 Mutation

**Date:** 2026-11-15. **Source:** Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Status:** Internal, test-only M04 auth schema compatibility. No public RPC.

## Current state and problem

Merged #94 introduced `createM04AuthorizedShellSettingsUpdateAdapter`: existing Shop Name / Currency Symbol compare-and-set with a live Administrator session check in the same D1 UPDATE. It deliberately denies custom staff roles. The frozen `Auth.gs:hasPermission_` permits an active custom role when its `Permissions` JSON has a truthy `settings.edit` grant; `Settings.gs:updateSettings` calls `requirePermission_(token, 'settings', 'edit')`. The M04 proposed `auth_roles` table stores validated `permissions_json`, `status`, and a trigger-owned `auth_version` invalidating old sessions.

## Decision

Extend the single preimage-checked `UPDATE settings ... AND EXISTS(...)` to permit **either** a current built-in Administrator session (unchanged) **or** an active custom role whose `role_name` matches current user assignment, `r.auth_version=s.role_auth_version`, and whose `permissions_json` contains a genuine JSON boolean `true` at `$.settings.edit`. Use the M04 schema's `LEFT JOIN auth_roles`; a missing or inactive role, role change or authority-version mismatch denies. Do not treat `allowed_modules` as authorization: frozen GAS reads the permission map directly, and M04 marks Allowed Modules as UI metadata.

Validate `json_valid` before invoking `json_type` in a CASE to fail closed on malformed JSON without turning an authorized update into a D1 exception. Only accept JSON object `settings` and literal boolean true, **not numeric 1, string "true" or an array**; this is a security-hardening subset of source truthiness and matches M04's roleMetadata boolean validation. Limit `permissions_json` length to M04's 65,536 character ceiling. The SQL boundary must also validate the role epoch under the same statement. No JS preflight or extra D1 SELECT.

**Interface stays unchanged:** `updateExisting_({token,nowMs,key,newValue,expectedValue})`; no new client-supplied actor or permissions. Existing key allowlist and sanitizeInput_ trim, valid clock, idle+absolute expiration, user auth_version/credential_version, modern credential guard and generic denied/stale refusal stay unchanged.

## Scope and test gates

- **Files:** modify only `src/db/m04-settings-update.js`, `tests/m03-m04-settings-auth.test.mjs`, `tests/integration/m03-m04-settings-workerd.spec.mjs`, add this spec and scoped plan and a short updated contract documentation note.
- **RED:** replace the obsolete "custom staff always denied" assertions with permitted active role-grant behavior and add negative tests for inactive/missing/false/malformed/typed JSON and stale session epoch; commit tests and show GitHub CI failure due the old Administrator-only filter (not missing package/import).
- **GREEN:** minimally change the ONE SQL UPDATE with bound values. Verify all Node + real D1 integration through normal GitHub Actions, source/preview, M04 login, Chromium and Party checks. The Worker test fixture remains a 404-only route.
- **Epoch/integrity:** role grant revocation and restoration must invalidate original custom-role session, even if the same permission returns. A separate newly issued session may regain access only when M04 auth is valid. Users disabled/re-enabled or reassigned must not regain old authorization. Stale values and concurrent edits continue to be CAS guarded; no private Settings keys or new rows.
- **Limits:** This is a narrowly tested SQL policy, not approval for production `settings.edit`: M04 complete role JSON structure validation/import, tenant ownership (current auth_sessions lacks tenant ID), actual RPC transport and data migration remain gated. No `migrations/**`, no `src/rpc/**`, no frontend, no deployed Worker, no production/staging D1 writes. `PARALLEL-MODULE-READY=false`.

## Alternative rejected

A JS `validateSessionWithD1` / `hasPermission` before calling #85's unguarded CAS would have a revocation/role-change TOCTOU race. Converting roles to a new authorization table is premature schema work. A static SQL predicate over the existing proposed auth_roles schema is the smallest viable testable step.
