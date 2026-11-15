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

## PR #130 — full Settings map under the same M04 `settings.view` snapshot

The original `Settings.gs:getSettingsBootstrap` calls `requirePermission_(token,'settings','view')` before `getSettingsMap_()`. PR #114 provided only the two-key *shell* projection; the original full Settings map still lacked a role-authorized D1 read. This PR adds `getSettingsMap_({token,nowMs})` to the same internal `createM04AuthorizedShellSettingsReadAdapter`. It shares the existing M04 session/role authorization CTE but executes **one fixed parameterized SELECT per call**, with no separate JS authorization preflight and no extra SQL query. The two-key shell method and its output are unchanged.

An authorized full-map read returns all original raw `settings.key,value` strings in a **null-prototype object**. No missing keys, defaults, coerced booleans, or new Settings rows are synthesized. It uses an authorized-row sentinel to distinguish a valid empty Settings table from an invalid/expired/revoked session. Exact source-audited **256 Settings rows maximum**; fetch 257 and fail with `NEEDS_REVIEW` rather than silently truncate. Reject missing/malformed/badly typed rows, duplicate keys, and prototype-sensitive `__proto__`, `constructor`, or `prototype` keys. The unchanged M02 SQLite schema itself prevents empty/whitespace-only keys.

**Confidentiality gate:** By original source semantics, `settings.view` grants the **entire Settings map**, including contact information, invoice logo and `Delete Confirmation Key`. Those values are only returned to an *internal* D1 caller with a current trusted M04 `settings.view` permission in the very same statement. They must **never** be exposed via the existing unauthenticated shell, public Worker Preview, debug logs, or an HTTP endpoint without a separately approved authenticated Settings RPC/response policy. A custom role's `settings.edit` alone does not authorize this read. The M04 proposed auth table still has **no tenant key** and is only safe for one business per isolated D1.

**Superpowers TDD:** spec `docs/superpowers/specs/2026-11-15-m03-m04-authorized-settings-map-design.md`; plan `docs/superpowers/plans/2026-11-15-m03-m04-authorized-settings-map.md`. Tests committed before the implementation (`88ace19`, `22abf18`); RED GitHub CI on head `22abf18` showed **six** focused tests failing because `getSettingsMap_` did not exist. Smallest GREEN implementation is `42bb839`. Initial GREEN CI had **695/697 Node tests passing**, with two *test-fixture expectation* errors: actual M02 DDL rejects blank keys during insertion, and malformed `results:null` must fail as `NEEDS_REVIEW` rather than `Denied`. Those are corrected in test-only commit `2996d91`, without altering runtime authorization. The existing real local Workerd+D1 harness now covers successful current-authority full-map reads, permission denial, the exact 256/257 boundary, unsafe stored keys and 404-only HTTP behavior. Final PR-head CI result must be verified separately.

**No production activation:** `src/index.js`, `src/rpc/**`, `migrations/**`, M04 auth SQL/mutation policies, the frozen 84 original GAS/UI files, staging/production/previews D1 bindings, and all financial modules remain unchanged. The complete Settings bootstrap's Active Bank Accounts dropdown and approved RPC envelope/cutover remain unfinished. Revert PR #130 for rollback; no live data migration is required. `PARALLEL-MODULE-READY=false`.
