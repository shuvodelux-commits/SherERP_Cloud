# M06 MVP — Source default POS V2 cart with trusted product price/stock

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task; use RED→GREEN before any implementation.

**Goal:** Make the original POS V2 default one-product cart accepted by the existing M06 nonposting source adapter only when the server's current authenticated Shop D1 price/stock evidence proves a nonnegative eligible sale. Source `legacy/source/pos.html::posCreateCartLine_` emits `priceMode:'auto'`, `shortageResolution:'negative'` even with stock available; #792 rejected this unconditionally.

**Architecture:** Extend the existing pure `normalizeMvpPosV2SaleIntent` with an OPTIONAL, **server-only** `trustedProduct` tuple (`productId`, `effectiveUnitPrice`, `availableUnits`). The tuple must come from a current approved product/revision and FIFO stock read in the eventual M03 Shop D1 kernel, not client JSON. If source row declares auto pricing, assert its price matches the independently calculated current effective price; if source row has default negative shortfall policy, permit only when available owned stock covers the sale. Never authorize a true negative-stock sale or vendor sourcing through this pilot. The actual M03 SQL mutation must recheck price, quantity, stock revision, cashier/role and Cash Session atomically.

**Base:** `main@0024b79e2f4959dd7d3dae8dd19213012da0c01e`. M03 operational credit Purchase #795 already owns Worker/frontend/SQL; #796 read bootstrap closed due conflict. M06-only edits to existing `src/modules/mvp-pos-v2-sale-intent.js`, `tests/mvp-pos-v2-sale-intent.test.mjs`, `tests/integration/mvp-pos-v2-source-to-d1-workerd.spec.mjs`, and this NEW plan. No deployment, Worker routes, shared D1, migrations, original source or public RPC.

## Task 1 — RED acceptance
- [ ] Prove original source defaults in test by inspecting checked-in pinned `posCreateCartLine_` source.
- [ ] Add a test that expects one default auto/negative cart to normalize with approved trusted stock and effective unit price; observe expected RED with current adapter.
- [ ] Add negative tests: no trusted tuple, wrong Product, stale price, insufficient available units, fractional/NaN quantity, unexpected fields/accessors, forged source trust; preserve manual fallback tests.
- [ ] Add real local Workerd/D1 positive source-default test using current owned stock and separately supplied fixture trusted effective price; final M06 synthetic posting must still enforce a stale-stock guard.

## Task 2 — GREEN
- [ ] Add bounded pure tuple parser with plain-object no-getter validation, canonical exact two-decimal price and nonnegative safe stock quantity.
- [ ] Require tuple for source `auto` price or `negative` shortage flag; maintain old `manual`+`own` behavior and standard one SKU only.
- [ ] Validate price equality in paisa and available units ≥ sale units, then hand unchanged canonical intent to existing M06 payment normalizer.
- [ ] Focused Node tests, actual local Workerd/D1 tests, full exact-head GitHub CI, independent M06/M03 security/money review.

## MVP blocker handoff
Current exact trusted stock/price read and SQL mutation are not yet implemented in authenticated Owner financial Worker. M03 #795 Purchase creates stock lots, next M03/M06 integration must fetch approved current price/revision and FIFO stock before invoking this adapter and enforce final SQL CAS; do NOT use the test-only M06 D1 fixture in production. No live POS claim until original UI submit+persisted invoice/print and Return/ledger complete.
