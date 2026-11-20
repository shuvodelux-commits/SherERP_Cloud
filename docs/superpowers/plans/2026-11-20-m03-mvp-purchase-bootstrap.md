# M03 MVP — Source Purchase bootstrap to authenticated real clean-Shop D1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make the original SherERP Purchase screen load authentic per-Shop Products, Suppliers and Categories after Owner Gmail sign-in; the existing screen must display this data without enabling unreviewed financial postings or false "saved" outcomes.

**Architecture:** Add one read-only M03 Owner D1 Purchase source adapter with no SQL writes. It is called by a new disabled-by-default protected private Owner endpoint, anchored to validated Owner session, exact Shop binding and immutable Shop identity. Patch the existing Owner frontend builder, preserving original DOM/logic, to map only `getPurchaseBootstrap` and clean-Shop empty `getPurchaseManagementList` to private routes. All create/update/delete/return functions stay fail-closed until reviewed M03 financial integration. Use preexisting `readCleanOwnerCatalog` and `readOwnerSupplierBootstrap`, with explicit canonical empty-shop gates. Real D1 and browser tests validate two-shop isolation, session expiry, source shape and original Purchase product/supplier pickers.

**Stack:** Existing Hono private Owner Worker, D1 SQLite, Node 22, Wrangler local Workerd/D1, Playwright Chromium, source `legacy/source/Purchase.gs` and `purchase.html`.

**Base:** `main@e28c0e5ba9f8537908e7a1b43a4e9aa29db3c3ce`; no open PRs at reservation. See coordination issue #456, M03 #22, M05/M06/M07 #314, M10/M11 release gates.

## Scope / boundaries

- M03 reserved shared code: `src/m03-owner-redemption-worker.js`, `scripts/build-owner-frontend.mjs`.
- New code and tests: `src/db/m03-owner-purchase-bootstrap.js`, `tests/integration/m03-mvp-purchase-bootstrap-workerd.spec.mjs`, `qa/m03-mvp-purchase-bootstrap-browser.spec.mjs`, `.github/workflows/m03-mvp-purchase-bootstrap.yml`, this plan.
- **No** new Shop/Control D1 SQL migrations, no financial posting, stock/lot/Cash Session writer, real purchases, party balances, accounting replays, public `src/rpc`, `src/index.js`, Wrangler binding changes or any production/remote Cloudflare D1 interaction.
- Authenticated read route must require existing private Owner/login and clean-Shop flags, verified Shop identity binding and nonexpired current Owner session. Do not expose to an unsigned Owner or cross-tenant browser.
- Only *clean new Shop* Product and Supplier master records. Legacy snapshot/partial import, incomplete Supplier role, future stock postings or missing Purchase transaction history table must not be presented as a complete financial historical ledger.
- Source Product object names: `id,name,brand,unit,category,barcode,stock,purchasePrice,sellingPrice`; Supplier objects `id,name,phone,currentDue`. Categories `id,name`; bankAccounts and history must be truly empty if uninstalled. `getPurchaseBootstrap` never reports successfully saved Purchase.
- Original Purchase creates `createPurchase`, updates and returns with real cash/stock effects; these actions remain blocked. Non-deployed shop read-only prep is not MVP completion.

## Task 1 — RED test before implementation

- [ ] Commit this plan; add real local two-Shop Workerd/D1 acceptance test for missing Purchase read adapter and private Owner API.
- [ ] Test source shapes and true current data for Product/Supplier, default zero stock/zero due, no client-provided tenant ID, rejected wrong session, missing Shop identity and legacy data; no financial write.
- [ ] Add browser test for original Purchase tab and supplier/product picker, while confirming submission still rejects and no fake success.
- [ ] Add PR-only dedicated CI (Node 22, pinned Wrangler 4.161.0, Chromium), create draft PR. Verify expected missing-module RED in GitHub.

## Task 2 — Minimal GREEN

- [ ] Implement `readMvpOwnerPurchaseBootstrap` and `readMvpOwnerEmptyPurchaseHistory` reading real Shop D1 with tight clean-Shop checks and bounded products/suppliers.
- [ ] Add private Owner GET routes under existing gate and cookie scope, explicitly opt-in `OWNER_PURCHASE_READ_ENABLED` default false; check Shop ID+marker in D1, don't trust payload.
- [ ] Add exactly two source `serverCall` function mappings to original compiled Owner ERP frontend; preserve existing error handling for *all* writes.
- [ ] Run local Workerd two-Shop and real Chromium test, fix errors using RED→GREEN.

## Task 3 — Verification and handoff

- [ ] Run full GitHub Actions on exact HEAD, confirm no regression in product/Supplier flows and original UI navigation.
- [ ] Verify all edited shared files remain M03 reservation, no overlap with newly opened PRs.
- [ ] Post M03 next single-owner **write** integration gate: first supplier-credit/paid Purchase in one reviewed Shop D1 atomic mutation, independent source purchase.add and active Cash Session, exact money, chronological FIFO lots, immutable source IDs, Supplier-only gross ledger and no double posting. Then POS from #792, Return and invoice.
- [ ] Leave draft/unmerged pending independent review and owner approval. External Cloudflare Workers Builds may remain blocked by another account's free build cap; no deployment claim.
