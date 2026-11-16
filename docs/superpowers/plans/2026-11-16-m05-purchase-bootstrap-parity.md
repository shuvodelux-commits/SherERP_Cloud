# M05 — Source-faithful Purchase Bootstrap read projection (2026-11-16)

**Source authority:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `Purchase.gs::getPurchaseBootstrap`, `Utils.gs::getActiveBankAccountsForUI_` and `BankAccounts.gs::sanitizeAccountType_`. **Target:** `shuvodelux-commits/SherERP_Cloud`, fresh `main` after merged PR #352. See `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, `docs/M03_PARALLEL_READINESS.md`, ADR-007.

## Thirteen-sentence module overview

1. The existing Purchases screen requires the source `getPurchaseBootstrap` output shape, not a new frontend design.
2. The frozen source lists active, non-soft-deleted products and suppliers and excludes only exact `Status === 'Inactive'`.
3. The product picker retains original brand, category, barcode, unit, stored purchase/sell prices and numeric current stock without converting units.
4. The source category filter excludes exact Inactive status but intentionally does not call `activeRows_`, so no additional deletion filtering is invented here.
5. The supplier picker exposes the original `Current Due` signed balance, including supplier credits as negative numbers, and never merges any other Party role balance.
6. Bank account choices exclude exact Inactive status, while legacy missing account types normalize to Bank and Mobile Banking is a separate type.
7. The original Currency Symbol is returned from the settings map with empty-string fallback.
8. This increment creates an internal read-only `projectPurchaseBootstrap` over explicitly provided trusted, tenant-scoped snapshot arrays and a trusted Settings map.
9. Tests will independently execute the pinned GAS `getPurchaseBootstrap` plus its source bank-account helpers in an isolated VM and compare complete output objects.
10. Duplicate visible Product, Supplier, Category and Bank Account IDs or absent visible IDs are unsafe source provenance and must fail closed instead of silently driving client selection.
11. No browser-supplied permission is accepted: the future M03/M04 adapter must authorize `purchase.view` before snapshot acquisition, and the projector must not be registered on public RPC.
12. Follow Superpowers RED missing-module test commit, verified GitHub CI failure, minimal GREEN implementation, full exact-head Node, source-checksum, browser and Worker CI review.
13. Do not change original GAS, source Google Sheets, D1 schema, shared M03 posting kernel, cash/bank/supplier ledgers, active cash sessions, remote preview bindings or original UI.

## File/RPC/schema/rollback inventory

Three **new** files only: `docs/superpowers/plans/2026-11-16-m05-purchase-bootstrap-parity.md`, `tests/m05-purchase-bootstrap-parity.test.mjs`, `src/modules/m05-purchase-bootstrap-read.js`. The projector has **no D1 access, source mutation, auth decisions, RPC registration, stock posting or payment posting**. No `src/db/**`, migrations, `src/auth/**`, `src/rpc/**`, `src/index.js`, `legacy/source/**` or frontend changes.

- Preserve legacy UI response shape `{products,categories,suppliers,bankAccounts,currencySymbol}` exactly.
- Validate trusted snapshot row structures and source IDs before building the response; duplication is an intentional import-review blocker over the original source behavior.
- Tests cover source output for filtered/inactive/deleted records, signed supplier balance, old bank types, empty snapshots, source numeric coercion and immutable inputs.
- This preparatory PR does **not** unlock a live D1 Purchases bootstrap: M02 still lacks versioned Products/Suppliers/Purchases/Stock Lots tables, M03 still owns atomic async adapters, and M04 still owns trusted permission verification.
- Full post/purchase and multi-unit feature PR #313 are separate; no integration conflicts should be introduced.
- Rollback: revert three new files, with zero data effects.
