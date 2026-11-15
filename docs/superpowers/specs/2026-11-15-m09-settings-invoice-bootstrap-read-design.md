# M09 Settings + Invoice Design bootstrap — frozen-source read projections

**Date:** 2026-11-15. **Frozen source:** `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/Settings.gs::getSettingsBootstrap` and `getInvoiceDesignBootstrap`, `Database.gs::getSettingsMap_`, `Invoice.gs::resolveInvoiceLogoDataUri_`, original `settings.html` and `invoiceDesign.html`. Independent of the current M09 D1 Reports-bootstrap PR #224.

## Purpose and exact contracts

The original general Settings page loads `getSettingsBootstrap(token)` under **settings:view**, not reports:view, then consumes `{settings,bankAccounts}`. The Settings map is the exact source K/V map (including all keys present; **no inferred defaults or filtering**). Bank Accounts come from **all** `BANK_ACCOUNTS` source rows except `Status === 'Inactive'`, retaining original row order, and are projected only to `{id: Bank Account ID,name: Account Name}`. This is a dropdown read, not a bank-account balance reader or proof of authorization to move money. Source currently includes active/no-status bank records too. Do **not** silently filter by bank account type, Current Balance, name, etc.

The original Invoice Design page loads `getInvoiceDesignBootstrap(token)` under **settings:view**, then consumes `{settings,logoDataUri}`. The logo is a **pre-resolved trusted data URI** from the source `resolveInvoiceLogoDataUri_` (which returns empty string when missing or inaccessible). The projection must not resolve Drive IDs, download, decode, upload, remove, store or render a logo itself. It must not interpret an uploaded base64 as an authorization for file writes. Valid inputs preserve original return shape and source value types, including numeric/boolean Settings values from Sheets.

## Design

Implement a single small pure internal module `src/modules/settings-invoice-bootstrap-read.js` exporting:
- `projectSettingsBootstrap(settingsMap,bankAccounts)` ⇒ original `{settings,bankAccounts}`.
- `projectInvoiceDesignBootstrap(settingsMap,logoDataUri)` ⇒ original `{settings,logoDataUri}`.

These are projections over **already-loaded source-shaped snapshots**. They do not own D1 reads, M04 session/role checks, storage, async pipelines, Worker endpoints or M03 Settings mutations. A future authorized boundary must enforce tenant-scoped **settings:view** and return only the original caller's settings, not the broader report bridge's limited Settings subset. In particular, `getAppShellSettings_` is intentionally restricted to two keys and **must not be reused for full Settings or Invoice Design**; a separately approved bounded authorized Settings read is necessary.

Require plain own-data Settings maps (including `Object.create(null)` from D1), without accessors, inherited properties, Promise, nested/unsafe objects, prototype-pollution keys or nonfinite numbers. Copy the map to avoid caller mutation; preserve primitive values and falsey values exactly. Reject invalid array/missing loaded Bank Accounts, getters/proxies, non-string/blank/duplicate selected Account IDs, and malformed Bank Account fields, but do not reject duplicate **inactive** source accounts. These are intentional **corrupt input** fail-closed deviations from original GAS, not changes to valid source behavior. The legacy Invoice Logo resolver allows data URI from trusted Drive; restrict the future projection to empty string or trusted `data:image/png|jpeg|webp|gif;base64,` with canonical Base64 and no excessively large payload (maximum decoded source logo file size 1.5 MiB), to avoid treating arbitrary external URLs as safe previews. Do **not** create raw logo bytes or file records.

Tests: load the unmodified frozen GAS `getSettingsBootstrap` and `getInvoiceDesignBootstrap` bodies into Node VM with deterministic permission/row/logo mocks; compare **whole JSON payload and key order** across active/inactive banks, original settings scalar types, empty Banks and absent logo, unicode/Bangla shop settings and logo, old source UI `serverCall` expectations. Add unsafe inputs, privacy of bank balance/name, mutation isolation, no RPC/DB writes. Test-first **real GitHub RED** then minimal GREEN; CI includes 84-file pinned source audit, original 36 frontend includes, local Workerd/D1 and Chromium.

## Impact and rollback

Exactly four added files: this spec, `docs/superpowers/plans/2026-11-15-m09-settings-invoice-bootstrap-read.md`, `tests/m09-settings-invoice-bootstrap-read.test.mjs`, `src/modules/settings-invoice-bootstrap-read.js`. No edits to source GAS, original Settings/Invoice Design HTML/DOM/print, RPC registry, M04 roles, D1 schemas/migrations, M03 Settings reader, logo storage, or Cash/Bank/Party/finance posting.

Rollback: revert four files; no data backout. Remains internal until owner-reviewed M04 authorization, approved Settings D1 reader and invoice asset storage bridge pass real isolated D1/permission/browser tests.
