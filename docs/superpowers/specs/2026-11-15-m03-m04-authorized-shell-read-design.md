# M03/M04 — Session-Authorized Shell Settings Read Design

**Date:** 2026-11-15. **Owner:** M03 internal D1 repository. **Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Status:** Nondeployable M04 schema compatibility; no public route.

## Problem / source contract

The preserved `Settings.gs:getSettingsBootstrap(token)` requires `requirePermission_(token,'settings','view')` before retrieving Settings, and frozen `Auth.gs:hasPermission_` allows the built-in Administrator or a current active custom role with `settings.view`. M03's `src/db/settings-read.js` already has a **private-safe shell** projection `{shopName,currencySymbol}`, but `getAppShellSettings_()` is deliberately not authenticated. PR #105's same-SQL `settings.edit` check must not be misused as permission to read: a staff role may have view without edit or edit without view.

## Approved design for isolated internal proof

New internal `src/db/m04-settings-view.js` exports `createM04AuthorizedShellSettingsReadAdapter(env).getAppShellSettings_({token,nowMs})`.

- The only request fields are `token` (lowercase 64-hex random M04 bearer) and `nowMs` (trusted Worker clock). Exactly two **own data** properties; reject extras, accessors, invalid values. Hash decoded token bytes with Web Crypto SHA-256 exactly like M04 `d1-auth-core.js`.
- Use **one** parameterized D1 `SELECT`: an authorization CTE joins `auth_sessions`, `auth_users`, and left joins `auth_roles`. It checks nonrevocation, creation/idle/absolute expiry, Modern credentials, active user, current user/credential epochs, and either intrinsic Administrator with null role epoch or custom role with matching current role auth_version, active status and strict JSON boolean true at `$.settings.view`. Fail closed on malformed role JSON, missing role, nonboolean truthiness, disabled or reassigned user. `allowed_modules` is display metadata, not permission.
- The read projection LEFT JOINs **only** `settings.key IN ('Shop Name','Currency Symbol')` to the authorized CTE. Zero rows => generic Denied (no permission disclosure), one row with both columns null => authorized but no keys (source fallback), 1–2 actual shell rows => return `{shopName,currencySymbol}`. Use `Shop Name || 'Hardware Store ERP'` fallback only for an empty string or missing key, preserving whitespace if nonempty; Currency Symbol defaults to empty string.
- No full Settings map, bank account information, phone/email, key enumeration, session mutation/heartbeat, extra D1 query or cross-request cache. The operation is a point-in-time read snapshot and cannot authorize any later write; #105 remains the atomic `settings.edit` path.
- **Tenancy constraint:** M04's current auth sessions have no tenant ID, so this is valid only in a single-business isolated D1. Do not import into deployable Worker or production/shared-tenant schema.

## Evidence / exclusions
Node `node:sqlite` TDD RED/GREEN using unchanged real M02 and M04 proposed DDL, and real local Cloudflare Workerd/D1 integration using isolated fake UUID. Tests: Administrator, view-only staff, edit-only staff denied, role epoch revoked/regrant/fresh session, expired idle/revoked, malformed grants and D1 results, missing key fallback, Bangla and private key omission, real PBKDF2 login bearer, no public route. Full GitHub CI source, M04 login, Party, browser, preview.

No changes to production `src/index.js`, `src/rpc/**`, `migrations/**`, original GAS/UI or Cloudflare binding. `PARALLEL-MODULE-READY=false`. Alternative rejected: calling unauthorized `getAppShellSettings_()` after a JS `validateSessionWithD1` permission preflight would race role invalidation.
