# M03 Product master dropdown options — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans, superpowers:test-driven-development, and verification-before-completion.

**Goal:** Port the **category/unit option projection only** from the original `Products.gs#getProductsBootstrap` into an isolated, awaited D1 read-only service. Preserve its exact source contract, not the entire bootstrap response.

**Architecture:** Compose the already reviewed `createLegacyCatalogReadAdapter(env)`, await read-only `PRODUCT_CATEGORIES` and `PRODUCT_UNITS` queries concurrently, and project each row to `{id, name}`. Reuse the existing bounded, provenance-validated D1 adapter. Exercise in a test-only Worker path, never in the deployed public Worker/RPC.

**Tech stack:** JavaScript ESM, Node `node:test` / SQLite in-memory compatibility harness, local Wrangler/workerd + D1.

**Spec:** Frozen original `legacy/source/Products.gs` `getProductsBootstrap` category/unit projection; `docs/WORKSTREAMS.md` M03; `AGENTS.md`.

## Global constraints
- Preserve original frontend/RPC and original source byte-for-byte.
- Do not expose unauthenticated public product data or enable the existing `getProductsBootstrap` RPC before M04 auth.
- Do not read SETTINGS or other sensitive source tables, migrate PRODUCTS, or claim full bootstrap parity.
- D1 is async, no caching, no SQL derived from user strings, no writes or migrations.
- Status filter is exact `Status !== 'Inactive'` as source, not case-folded or truthy-only; source order and duplicate names preserved.
- Failure in either query fails entire operation; don't return partial options as success.

## Task 1 — Source-faithful async options RED/GREEN
Files: create `src/modules/product-master-options.js`; test `tests/m03-product-master-options.test.mjs`.
Interface: `createProductMasterOptionsReader(env).getOptions(): Promise<{categories: Array<{id:string,name:string}>, units: Array<{id:string,name:string}>}>`.
- [ ] RED: write fixture/test for exact inactive filter, order, original ID/name mapping, non-mutating non-leaking read-only SQL, missing D1 rejection, corrupt row failure and empty catalogs.
- [ ] Run targeted test: module missing / assertions fail.
- [ ] GREEN: minimal async reader composition.
- [ ] Run targeted test: all pass; verify no embedded Promise fields.

## Task 2 — Real Worker/D1 integration
Files: `tests/fixtures/m03-readonly-worker.mjs`; `tests/integration/m03-workerd.spec.mjs`.
- [ ] RED: add test-only route assertion `/__m03_test__/product-master-options` in real workerd fixture, verifying exact returned fields and unchanged D1 row counts.
- [ ] GREEN: wire test-only route to internal reader. Do not alter public `src/index.js` or `src/rpc/*`.
- [ ] Run `node --test tests/integration/m03-workerd.spec.mjs` with isolated Wrangler installation and record actual result.

## Task 3 — Review and PR
Files: `docs/M03_PRODUCT_MASTER_OPTIONS.md`.
- [ ] Document source response subset and exclusions.
- [ ] Verify `npm test`, `npm run verify:source`, `npm run build:frontend`, and `git diff --check`.
- [ ] Check PR diff: no production endpoint, financial schema, Settings reads, or source changes.
- [ ] Open a single-purpose PR for review with linked evidence. Do not claim complete M03 / complete Products.
