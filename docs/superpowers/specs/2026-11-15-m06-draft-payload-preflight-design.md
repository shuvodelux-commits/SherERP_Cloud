# M06 — Saved Draft payload preflight design (2026-11-15)

**Authority:** pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, frozen `legacy/source/DraftSales.gs::validateSalesDraftPayload_`, `SalePayments.gs::normalizeSalePayments_`, and `Utils.gs` money/text helpers.

**Problem:** M06 #103 lists drafts; #109 reads a draft detail; #78 previews a draft invoice. A future authorized save/update needs source-faithful, testable **payload validation** before M03-owned D1 CAS. No trusted draft save RPC or posting is enabled.

**Decision:** Add one pure `validateSaleDraftPayload(payload, {settings,bankAccounts})` preflight; reuse the already source-copied `normalizeSalePayments_` rather than implement a second split-payment calculator. Inputs are already-authorized and tenant-scoped server snapshots, **not browser-controlled settings or bank account lists**. No D1 mutation or original source edits. A separate test VM runs frozen original `DraftSales.gs::validateSalesDraftPayload_` and `SalePayments.gs` independently.

## Original behavior to preserve

- Nonempty items; product ID and name required; quantity positive finite; price, line total and invoice totals finite nonnegative. Each line normalizes unit/name/IDs and rounds money using `roundMoney_`. No new total-reconciliation policy is silently added.
- Retain saved pricing mode `auto|manual|fixed`, vendor shortage resolution/cost and `Bundle` type/revision, serial selections and warranty metadata; this is **snapshot validation**, not FIFO reservation, component stock approval or financial posting.
- Source legacy `payment` shape (`amountReceived/paymentMethod/bankAccountId`) must remain distinct from split-payment `{payments:[...]}`. Only split requires feature flag `POS Multi Payment Enabled=true` and at least one payment row; reuse the frozen sale payment calculator for duplicate row IDs, exact 2-decimal money, one Cash row, account status/type, tender/change and overpay safety. Store the source's normalized **string** amount and row IDs; do not overwrite with calculator's applied amount.
- Source 45,000-character limit applies to serialized **Items JSON** and **Payment JSON** separately; do not accidentally extend the cap to Notes or change size accounting. Preserve customer ID, relationship `Father/Husband`, address, notes and item/payment JSON. Selected legacy Customer ID is not inferred from phone.
- Preserve historical `Number(value)||0`, `Number.isSafeInteger(Number(bundleRevision))`, `roundMoney_` and `String(...).trim()` semantics, even when future D1 schema adds stricter constraints. The D1 writer independently revalidates against authoritative data at posting time.
- Reject missing trusted settings or bank account snapshot at the module boundary as a safer Worker contract, even when a GAS legacy draft would not have read bank accounts.
- No implicit reads, hidden actor, RPC registration, auth, stock, cash, bank, Customer/Supplier/Party posting, or live D1 writes.

## File boundary, acceptance, rollback

Create **five** new files only: `src/modules/sale-draft-payload.js`, `tests/fixtures/m06-draft-payload-oracle.mjs`, `tests/m06-draft-payload.test.mjs`, this spec and `docs/superpowers/plans/2026-11-15-m06-draft-payload-preflight.md`. No `src/db/**`, auth, RPC, SQL migration, Wrangler/Cloudflare config, original GAS/HTML or existing module changes. Source oracle test only uses synthetic rows and the untouched frozen GAS. Require GitHub Actions observed failing RED before the minimal implementation GREEN, full Node/source/frontend smoke, M03 actual local Workerd/D1 regressions, no-secret preview safety. The new helper is **not** a D1 integration test itself.

**Release status:** `PARALLEL-MODULE-READY=false`; must not wire public `saveSalesDraft`/`updateSalesDraft` before M02-P/M03/M04/M05/M06/M08 shared gates and source-shaped transactional CAS. Rollback is simply reverting the PR; no data migration or financial recovery.
