# M03 — D1 Settings read compatibility, internal-only

**Status:** Implemented as an internal, read-only Worker/D1 adapter. **Not a public Settings RPC, not authenticated Settings edit, and not a functioning live store.**

## Pinned source contract

Original unmodified `legacy/source/Database.gs:getSettingsMap_()` builds a Key → Value map from `SETTINGS` rows, never injecting missing defaults on every read. Original `legacy/source/Config.gs` defines `SETTINGS: ['Key','Value']` and `CONFIG.APP_NAME='Hardware Store ERP'`. Original `legacy/source/UI.gs:getAppShellData()` presents only shop name fallback to that app name, currency symbol fallback to blank, and static `NAV_ITEMS`. The new adapter **does not** create/nav-map or expose this legacy RPC yet. Original `legacy/source/Utils.gs:isSettingEnabled_()` recognizes actual booleans and trimmed, case-insensitive `true`/`false` text; only unknown/unset values follow the explicitly boolean default.

The existing reviewed `migrations/0001_core_catalog.sql` already has a STRICT `settings(row_id, legacy_sheet_row, key, value)` table with distinct keys and string values. **No SQL migrations are added by this PR.**

## Internal API

`src/db/settings-read.js` exports:
- `createSettingsReadAdapter(env).getSettingsMap_()`: returns a null-prototype mapping of current Settings keys to **uncoerced string values**, preserving original text, Bangla, leading-zero phone strings, fractional money/tax formatting and boolean string spelling. It reads D1 afresh every time; it does not fabricate missing defaults. It enforces a bounded maximum of 256 entries by querying up to 257 and refusing overflow (never silently truncating), and rejects malformed, repeated, blank or unsafe prototype keys. Call only from trusted server-side code, **after** M04 authentication and per-method RBAC where relevant. It may include private keys like Phone, Invoice Logo or Delete Confirmation Key, so never return its full map to unauthenticated clients.
- `createSettingsReadAdapter(env).getAppShellSettings_()`: performs an **independent SQL query restricted to** `Shop Name` and `Currency Symbol`, returning only `{shopName,currencySymbol}` with the original UI's fallback semantics. No contact, logo, finance, role, credentials, address or other Settings rows are projected. It does not add `NAV_ITEMS` or wire the RPC; authorizing any future public shell endpoint is a separate M04 task.
- `isSettingEnabled_(value,defaultWhenUnset)`: pure compatibility helper for source boolean semantics. It prevents the common bug of treating the D1 string `'false'` as truthy.

All SQL identifiers and projection keys are hardcoded, no client-chosen table or column, no writes, no process-wide cache, and no fallback DB.

## Real Workerd/D1 evidence

Dedicated local-only test harness `wrangler.m03-settings-test.jsonc`: synthetic DB UUID `00000000-0000-0000-0000-000000000007`, no routes, `workers_dev:false`, 404-only Worker. It runs the **actual M02 Settings migration** in local D1; no staging or production data is touched. Nine D1 tests check empty values and fallback, Unicode, preserved text, privacy of shell projection, fresh updates, hostile keys, 257-record overflow, invalid driver output, and test-Worker route isolation. Two Node tests verify the source boolean helper and fail-closed binding validation.

The suite is imported through existing `tests/integration/m03-workerd.spec.mjs` to run in the PR-only local D1 workflow. The original 84 GAS files, deployed Worker, `src/rpc` allowlist, migrations, public frontend, and Cloudflare configs are unchanged.

## Remaining work and explicit security gate

A full authenticated Settings bootstrap also needs current Active Bank Accounts (not migrated here), the editable-key allowlist, numeric/JSON validation, permissions `settings.view` and `settings.edit`, provenance and constrained transaction-safe updates. Original `getAppShellData` also returns static navigation; neither method here is wired to it. M04 staff/role/session D1 authentication and M03 async migration remain prerequisites. This read adapter is **not** permission to connect private D1 to a publicly accessible Preview.
