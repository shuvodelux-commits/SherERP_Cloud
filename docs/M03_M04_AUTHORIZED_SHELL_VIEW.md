# M03/M04 — Session-Authorized Safe Shell Settings Read

**Status:** Internal, read-only **M04 schema compatibility contract**; neither a public Settings RPC nor an approved production authentication/data migration.

**Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Spec and plan:** `docs/superpowers/specs/2026-11-15-m03-m04-authorized-shell-read-design.md` and `docs/superpowers/plans/2026-11-15-m03-m04-authorized-shell-read.md`.

## Why this is necessary

Frozen `legacy/source/Settings.gs:getSettingsBootstrap(token)` requires `requirePermission_(token,'settings','view')`. Original `Auth.gs:hasPermission_` allows Administrator or an active custom role with a Settings `view` grant. The existing M03 `settings-read.js:getAppShellSettings_()` deliberately returns only `Shop Name` and `Currency Symbol`, but **does not authenticate the reader**, because it is an internal repository projection. M03/M04 PRs #94 and #105 enforce `settings.edit` on a narrow existing Settings write; **edit authority never implies view authority**.

This PR adds a **separate, strictly two-field safe shell read** and its current-session authorization in the *same* D1 query, not a JS permission preflight followed by an unguarded Settings read. It does not expose the full map returned by the original GAS Settings bootstrap or the original Bank Accounts dropdown, which still need independent reviewed migration.

## API (trusted server only)

```js
import {createM04AuthorizedShellSettingsReadAdapter}
  from './src/db/m04-settings-view.js';

const shell=await createM04AuthorizedShellSettingsReadAdapter(env)
  .getAppShellSettings_({
    token:'<64 lowercase hexadecimal M04 opaque bearer>',
    nowMs:1800000000000 // must be server-owned time
  });
// {shopName:'নবাবী হার্ডওয়্যার',currencySymbol:'৳'}
```

The function takes **exactly two own-value fields** and rejects actor/tenant/role/SQL/key names supplied by request. The raw 32-byte M04 session token is SHA-256 digested as decoded hexadecimal bytes (not as UTF-8 token text), matching M04 `d1-auth-core.js`. No logged token, no new dependency, no cache and no session heartbeat.

## One-statement SQL authority and data projection

A fixed parameterized D1 `WITH authorized AS (...) SELECT`:
- Checks the stored token digest, nonrevocation, `created_at_ms<=nowMs`, absolute `expires_at_ms>nowMs`, 30-minute idle expiry and last activity not in the future.
- Requires active user, Modern credential state, matching user `auth_version` and `credential_version`.
- Grants built-in Administrator with null role snapshot, or active, currently assigned custom role with **matching current M04 role `auth_version`** and strict valid JSON **boolean true** at `$.settings.view`; `allowed_modules` remains display metadata. Other/no permission, wrong-type grant, malformed JSON, inactive role, role reassignment, stale epoch, expired or revoked session get generic `Denied`. Role disable/re-enable or permission revoke/restore cannot resurrect old sessions.
- LEFT JOINs **only** `settings.key IN ('Shop Name','Currency Symbol')`, never the private Settings map. If a valid caller has no shell rows, a single (null,null) row proves authorization, then returns source-shaped fallback. If there are zero result rows, authority is absent and the adapter denies. Any unexpected, duplicated, non-string or extra key fails as `NEEDS_REVIEW`.
- Returns `{shopName,currencySymbol}` with original M03 fallbacks: missing/empty Shop Name → `Hardware Store ERP`, blank/missing Currency Symbol → `''`; a nonempty whitespace-only name remains whitespace as the source currently does.
- This is a point-in-time read and **does not authorize subsequent writes**. Only the independent #105 write contract checks `settings.edit` in its own SQL mutation.

## Evidence and isolated tests

- **RED:** Node test file `tests/m03-m04-settings-view.test.mjs`, local D1 Workerd integration `tests/integration/m03-m04-settings-view-workerd.spec.mjs`, dummy-UUID `wrangler.m03-m04-settings-view-test.jsonc` and one shared M03 import committed **before runtime implementation**, final RED head `7cecdf4`. GitHub Actions failed on the expected `ERR_MODULE_NOT_FOUND: src/db/m04-settings-view.js` while prior functionality compiled.
- **GREEN:** `src/db/m04-settings-view.js` introduced in `db9b527`. Node SQLite tests use both the **existing real M02 Settings migration** and unchanged M04 **test-only proposed auth schema**, and cover view-only vs edit-only roles, normal Administrator, explicit missing-row fallback, corrupted stored result and private-key denial.
- The actual local Cloudflare Workerd/D1 test harness applies **unchanged M04 fixture migrations**, extracts/applies the exact `settings` table definition from reviewed M02 SQL, and verifies a real M04 PBKDF2 login token, session revocation, permission epoch changes, read-only safe projections and test Worker routing all returning HTTP 404.
- During RED/GREEN CI, M04 PR #106's role-epoch triggers exposed earlier navigation-metadata test assumptions. Temporary branch-only fixture corrections fixed that first, and PR #117 subsequently merged **stronger, source-faithful session-epoch regression tests** into main. This merge deliberately preserves PR #117's Node/Workerd Settings mutation tests **unchanged**, rather than overwriting them with temporary fixes. The local M04 schema and runtime authority triggers remain unchanged. The final merge-head must be tested again.
- Full Node/real D1/staging/Party/source/Chromium/Workers Preview pass/fail counts are recorded by GitHub PR Actions; verify the **final head commit** rather than extrapolating from partial intermediate runs.

## Strict safety / non-goals

No `src/index.js`, `src/rpc/**`, `migrations/**`, original GAS/HTML, frontend layout, actual auth tables, Cloudflare deployed bindings, production credentials or real finance data are touched. This project stage still uses an **isolated single-business D1** for the M04 auth proposal; its `auth_sessions` has **no tenant_id**, so these checks are not safe for a shared multitenant D1. There is no production cutover, no explicit Settings page activation and no private Settings permission expansion. To roll back, revert this PR; no live database recovery is necessary.

**PARALLEL-MODULE-READY=false.** M04 production schema, staff-role import validation, actual `settings.view` RPC envelope, full bootstrap/bank-account provenance and owner-approved staging/cutover remain separate gates.
