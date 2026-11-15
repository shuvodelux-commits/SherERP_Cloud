# M03 — source-shaped asynchronous Settings read boundary

**Status:** Internal D1 read compatibility design, not public RPC or M04 authentication.

## Original source constraints
Pinned `legacy/source/Config.gs`: SETTINGS columns `Key, Value`, defaults `Shop Name`, `Currency Symbol`, `Invoice Show Bismillah`, `Invoice Show Signature`, `POS Show Purchase Price`, and others. `legacy/source/Database.gs:getSettingsMap_()` builds a key-to-value map from current Settings rows, not automatic defaults. `legacy/source/UI.gs:getAppShellData()` only projects `shopName` (fallback `CONFIG.APP_NAME='Hardware Store ERP'`), `currencySymbol` (fallback `''`), and static NAV_ITEMS. `Utils.gs:isSettingEnabled_()` recognizes boolean true/false and case-insensitive trimmed strings; unknown falls back to explicitly supplied default. `Settings.gs` restricts editing and checks `settings` RBAC.

## Proposed boundary
`src/db/settings-read.js` exports `createSettingsReadAdapter(env)` with two **internal, asynchronous read-only methods**:
- `getSettingsMap_()` reads the actual `settings` table from M02 `0001_core_catalog.sql`, uses a fixed bounded `SELECT key,value FROM settings ORDER BY row_id ASC LIMIT ?` query and returns only a null-prototype own-key map (no accidental prototype inheritance). Never synthesize missing rows from defaults. No unsafe `__proto__`/`constructor`/`prototype` keys, non-string data, duplicate keys, or truncation of >256 rows. No module cache; each call re-reads D1.
- `getAppShellSettings_()` issues an independent fixed `SELECT key,value FROM settings WHERE key IN (...) LIMIT ?` query for **only** `Shop Name` and `Currency Symbol` and returns strictly `{shopName,currencySymbol}`; fallback exactly as original UI does, no `NAV_ITEMS` and no private/credential-bearing values. Even if other Settings rows contain phone/email/Invoice Logo, never select or return them.
- `isSettingEnabled_(value,defaultWhenUnset)` is a pure exported helper reproducing `legacy/source/Utils.gs` boolean semantics for typed Sheet values and string D1 values, used only after an explicitly authorized settings read.

**Isolation:** This is **not** an exposed `getAppShellData` RPC implementation. No `src/rpc`, Worker entry, deployed Wrangler config, D1 remote binding, migrations, financial/accounting write or legacy source modifications. Tests run against actual local Workerd+D1 `settings` schema with a distinct fake D1 UUID and a 404-only Worker. Auth and Settings edit privileges stay blocked until reviewed M04 integration.

## Acceptance
Actual local Workerd/D1: empty Settings fallback, stored Unicode strings, key/value preservation including phone leading zeros and boolean strings, prototype-pollution fail-closed, bounded >256, corrupt driver result fail-closed, fresh read after SQLite update, shell projection omits sensitive fields; source parity for boolean enabled helper, no public RPC/GET settings routes. Hook suite through existing M03 Worker CI without editing workflows.
