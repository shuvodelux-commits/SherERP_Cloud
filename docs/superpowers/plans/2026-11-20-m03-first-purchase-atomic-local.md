# M03 — first new-shop purchase atomic integration rehearsal (local Workerd/D1 only)

**Branch** `m03/newshop-first-purchase-local-atomic-20261120`; base verified `main@a4995ed69616ab1d3e05a675bc19d39414f94878`.  
**Coordination:** M03 issue #22 comment #7032035147, parallel reservation issue #456 comment #7032036089.  
**Status:** Test-first, **nondeployed**, data-fabricated local Shop purchase integration. No real ERP writer, RPC or migration.

## 12-sentence implementation overview

1. The first operational purchase has to reconcile the approved M08 money allocation with Shop-scoped M02 Supplier identity, current M04 authority and M05 stock/lots in one transaction.
2. Existing M02, M04, M05 and M08 lanes have independent local evidence but have not jointly proved one purchase posting.
3. This M03 run constructs a disposable local D1 integration harness that never appears in production or preview Worker configs.
4. For authorization it reuses the existing M04 local auth migration schema and real opaque-session hashing rather than accepting an actor ID from request data.
5. The test inserts two fabricated, Shop-scoped Suppliers with verified active Party links and two active Stock products.
6. The first purchase amount uses the approved M08 candidate HALF_UP invoice-header allocation of 67 paisa across source-exact lines of 34 and 33 paisa.
7. One SQLite transaction must append the invoice, immutable lines, purchase stock lots, Supplier purchase/payable and Bank/Cash payment legs, with exact header, allocation and ledger conservation.
8. Cash Session required by the synthetic Shop policy must be Open, and the SQL-time session and `pos.add` authority must remain current when the write occurs.
9. An identical operation must replay the same sealed purchase without a second lot, cash movement or payable, while changed intent must fail.
10. Foreign-Shop Supplier or Product IDs, revoked roles, expired authentication, closed Cash Sessions and missing money backing must fail before writing anything.
11. An injected failure after the invoice and stock steps must roll back every synthetic row rather than leaving a partial stock or ledger.
12. This is **integration acceptance evidence only**; full M02 source issuance, true M04 permission mapping, actual FIFO cost rules and an approved numeric maximum remain prerequisites to promoting a shared production D1 writer.

## Strict file ownership
- New `tests/integration/m03-first-purchase-atomic-workerd.spec.mjs`
- New `tests/fixtures/m03-first-purchase-atomic-local.mjs`
- New `tests/fixtures/m03-first-purchase-worker.mjs`
- New `wrangler.m03-first-purchase-local-test.jsonc`
- This plan and optional dedicated PR-only CI workflow.

**Forbidden:** shared `src/db/**`, existing `src/rpc/**`, product schemas, operational migrations, M02/M04/M05/M08 source modules, public Worker, Cloudflare bindings and real Owner data. M02 #748, M04 #745, M05 #750, M10 #746 and M01 #749 keep exclusive concurrent ownership.

## RED → GREEN → QA → Review

- RED: first local test must fail on absent M03 fixture; commit independently.
- GREEN: minimum disposable D1 schema + binder using real current M04-style SQL authority and already merged M08 exact calculator, never a second finance arithmetic engine.
- QA: same-Shop replay, lost-response retry, changed intent, two shops with matching Supplier IDs, Cash Session Open vs Closed, SQL-time role/version revocation, unknown Party/Supplier, late rollback, FIFO evidence, integer-only money legs, and external RPC 404.
- Independent review: human must inspect query atomicity, nondeployed status, no new financial engine, source identity/actor/cash proof and all GitHub exact-head CI. No merge without approval.

## Remaining production gates

- **M02:** operational Supplier source-ID + Party link issuance and original Shop ownership, source counter floors; old private historical 49 groups still not reconciled.
- **M04:** actual SQL-time literal `pos.add` permissions, current user/role/credential/token and Cash Session policy; active PR #745 may refine.
- **M05:** actual immutable multi-unit/Tiles product revision and inventory/lot cost, fully tested stock valuation and FIFO; #750 still open.
- **M08:** owner-approved new-shop HALF_UP/header-once/paisa allocation/100 POS lines, but operational quantity/price/money bounds, over-subtotal discount and real ledger classification are not yet approved.
- **M03:** only the exclusive integrator may promote this to versioned production D1 migrations and real atomic posting, after all code owners approve.
- **M10/M11:** no hosted migration, public finance RPC, live Owner access, real payment writing or production cutover from this test.
