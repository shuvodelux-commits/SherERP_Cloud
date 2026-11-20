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

## Executable proof and review evidence

The test-first RED at commit `65983c59` was a missing M03-local fixture (not an operational ERP defect), confirmed by `node --test tests/integration/m03-first-purchase-atomic-workerd.spec.mjs` exiting 1 with `ERR_MODULE_NOT_FOUND`. GREEN adds two test-only fixtures and one new local Wrangler configuration. **23/23** new real local Workerd/D1 acceptance cases passed; `npm run verify:source` independently verified **84/84** pinned source files. The combined M02/M05/M08/M03 regression and GitHub exact-head CI are separate merge gates.

**Synthetic receipt exemplar:** M08 `1 × ৳0.335 + 1 × ৳0.335` yields invoice HALF_UP **67 paisa**, immutable lines **34 + 33**, source price `0.335`, one fabricated incoming stock lot per line, Supplier ledger **Purchase debit 67 / Bank payment credit 25 / Cash payment credit 42**. Test-only Bank/Cash book records **25 + 42**, due **0**, and product stock **10 → 11**. This example is not production legal/journal sign-convention approval.

**Current authority:** This test loads real M04 *local auth fixture* tables `auth_users/auth_roles/auth_sessions`, seeds a synthetic Modern account/session token digest with the actual SHA-256 token primitive and tests SQL `INSERT...SELECT` current-token, user/role/credential epoch, literal `pos.add`, Shop membership and Open Cash Session. The test does **not** prove production login or actual owner credentials. Revoking the role and closing the Cash Session **after preflight, before DB.batch** both deny the purchase with zero new purchase/lot/money rows. Same-intent retry returns one sealed purchase; changed intent conflicts; same source IDs in two fabricated Shops remain separate, and a deliberately late failure after money and lot statements rolls back all entries.

**Hard limitations:** Synthetic Supplier/Party links are seeded, not actually issued by M02; two Shop IDs share **one disposable D1 test binding**, not separate hosted tenant databases. The scenario supports only **integer Pcs**, not Box/Pcs/Sqft multi-unit snapshots or real lot FIFO cost valuation. The Cash Session, Bank balances and Supplier books are disposable test-only tables, not actual hosted business statements. The role permission SQL is modeled against the current M04 fixture and requires reconciliation with M04 #745's exact grants before integration. The test harness accepts a trusted Node-only pre-batch injection callback for race tests—never browser inputs. Purchase discounts are fixed at zero because over-subtotal policy and real discount posting remain unsigned. Numeric maximum/overflow capacity, real ledger classification, tax and correction/return posting are not established by this sample. Worker fetch **always returns 404**; neither public RPC nor any production/remote D1/Owner account is modified.

**Promotion gate:** M03 must obtain signed M02 Supplier issuer/source provenance, M04 SQL-current authenticated actor/Cash Session, M05 FIFO/multi-unit/Tiles receipt snapshots and M08 final production bounds/ledger classifications before a separately reviewed *operational* financial writer. Human-reviewed test-only merge does not authorize live writes.
