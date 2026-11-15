# Superpowers M06 — Standard-product POS bootstrap read projection

Date: 2026-11-15. **Source SHA:** frozen Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Mandatory rules: `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, `docs/architecture/ADR-007-unified-party-relationships.md`. Base: latest GitHub main after merged PR #98. No changes to original GAS/Sheets or frontend. M05 owns stock/FIFO, M04 auth, M03 D1, M08 ledgers.

## Objective

Add a pure **internal, read-only Standard-product POS bootstrap** projector matching the return shape of `legacy/source/Sales.gs::getPosBootstrap` for an authorized staff user when the visible catalog contains **Standard products only**. Reuse source-ported M05 `buildLotPricingLadder_`; preserve original product selection and customer attributes, bank/vendor UI inputs, active Cash Session and configuration payload. Test the important confidentiality gate: product `purchasePrice` key **never appears in response** unless POS purchase-cost setting AND staff `posCost.view` are both enabled. A separate permission (`reports.view` OR `posCost.view`) controls `canViewCurrentInvoiceProfit`; it never authorizes exposing individual purchase prices.

## Ownership and boundaries

- Inputs are caller-supplied **already-authorized, tenant-scoped, source-shaped** synthetic/test snapshots: product, customer, stock lot rows, trusted vendor/Bank UI projections, active Cash Session outcome, Settings map and server-derived staff permission flags. This is **not** a public `getPosBootstrap` RPC, auth bypass, database reader or permissions source. M04 must independently check `pos.view` before loading these snapshots. Avoid client-provided permission flags in any future RPC boundary.
- Products with source `Is Deleted = TRUE` or `Status = Inactive` are excluded. For Standard products preserve ID/name/unit/brand/barcode/sale-price/lot pricing/current stock/category/type/revision. Reuse M05 authoritative source pricing ladder; do not implement another FIFO/planner.
- Customers are source active (not auto-merged by phone), retain exact Customer ID, Father/relationship, due value and original source fields. Vendor and bank lists are pass-through **trusted read projections** and not recalculated from financial accounts.
- Fail closed if snapshot incomplete, active Cash Session unresolved, or a visible Bundle exists. The frozen source supports bundles, but bundle recipe availability/component-stock projection must be added under reviewed M05/M06 contract; this restricted Standard-only projector must not fabricate component stock.
- `POS Multi Payment Enabled` source enables only literal case-insensitive string `true`; `POS Show Purchase Price` parses native boolean and string; tax/currency/shop settings retain source defaults.
- No M03 schema/SQL, M04 RBAC, M05 stock changes, M08 money, invoice posting, RPC, Worker entry, Cloudflare D1 binding, UI/print updates or deployed data.

## Superpowers implementation order

1. **RED**: commit a test oracle loading original immutable `getPosBootstrap`, `buildLotPricingLadder_`, `bundleProductType_`, and canonical `Utils.gs` helper declarations in a Node VM with synthetic GAS reads and permission/cash-session stubs. Commit unit/source parity tests before target module. Observe expected GitHub CI failure for missing `src/modules/pos-bootstrap-standard.js`.
2. **GREEN**: minimal pure `projectStandardPosBootstrap(snapshot)` consuming already trusted snapshot and reusing `src/modules/stock-fifo-planning.js`. Compare exact source outputs and key-presence (not merely false/zero) for confidential cost, profit-only authorization, inactive/soft-deleted products, source phone/Customer IDs, pricing ladder, settings, session failures and unchanged inputs.
3. **VERIFY**: source oracle, full Node suite, unchanged source/frontend, M03 actual local Workerd/D1 regressions, M04 auth D1, M01 Chromium and Worker preview CI. Record test counts and source-vs-implementation gaps in the PR. Only mark PR ready when all required workflows green.

## Change inventory and rollback

Four **new** files: this plan, `tests/fixtures/m06-pos-bootstrap-oracle.mjs`, `tests/m06-pos-bootstrap-standard.test.mjs`, `src/modules/pos-bootstrap-standard.js`. No source copied verbatim into production; existing M05 helper is imported. RPC before/after **unchanged**. All D1/migrations/tables, Stock, Cash, Bank, Party, Customer/Supplier/vendor account and journal writes: **zero**. Revert this isolated PR to undo, no production data rollback.

Not M06 complete. Future authenticated M04/M03 D1 adapter, M05 bundle/current-stock parity, M08 settlement/Cash Session, M07 returns, full legacy UI POS E2E and source-correct atomic posting remain gated.
