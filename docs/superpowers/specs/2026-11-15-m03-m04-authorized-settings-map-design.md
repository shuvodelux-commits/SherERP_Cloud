# M03/M04 — Source-Faithful Session-Authorized Settings Map Read

**Date:** 2026-11-15. **Workstream:** M03 D1 repository with M04 proposed auth dependency. **Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Base:** `main@9f7c744`. **State:** Internal only, nondeployable.

## Why

Frozen `legacy/source/Settings.gs:getSettingsBootstrap(token)` calls `requirePermission_(token,'settings','view')` and then `getSettingsMap_()`, which returns all Settings sheet key/value pairs without applying fallback defaults; it separately returns active Bank Accounts. The M03 `settings-read.js:getSettingsMap_()` already models that raw map but has **no** auth guard. The merged M03/M04 #114 adapter enforces current `settings.view` on a safe two-key shell projection. A full Settings page bootstrap cannot safely call the unguarded map after a separate JavaScript permission preflight (TOCTOU revocation window).

## One narrow choice

Add a second **internal** method `getSettingsMap_({token,nowMs})` to `createM04AuthorizedShellSettingsReadAdapter(env)`. Retain existing shell method byte-compatible. Move its already-reviewed session/role CTE to one shared static SQL constant, then use it for two **fixed** statements: shell projection and complete Settings map. No new auth model, import, dependency, public route, SQL schema, or caller-selected identifiers.

Map statement selects `settings.key,value` only via `WITH authorized AS (current M04 session/role/JSON boolean settings.view) SELECT ... FROM authorized LEFT JOIN settings ... ORDER BY row_id ASC LIMIT 257`. **Zero rows = denied**, **one null/null sentinel row = authorized empty map**. Up to **256** real rows return a null-prototype JS object with all actual Settings key/value string text as stored, including sensitive values. Row 257 = `NEEDS_REVIEW`; do not silently truncate. Reject invalid/duplicate/blank or JS-prototype-sensitive keys (`__proto__`, `constructor`, `prototype`), nonstring text, null sentinel mixed with actual rows, driver errors, and malformed D1 response. Never supply fallback/default keys in the raw map. No cache and no heartbeat. Reuse the existing strict `token,nowMs` input contract with decoded bearer digest and server-owned clock.

**Security:** A complete raw Settings map contains confidential contact fields and `Delete Confirmation Key` in the original app. It is accessible only to a valid, current `settings.view` staff/admin D1 session, **inside the same query**; it must not be exposed to public preview, unauthenticated shell readers or any browser route without a separate M04 RPC envelope/security review. Source-faithful `settings.view` intentionally grants the whole Settings map; do not invent hidden filtering that would break Settings page parity. Existing shell method remains a safe public-information projection but still requires auth.

**Out of scope:** No Bank Accounts dropdown, full `getSettingsBootstrap` RPC, bulk Settings writes, persistent production M04 auth schema, shared-tenant D1 (auth_sessions lacks tenant ID), user-facing UI, D1 migration, production/preview binding or bank/finance data. `PARALLEL-MODULE-READY=false`.

## Acceptance

1. Admin and current view-only role receive exactly original raw Settings values including leading phone zero, unicode, false-text and confidential key in a null-prototype map. Edit-only role denied. Shell projection remains exactly two keys and never contains private values.
2. Current M04 role/session authority and Settings rows read in **one SQL statement**; role revoke/restore, idle/absolute expiry and credential epoch invalidation deny old sessions.
3. Source-exact 0, 256 and 257 Settings row boundaries; invalid/prototype/duplicate/unsafe key and malformed driver output fail closed.
4. Test-only Node SQLite + real Cloudflare Workerd/D1 use unchanged M02 `settings` and M04 auth fixture. Real M04 PBKDF2-issued token already covered by existing suite; extend integration for full map on same fixture. 404-only Worker remains unreachable for RPC.
5. All CI source integrity, M04 auth, staging safety, Party, Chromium, Workerd and Cloudflare preview checks green. No deployed schema, original 84 GAS/UI source, auth cutover or finance modification.
