# M03 — Products master options (internal read-only slice)

**Source:** Pinned `legacy/source/Products.gs` function `getProductsBootstrap`, specifically the category and unit projection only. Not a complete Products migration.

`createProductMasterOptionsReader(env).getOptions()` composes the existing bounded, source-shaped D1 read adapter for `PRODUCT_CATEGORIES` and `PRODUCT_UNITS`. It awaits both D1 queries before returning `{categories:[{id,name}], units:[{id,name}]}`. It excludes only rows with the **exact** source status `Inactive`, preserving duplicate labels, source physical order and original IDs. Source does not case-fold this filter; lower-case `inactive` remains eligible, as in GAS.

The two queries remain bounded to 1,000 rows each and reject invalid `legacy_sheet_row` values, gaps, malformed values or unexpected D1 failures. A failure in either query rejects the entire operation; no partial result or unresolved Promise is returned. No caching, Settings access, writes or arbitrary table names are introduced.

**Access boundary:** No public `getProductsBootstrap` RPC is registered. The application `src/index.js` remains the inert shell and `src/rpc/registry.js` stays empty until M04. The only new demonstration URL is registered in the **local test-only** Worker fixture `tests/fixtures/m03-readonly-worker.mjs` and must never be deployed.

**Still missing:** authenticated token/permission contract, PRODUCTS records and bundles, FIFO stock valuation, Settings currency/low-stock values, and original `ok_/fail_` RPC response. Do not claim M03, M04 or the Products module complete on the basis of this slice.

**Tests:** Node in-memory SQLite source fixtures exercise exact option shape, status semantics, duplicate names, blank catalogs, corrupted row provenance, missing binding and D1 query errors. The dedicated Wrangler/workerd integration test exercises the actual D1 runtime and asserts zero catalog mutations.
