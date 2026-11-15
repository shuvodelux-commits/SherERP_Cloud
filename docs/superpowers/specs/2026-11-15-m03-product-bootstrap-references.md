# M03 — Original Products bootstrap reference slice through awaited D1

**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/Products.gs::getProductsBootstrap` and `Database.gs::getSettingsMap_`. Existing internal `src/modules/product-master-options.js`, `src/db/legacy-catalog-read.js` and `src/db/settings-read.js` are the tested D1 adapters. M03-core owns the read-only conversion. There is no authenticated public ERP RPC yet.

## Goal and behavior

Convert one additional **real original caller slice** rather than inventing an unused synthetic business endpoint: the Products bootstrap already provides `categories` and `units`, but also needs `currencySymbol` and `lowStockThreshold` from Settings. Source behavior is exact: categories and units exclude only `Status === 'Inactive'`; duplicate names and physical order are retained; `currencySymbol: settings['Currency Symbol'] || ''`; `lowStockThreshold: Number(settings['Low Stock Threshold']) || 5`. This deliberately retains the source's defaults, including conversion of blank/zero/invalid strings to 5; it is NOT a settings-policy redesign.

Extend the **existing**, internal `createProductMasterOptionsReader(env)` with `getBootstrapReferences()`. Keep `getOptions()` unchanged for its callers. `getBootstrapReferences()` awaits both catalog reads and `createSettingsReadAdapter(env).getSettingsMap_()` before projecting the four safe response properties; no request-level cache, no leaked Promise or partial response if any query fails. The settings adapter reads the existing strict D1 settings table; only the two safe display values leave the reader, never the full settings map, phone, logo, permissions, security keys or account data.

## Source-parity and integration gates

1. Node tests use the frozen **original `getProductsBootstrap` function body** with empty Products and lot arrays, mocked source helpers, and fresh Settings/catalog fixture values as an executable oracle. The D1 reader's four fields must match that oracle exactly, including duplicate category labels, case-sensitive `Inactive` exclusion and numeric defaults.
2. Actual local Workerd D1 fixture uses the existing two migrated master catalogs and settings table. A new fixed test-only GET path returns exactly these four fields, no products, no stock, no Bank/Party data; public Worker/RPC remains inert. Missing Settings remains a valid source default.
3. Invalid D1 result, corrupt physical row, malformed Settings key, or missing DB rejects; zero partial bootstrap. `getOptions()` preserves its prior shape and does not read sensitive Settings.
4. No SQL schema, GAS/HTML source, UI, M04 auth, public RPC, Cloudflare deploy config or remote D1 edits. Test Worker route explicitly remains local-only, and no user-provided SQL/column/table identifiers are accepted.

**Limitations:** This is a narrow read-only M03 conversion of four `getProductsBootstrap` response properties, not the complete Products bootstrap (which requires product/lot/bundle D1 data, permissions, stock valuation and precise source semantics). No public method can be enabled without M04 authenticated authorization. Existing M03 async caller graph identifies remaining work.

**Rollback:** revert the scoped PR; no live schema or data touched.
