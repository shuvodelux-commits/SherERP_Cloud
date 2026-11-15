# Superpowers TDD — M09 Dashboard low-stock tile source parity

**Frozen source authority:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `Dashboard.gs::getDashboardStats`, original `activeRows_('PRODUCTS')`. **Workstream:** M09, independent read-only source parity. **Owner:** M09 pure projection only.

## Scope / behavior
- Add `projectDashboardLowStockCount({activeProducts})` producing exactly a nonnegative integer.
- Inputs come from a later **trusted M03 repository** providing the original `activeRows_('PRODUCTS')` semantics: excludes deleted source rows but **includes** `Status='Inactive'` so the projection can separately ignore those. No date dependence. No SQL/D1 read or stock posting in this PR.
- Match original counting expression **exactly**: `Status==='Inactive'` excluded, otherwise `Number(Current Stock) <= Number(Minimum Stock)` counts one; out-of-stock counts if it meets the same comparison. Missing/non-numeric numbers produce `NaN` and therefore do not count; blank string numeric conversion is zero. Do not silently trim statuses, require an explicit category, use lot ledger for this tile, or invent negative stock handling.
- Fail closed for untrusted context, additional actor/permissions/tenant keys, row accessors, promises, object-valued stock fields, malformed arrays, nonfinite infinity and nonplain records. Preserve valid original scalar number coercion, including `null`, `undefined`, string and boolean.
- Do not add an inventory mutation path, infer role-specific Party money, or combine this into full DashboardStats, whose cash/finance and other tiles remain gated.

## TDD / acceptance
1. Commit this plan and **independent** Node tests running the exact frozen `const lowStockCount = activeRows_('PRODUCTS').reduce(...)` source statement in a VM. Verify counts for active/inactive, zero/negative stock, thresholds, missing/NaN and nonnumeric values, multilingual product names, no mutation and failure paths.
2. Verify GitHub Foundation's RED failure on missing `src/modules/dashboard-low-stock-read.js` **before writing production code**.
3. GREEN: smallest standalone, strictly validated pure calculation. Run all exact-head Foundation + M01 preserved UI + M03/M04 real local Workerd/D1 + no-secrets preview checks. Note that existing real D1 suites are **regression** evidence, not a new Dashboard D1 integration.
4. Open draft scoped PR with RED/GREEN SHA, changed-file table and CI. No production or staging database changes.

**Nonimpact:** original GAS/Sheets repo, frontend/raw HTML, `src/db`, `src/rpc`, `src/index.js`, SQL migrations, D1 bindings, sale/return/finance/stock writes, Party account rules, M04 sessions, production/previews. **PARALLEL-MODULE-READY=false** until gated evidence. Rollback: revert this pure file/test/plan.
