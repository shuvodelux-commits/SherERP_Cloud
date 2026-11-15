# M09 Dashboard Customer receivable / Supplier payable — Superpowers TDD

**Frozen source authority:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; `legacy/source/Dashboard.gs::getDashboardStats`; `legacy/source/Utils.gs::roundMoney_`. **Project:** SherERP Cloud. Source and destination guidance: `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, and approved ADR-007.

## Objective and parity
Introduce one *internal, pure* `projectDashboardGrossDues({activeCustomers,activeSuppliers})` returning exactly `{dueReceivable,supplierPayable}` for the two existing Dashboard tiles, with no shared-net/Party settlement.

Source expressions:
- `dueReceivable = activeRows_('CUSTOMERS').reduce((sum,c)=>sum+Math.max(0,Number(c['Current Due'])||0),0)`
- `supplierPayable = activeRows_('SUPPLIERS').reduce((sum,s)=>sum+Math.max(0,Number(s['Current Due'])||0),0)`
- Apply frozen `roundMoney_` *once per gross total* at the end, not per row; preserve source numeric coercion, including blank/null/missing/nonnumeric amount to 0.
- Ignore negative source Current Due for these dashboard tiles, **without** inferring that advances or cross-role balances can be erased. An account-level reconciliation is separately required.

## Trusted caller preconditions and safeguards
Caller must already have selected active legacy `CUSTOMERS` and `SUPPLIERS` with original row/provenance semantics (and M04 `dashboard.view` authority) in a single trusted business context. This function neither authorizes, queries D1, nor infers Party identity. No data from a Customer role can be interpreted as Supplier liability or vice versa.
- Reject nonplain snapshots, missing/extra fields, property accessors, objects/Promises/symbols in rows, Infinity, unsafe arrays, and invalid unknown nested amounts. Preserve original scalar coercion and exact `roundMoney_` semantics.
- No new consolidated Party Current Due, no vendor/owner/loan/borrower/payee balance mixing, no account netting, no writes, no source GAS/frontend changes.

## RED → GREEN
1. Commit this plan then `tests/m09-dashboard-gross-dues.test.mjs` which executes the **exact two source reduce expressions** and `Utils.gs::roundMoney_` in Node VM using deterministic synthetic rows. Cover separately indexed gross totals, negative due, zero/blank/NaN, precision, existing source inactive filters supplied by caller, mutation safety, forged actor and accessors.
2. Verify expected GitHub Foundation RED: `ERR_MODULE_NOT_FOUND` for `src/modules/dashboard-gross-dues-read.js` at a test-first commit.
3. Minimal GREEN implementation in `src/modules/dashboard-gross-dues-read.js`; run full affected source, M01 Chromium, M02/M03/M04 local Workerd+D1 **regression** and secret-free Cloudflare PR checks, then document evidence on draft PR. Existing M03 D1 tests do not constitute real Dashboard finance D1 integration.
4. Owner reviews PR before merge; no public RPC, D1 migration, auth activation, financial posting, or preview data binding. **PARALLEL-MODULE-READY=false**.

**Scope/ownership:** only `src/modules/dashboard-gross-dues-read.js`, its test, this plan. No changes in `src/db`, `migrations`, `src/rpc`, `src/index.js`, original UI/GAS or production databases. Rollback: PR revert; no schema or data restoration.
