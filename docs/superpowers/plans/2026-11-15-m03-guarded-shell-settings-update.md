# M03 Guarded Existing Shell Settings Update — TDD Plan (2026-11-15)

**Source:** pinned Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Owner:** M03 repository adapter. **Branch:** `feat/m03-guarded-shell-settings-cas-20261115`.
**Status:** Internal, single-key, nonfinancial update. No public RPC, no auth shortcut, no Cloudflare deployment or D1 schema change.

## Why this slice
- M03 already provides internal read-only `createSettingsReadAdapter().getAppShellSettings_()` using the reviewed M02 `settings` schema.
- Frozen `Settings.gs:updateSettings()` permits partial edits of `Shop Name` and `Currency Symbol`; `Utils.gs:sanitizeInput_` trims written text.
- The broader Settings update also has bank-account validation, numeric rules, invoice design JSON, permissions, Drive and private keys. Those depend on unported/permission-gated modules, so **do not implement them** in this slice.
- A stale read followed by unconditional UPDATE could overwrite an administrator's more recent value. The approved D1 path must reject stale writes **within SQL**.

## API and acceptance
New `src/db/settings-update.js`:
`createGuardedShellSettingsUpdateAdapter(env).updateExisting_(key,newValue,expectedValue)`

1. Exact `Shop Name` or `Currency Symbol` keys only. All arguments must be strings. Only the new value is trimmed like pinned `sanitizeInput_`. Shop Name must remain nonempty after trimming; Currency Symbol may be empty. No synthetic coercion of a number to currency or Shop Name.
2. One fixed parameterized `UPDATE settings SET value=? WHERE key=? AND value=? RETURNING key,value`, with `expectedValue` matching the exact previous stored text. The existing settings row, `row_id`, and `legacy_sheet_row` are unchanged. Stale or absent row => explicit conflict, **no UPSERT**, no deletion or silent success. This is **not** the full `setSetting_` port; creating a new key needs a later reviewed source-row provenance policy.
3. A returned value must match the request or raise `NEEDS_REVIEW`; a driver exception is an uncertain outcome, not proof that no write occurred. The internal adapter requires a real D1 binding. No request-global mutation or caching.
4. M04 still owns `settings.edit` and trusted actor authorization: the adapter is intentionally **not exposed in `src/rpc/**`**. A future caller must authorize before invoking this internal method; it is not permission to expose any Settings key publicly. Do not affect private Settings keys such as Delete Confirmation Key or phone data.
5. Tests verify source trimming, UTF-8/Bangla, empty Currency Symbol, same-value no-op, stale and missing row, concurrent same-preimage attempts (one success/one conflict), disallowed keys, malformed D1 results and error uncertainty.
6. Real local Workerd+D1 tests extend the existing isolated M03 Settings harness against **the existing numbered M02 migration**, including source provenance and unchanged adjacent/private rows. No new fake local Worker, separate D1 binding, schema or deployment change.

## Superpowers execution
- RED: commit the new Node regression and Workerd integration cases **before** adapter implementation on this GitHub branch; open a draft PR and retain failed CI evidence caused by missing adapter.
- GREEN: implement the smallest source-shaped guarded update and rerun GitHub Actions; no unrelated refactors.
- Verify frozen 84 source files, 36-include frontend, caller inventory, D1 integration, Chromium and preview checks via PR CI.
- Document scope, M04 gate and rollback. Leave PR open for review; do not self-merge.

**PARALLEL-MODULE-READY** remains false; this is not production Settings editing.
