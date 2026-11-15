# M03 — Source-verified internal navigation visibility projection

**Source authority:** Frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/UI.gs#NAV_ITEMS` and `legacy/source/javascript.html` functions `filterNavByRole_`, `subNavVisible_`, `navLandingKey_`, and `firstReachableKey_`. Existing PR #124 source-shaped M03 shell reader and #134 M04-authorized internal shell response remain unchanged.

## Intent

Prove and preserve the existing browser's role-visible navigation decisions, including child tabs, POS V2 landing, Returns (separate permission), Settings Users/Roles, Counter action-based visibility, and no-access fallback. Implement one **pure, internal-only** `projectSourceNavigation(navItems, profile)` in `src/modules/source-nav-visibility.js`.

`profile` must explicitly contain `allowedModules` (null for an already authenticated Administrator, or array for another role) and `permissions` (plain object or null). Missing/invalid role metadata fails closed rather than silently treating undefined permissions as Administrator. This function **does not authenticate** or give permission; its caller must already have validated M04 session/RBAC metadata. An untrusted caller can ask it to render any menu; therefore never register it as public RPC or use its result to authorize transactions.

Return a detached JSON-safe display model:
`{sidebarItems, groupTabs, sidebarLandings, firstPageKey}`.
- `sidebarItems`: exactly the original top-level `filterNavByRole_` output, including unchanged child metadata and source order; sidebar itself is not filtered to only sub-tabs.
- `groupTabs`: visible child entries per visible group matching the original `subNavVisible_`; array items `{groupKey,children}`.
- `sidebarLandings`: `{groupKey,pageKey}` per visible sidebar entry matching `navLandingKey_` (POS V2 preferred).
- `firstPageKey`: same first reachable page as source `firstReachableKey_`, including `noAccess`.
Do not write new navigation, CSS, routes, or change the frozen source. No mutations to input menu/profile or global caching. Preserve bilingual strings and source ordering.

## Approach and boundaries

Choose a small direct pure projection (no new dependency) checked against **actual frozen source functions executed in a Node VM**, rather than duplicating a literal menu or constructing a new UI routing system. A CSS or frontend rewrite is excluded. A server-side per-role filtered public shell is also excluded until the M04 authenticated-RPC and D1-bound cutover policies are approved.

**Files:** one new internal module, source-oracle Node tests, this spec and an execution plan. No `src/db`, `src/rpc`, `src/index.js`, `legacy/**`, migrations, build scripts, auth SQL, Worker/preview config, external repo, Cash/Bank/stock/ledger, or real D1.

**Acceptance:** TDD RED missing module in GitHub Actions; GREEN varied role matrices equal exact existing browser functions (Administrator, cashier, Returns-only, Settings-only, Users-only, action-based Counter, no access), deep-copy stability, malformed input failure. Run full Node, original source pin and frontend build, M01 Chromium, M03/M04 isolated local D1 and all PR safety checks. Source parity is a **synthetic UI projection test**, not proof of authenticated public RPC or real D1 financial operations.
