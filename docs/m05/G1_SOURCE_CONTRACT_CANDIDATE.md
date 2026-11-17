# M05-G1-SOURCE-CONTRACT-CANDIDATE-v0.1

**Status:** REVIEW-ONLY; **NOT A POSTING INTERFACE**; **not** an approved/frozen `G1-writer-v1`.  
**Readiness:** **PARALLEL-SHARED-TRANSACTION-WRITES = BLOCKED**.  
**Owner:** M05 Products, Stock, FIFO and Purchases source semantics, issue [#485](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/485).  
**Related:** M03 [#22](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/22), coordination [#456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456), historical owner-closed [#314](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/314).  
**Baseline:** `main@bcd2d3adbd03f35612c50c1a144a472b1683b412`; PR #480 verified on `main` before this work.  
**Authoritative source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, particularly `Purchase.gs`, `StockLots.gs`, `PurchaseManagement.gs`, `Products.gs`, `Suppliers.gs`, `Vendors.gs`.  
**Approved optional multi-unit source:** `sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c`, especially `ProductUnitConversions.gs`.  
**Related architecture:** `docs/M03_G1_INTEGRATION_HANDOFF.md`, `docs/PARALLEL_EXECUTION.md`, `docs/M03_PARALLEL_READINESS.md`, `docs/architecture/ADR-007-unified-party-relationships.md`.

This document inventories actual already-merged M05 private read/preflight interfaces and describes what M05 would need from a future M03 integration. **Nothing in this file authorizes a financial transaction, promises a completed ERP module, creates a new API, extends the source schema, or relaxes M03/M04 integration gates.**

## 1. Exact source-backed private interface inventory

| Existing private function / owner | Explicit inputs | Existing result and semantics | Critical limitation |
| --- | --- | --- | --- |
| `prepareMultiUnitPurchasePaymentPreflight(payload, {products, suppliers, conversionRows, bankAccounts})` in `src/modules/m05-multi-unit-purchase-payment.js` | Source-shaped purchase input and same-tenant product/supplier/conversion/Bank snapshots supplied by future trusted caller | Original `supplierId`, `supplierName`, `lines[]`, `subtotal`, `discount`, `grandTotal`, `paidAmount`, `dueAmount`, `paymentStatus`, `paymentMethod`, `bankAccountId`, `bankAccountName`; mixed-unit line includes canonical base `qty`, base `price`, `unit.stockUnit`, `unit.unitSnapshot[]`, `unit.pricingSnapshot[]`, `unit.lineTotal` | Preflight only; stock `currentStock`, `newStock` and `rowIndex` are observations, **not CAS**, authorization, live account state or a posting request |
| `auditMultiUnitPurchaseSnapshot(preflight)` in `src/modules/m05-purchase-unit-snapshot-conservation.js` | Trusted in-memory preflight from the previous function | `{ready, issues, summary}`; detects quantity/price/factor component drift, duplicate product, subtotal mismatch and malformed explicit unit evidence | `ready:true` proves only mathematical consistency with its **supplied** snapshot, not current D1 prices, tenant, staff role, supplier balance or safe writing |
| `planConsistentStockPreview({productId, quantity, allLots, productRow, vendorSourced})` in `src/modules/m05-fifo-eligibility-gate.js` | Explicit original Product ID, source lot rows, product snapshot, nonnegative quantity and vendor sourcing flag | `{consumption, pricing}` using reviewed source FIFO and lot-price planners; refuses Deleted positive-stock lots | No lock, reservation, FIFO version CAS, owned/vendor ledger transfer or financial posting |
| `projectTileStockView(catalog, measurement, basePcsText)` in `src/modules/m05-tile-stock-view.js` | Trusted catalog revision, immutable Tiles measurement and canonical signed whole `Pcs` text | `{mode:'read-only-stock-view',productId,revision,basePcs,stockState,boxes,extraPieces,actualSqft,nominalSqft,measurementSnapshot,postingAllowed:false}` and display fields | Negative `OVERSOLD` Pcs are signed shortages, **never available stock**; area is display evidence, not authority for allocation |
| `auditTileLotStock({productId,cachedStockPcs,lots})` in `src/modules/m05-tile-lot-revision-reconciliation.js` | Explicit one-product original lot IDs with each lot's historical catalog, revision, remaining Pcs and status | `{mode:'read-only-tile-lot-audit',lotStockPcs,differencePcs,status,areaState,aggregateSqft,lotViews,issues,ready,postingAllowed:false}`; includes Deleted and OVERSOLD in source balance, rejects Deleted positive and stale quantity | Mixed historical measurements report `aggregateSqft:null`; `ready` does not authorize reconciliation repair or a stock mutation |
| `previewTilePurchaseLineCandidateD1({DB,productId,revision,request})` in `src/modules/m05-tile-purchase-line-preview.js` | Private already-bound D1 and requested source Product ID, current catalog revision, Box/Pcs/Sqft quantity request | `{...candidate,purchasePreview:{mode:'read-only-preview',receivedPcs,pricingUnit,unitPriceText,billingQuantity,exactAmount,lineAmountMinor,priceSnapshot,postingAllowed:false}}` | Read-only current-revision quote; no supplier, actor, Cash Session, full purchase or ledger validation. Never promote it directly to an HTTP writer |
| `auditSourceStockLotBalances({products,stockLots})` in `src/modules/m05-source-lot-reconciliation.js` | Frozen-source product and lot snapshots | Read-only source lot sums, original `Current Stock` comparison, missing ID/duplicate/orphan/deleted-positive issues | No remote import, physical stock adjustment or financial effects |

**Source-only methods** intentionally keep GAS-shaped input fields and optional historical unit snapshots; this document does not create new `serverCall(...)` names or Worker RPC. Other M05 private audits on `main` include purchase/stock-lot lineage, stock movement provenance, historical unit conservation and invoice monetary conservation. Keep each independently testable rather than silently collapsing them into an unreviewed financial writer.

## 2. Input, quantity, currency and provenance invariants

### Original source IDs

- Every Product ID, Conversion ID, Purchase ID, Purchase Item ID, Stock Lot ID, Supplier ID, Bank Account ID, original source group and physical-row reference must be preserved verbatim within its reviewed original namespace. **Do not** derive Unified Party identity from name/phone, source row index, retail display label or a single shared party balance.
- Duplicate or unresolvable source identities must fail closed into `NEEDS_REVIEW`, not pick a matching first/last row. Source `_rowIndex` in previews is not a cross-database identity.
- M02 must supply explicit evidence-approved source-to-Party links and signed independent account directions before M03 can post a supplier liability.
- Product/Supplier/Vendor roles are **not** user staff/RBAC roles. The same Unified Party can have separate supplier AP and customer AR/advance, but they are separate legal/economic accounts.

### Mixed-unit purchase and accounting example

The approved conversion chain `1 Bag = 5 Box`, `1 Box = 20 Pcs` defines flattened factors **Bag=100**, **Box=20**, **BASE=1**. One purchase of `1 Bag + 2 Box + 5 Pcs` is **145 Pcs** in the canonical stock lot, **not** three physical stock rows. A reviewed sample has purchase prices **500 BDT/Bag**, **100 BDT/Box**, **6 BDT/Pcs**; the exact original source component total is `500 + 2×100 + 5×6 = 730 BDT`. A separate two-Foot legacy line at `9 BDT/Foot` is 18 BDT, making an invoice subtotal of **748 BDT**. With 8 BDT discount and 100 BDT already paid, source grand total is **740 BDT**, remaining **supplier due 640 BDT**. This is a supplier obligation, **not** a customer receivable or automatically netted vendor balance.

The normalized `unitSnapshot[]` and `pricingSnapshot[]` must preserve **original conversion ID, unit label, historical flattened factor, quantity and independently configured price**, plus the source stock unit. A changed current product price or conversion revision must **not** reinterpret a saved purchase item, FIFO lot cost, return or previous invoice. No-breakdown original purchases remain single-unit historical lines; never synthesize a fake historical unit breakdown.

Component price arithmetic in the M05 preview uses source `Number` and source rounding; **M03 must reconcile an integer minor-unit amount and rounding conservation within the atomic D1 mutation**, not trust browser-supplied price, imported floating-point formatting or displayed two-decimal effective base cost. The internal lot effective cost rate may need more precision than two decimals to conserve the original line total. Historical purchase return and edit/delete original-lot corrections are reserved to M07 and the shared M03 posting/reversal kernel.

### Historical unit and Tiles revisions

Tiles canonical physical stock is **whole Pcs**. A 12-inch × 8-inch tile at 25 Pcs/Carton yields `53 Pcs = 2 Cartons + 3 Pcs = 106/3 Sqft` nominal (about 35.33 displayed). **OVERSOLD -53 Pcs** means shortage with signed `-106/3 Sqft`, never 53 available pieces. Manufacturer evidence can set a separate coverage ratio: 25 Pcs/Carton at evidenced `16.668 Sqft/Carton` is intentionally distinct from dimension-derived nominal Sqft. Current revision 24 Pcs/Box, older revision 25 Pcs/Carton and their respective dimension/coverage proofs **cannot be substituted for one another**.

Each historical stock lot keeps its own immutable measurement, `revision`, original `boxConversionId`, coverage policy, manufacturer evidence and exact rational area. The source stock sum still includes negative OVERSOLD and Deleted rows; Deleted positive lots block readiness. If measurements are incompatible, the lot audit may report **per-lot** areas while withholding a misleading aggregate Sqft. Tiles Box/Pcs/Sqft quantity and purchase quotes use reviewed current **D1 source catalog** evidence, never client-selected factors or prices.

## 3. M05 candidate versus M03 integration owner

**M03 integration owner** alone owns `src/db/**`, `migrations/**`, `src/rpc/**`, `src/index.js`, shared Worker bindings, Cash Session SQL authority, stock/invoice ID issuance, exact-once operation receipts, fixed SQL-atomic stock + supplier-ledger posting and reversal. These are not M05-owned executable responsibilities.

**M02 identity** supplies source group/physical-row imports and verified Party role/account links. **M04 authority** supplies current tenant/session/actor identity, active RBAC version, permission allowlist, disabled/revoked/last-admin constraints checked **inside the same SQL mutation**. Cash Session and Bank authorization must respect the tenant's reviewed policy. Neither this M05 preview nor historical opening balances provide a Cash Session bypass. Paid Cash/Bank movement must never be fabricated by a preview; opening balances are historical baselines and not cashier turnover.

**Party role-separated accounts** means Supplier AP/advance, Customer AR/advance, Vendor payable/receivable and Owner/Lender/Borrower positions do not auto-offset; Payee as a descriptive role creates no liability by itself. Original Supplier ID and Party identity are linked by reviewed source evidence, not guessed from text fields.

**Exactly-once replay** requires that repeated identical source operation ID + tenant/actor/canonical intent returns the same Purchase/lot/ledger result, while changed payload under the same ID fails with a conflict. Unknown receipt returns `NEEDS_REVIEW` without silent retry or generating another source ID. Current staff authorization, source product/config revision, stock/lot quantity versions, supplier role link and Cash Session eligibility must be guarded in the same SQL-atomic posting boundary. Zero-row CAS, stale/concurrent state, failure on late supplier ledger line or receipt conflict must roll back **all** stock, purchase, payable, cash/bank and ID effects.

**M07 returns** and purchase corrections must preserve original historical purchase quantity, conversion prices/factors, supplier obligation, stock lot allocations and invoice IDs, with at most one authorized compensating operation. No independent M05 transaction engine or implicit current-configuration reprice is permitted.

### Proposed G1 integration acceptance handoff (not implemented)

| Proposed evidence field / behavior | M05 supplies or verifies | M03/M02/M04 still must supply |
| --- | --- | --- |
| Product/purchase/lot canonical identity | Original source Product ID, supplier/source line evidence, unit/lot snapshots | Durable original namespace with M02 physical-row reconciliation and SQL uniqueness |
| Unit conversion and prices | One base quantity per line, source-effective component total, immutable unit/price snapshots | Versioned live D1 catalog check inside transaction and minor-unit conservation |
| FIFO/negative/consignment | Read-only source FIFO candidate, Deleted-positive refusal, OVERSOLD quantity distinction | Valid owned/vendor/consigned stock lot CAS, shortage and supplier posting in atomic SQL |
| Tiles coverage and quantity | Per-lot current/historical dimension and manufacturer proofs, exact Sqft rational, canonical Pcs | M02 current measurement revision binding and SQL-side Pcs/price conservation at posting |
| Staff authorization | **None**; explicit review-only status | M04 trusted tenant/actor/role/revocation in same SQL mutation |
| Purchase payment/account | Source original supplier due/tender calculation only | Reviewed independent supplier Party AP/advance, Bank/Cash Session rights and atomic journal |
| Replay, rollback, IDs | **None**; prior tests are preparatory | M03 original source IDs, operation receipt and exactly-once idempotency, concurrent Workerd/D1 tests |
| Public integration | **Not exposed** | M03-owned RPC only after source, auth, posting and M10/M11 cutover gates |

## 4. Required proof matrix before a real purchase writer

These are **future acceptance requirements**, not passed tests or permission to implement outside M03:

1. Verified source Product/Supplier/Purchase/lot/Party IDs and gross separate account reconciliations on repeatable reviewed imports.
2. A source-accurate existing single-unit purchase, multi-unit 145-Pcs purchase and Tiles Box/Pcs/Sqft purchase with current catalog revision, all inside one reviewed D1 writer.
3. Same original invoice/lot ID and identical results on exact replay; altered intent and ambiguous missing receipt fail closed.
4. Last-stock concurrency, stale product/unit/measurement/lot revision, stale supplier role link and duplicate source ID fail without partial changes.
5. Revoked/disabled actor and wrong permission rejected **inside** the mutation, not only before it.
6. Paid cash with active/disabled-by-policy Cash Session checks; paid Bank/Mobile rights; historical opening entry does not manufacture new cash movement.
7. Supplier payable and any Cash/Bank postings conserve an integer-minor-unit invoice with exact component-price snapshots and no cross-role netting.
8. Late ledger failure, stock CAS failure, receipt conflict and worker exceptions roll back source receipt, purchase header/items, stock lots/movements, supplier AP and cash/bank together.
9. Purchases after unit revision changes cannot reprice saved historical rows; return/edit/delete restore original lots and amounts once under M07/M03 review.
10. All real local Workerd D1, original-source contract, Playwright desktop/phone/tablet, security, full CI, owner review, migration rehearsal and rollback evidence are linked to dedicated integration PRs.

## 5. Release and coordination decision

M05's source parity and these tests are useful **nondeployable preparation** only. Neither `auditMultiUnitPurchaseSnapshot(...).ready` nor `auditTileLotStock(...).ready` grants posting permission. `src/rpc/registry.js` remains intentionally fail-closed. No public sale, purchase, return, bank or cash posting exists just because source preview tests pass.

Before any downstream PR consumes this proposed handoff as a writer contract, M03 must explicitly name the reviewed `G1-writer-v1` version and code owner, M02 must approve source/Party reconciliation, M04 must approve current D1 authority, M05 must sign exact stock/price/lot semantics, and M07/M08 must review reversible/financial effects. Full exact-head CI and protected review rules apply to each PR. Follow the approved merge order from `docs/PARALLEL_EXECUTION.md`, do not treat child-to-feature branch merges as `main` integration, and never modify source Google Sheets or production D1 without separately approved cutover.

**Risk/rollback:** This candidate is documentation and new tests only; revert those M05-owned files if rejected. There are no migration steps, SQL changes, source mutations, production endpoints or data rollback effects.
