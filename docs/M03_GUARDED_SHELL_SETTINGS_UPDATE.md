# M03 — Guarded Updates of Existing Shell Settings (internal only)

**Status:** Real D1-compatible internal write adapter, but **not a public Settings RPC** and not a functioning authenticated Settings page. No production data was touched.

## Source contract and precise scope

The original source is pinned at `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

- Original `legacy/source/Settings.gs:updateSettings` authorizes `settings.edit`, allows partial payloads, requires a nonempty Shop Name, and updates only recognized editable keys.
- Original `legacy/source/Utils.gs:sanitizeInput_` trims text before writing.
- Original `legacy/source/Database.gs:setSetting_` overwrites an existing key or **appends a missing key**.
- The existing M03 `src/db/settings-read.js:getAppShellSettings_` reads only `Shop Name` and `Currency Symbol` using `migrations/0001_core_catalog.sql`, which has `settings(key TEXT UNIQUE, value TEXT, row_id, legacy_sheet_row)`.

This PR implements exactly one safe **existing-row-only** subset for those two nonsensitive shell keys. It deliberately does **not** implement the whole legacy updateSettings or setSetting_ contract. Missing keys are refused rather than appended, pending an approved strategy for preserving new legacy physical Sheet row provenance. Original Settings module also edits bank, invoice design, tax, logo, and private values; none of those are supported by this adapter.

## Implementation and concurrency behavior

```js
import {createGuardedShellSettingsUpdateAdapter} from './src/db/settings-update.js';

const edit=createGuardedShellSettingsUpdateAdapter({DB});
await edit.updateExisting_('Shop Name','  নতুন দোকান  ','Previous shop name');
// returns {updated:true}; DB value becomes 'নতুন দোকান'
```

- `key` must be exactly `Shop Name` or `Currency Symbol`. `newValue` and `expectedValue` must both be strings; rejects numbers, objects, missing or unrelated/private fields.
- The new string is trimmed per the source. Shop Name cannot be blank after trimming; Currency Symbol can be blank. The **previous value is not normalized**: it must match the stored D1 text exactly.
- One fixed parameterized SQLite statement performs `UPDATE settings SET value=? WHERE key=? AND value=? RETURNING key,value`. The previous value comparison occurs **inside** the write, not after a stale JavaScript preflight.
- Unique key constraint means at most one row changes. The adapter preserves `row_id` and `legacy_sheet_row`; no read-before-write, batch imitation, upsert, hidden cache, or user-supplied identifier appears in SQL.
- Absent or stale values produce an explicit conflict with no write. Concurrent attempts with the same preimage allow at most one success if the new values differ. An unchanged same-value update is a legitimate single-row no-op.
- An exceptional D1 response or malformed returned row produces a `NEEDS_REVIEW` error, rather than claiming success. Do not automatically retry a possibly committed update with another preimage.

## Security boundary

This helper **does not authenticate or authorize a caller**. Production `settings.edit` must be enforced with the actual M04 session and role policy before connecting it to a public RPC. The existing `src/index.js`, `src/rpc/registry.js`, Workers Preview, staging D1, and production D1 remain untouched; public editing stays unavailable. This is **not** a production launch or permission to expose all Settings through M03's internal full-map reader.

Private Settings (`Phone 1`, `Delete Confirmation Key`, Invoice Logo, bank details, etc.) are neither writable here nor returned by the existing shell read projection. The current M04 schema and login/permission gates, finance migrations, UI acceptance, and reviewed production cutover are still blocking prerequisites.

## Superpowers TDD and tests

- Plan: `docs/superpowers/plans/2026-11-15-m03-guarded-shell-settings-update.md`.
- RED: tests committed before implementation, verified in GitHub Actions at `7a3aa1b`; D1 test job failed on the **expected missing `src/db/settings-update.js` import**.
- GREEN: `tests/m03-settings-cas.test.mjs` covers actual Node SQLite schema, CAS updates, concurrent stale-preimage refusal, Unicode/trim, identity preservation, key allowlist, malformed D1 and lost-result uncertainty.
- Real Workerd+D1: extends existing `tests/integration/m03-settings-workerd.spec.mjs`, using the **actual reviewed M02 migrations and existing local-only D1 binding**. Checks source row identity, stale/concurrent writes, adjacent private keys and absence of public update routes. The existing PR-only Workerd workflow runs this suite; no new Worker service or test database was introduced.
- Revert this PR to remove its source, tests and docs; no migrations or user records need rollback.

**PARALLEL-MODULE-READY remains false.** No changes to original 84 frozen source files, frontend files, numbered D1 migrations or auth/finance modules.
