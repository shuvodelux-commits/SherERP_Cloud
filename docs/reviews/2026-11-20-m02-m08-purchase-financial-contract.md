# M02/M08 purchase financial contract — Run 3 review candidate

**Date:** 2026-11-20 (Asia/Dhaka)  
**Status:** REVIEW REQUIRED — **not approved for M03 operational purchase posting**  
**Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (`Purchase.gs`, `Suppliers.gs`, `SupplierSettlement.gs`, `PurchaseReturn.gs`, `StockLots.gs`, `CashSession.gs`, `PartyLedger.gs`, `Config.gs`)  
**Coordination:** #690, #24 (M02), #66 (M08), #22 (M03), #456, M05 #314; merged #708.  
**File owner:** M08 source-account preparation only. M02 must separately approve provenance/import mapping. M03 alone owns numbered D1 schemas, shared `src/db`, SQL posting, authorization boundary, Worker routes/bindings and public RPC.  
**Scope:** synthetic source-oracle tests and account/ID semantics; no production writer, migration, staging/production deployment, source modification or historical import.

## 1. Review overview (12 sentences)

1. Run 3 cannot promote the existing M05 synthetic local purchase writer until supplier account identity, gross balances and original references are reviewed.
2. `Purchase.gs::createPurchase` first authorizes `purchase:add` and invokes `requireActiveCashSession_()` without testing whether a purchase will ultimately be paid.
3. The authoritative supplier is the original active `SUPPLIERS.Supplier ID`, never a name/phone match or client-supplied Party identity.
4. A separate, reviewed `(SUPPLIERS, Supplier ID)` Party legacy link may identify the person while preserving that supplier account and its original source ID.
5. Every accepted line updates product stock and creates a supplier-specific lot with the **purchase date**, while its Stock Movement keeps the source purchase reference and Lot ID.
6. The source purchase subtotal is the sum of line quantities multiplied by unit costs, and the source clamps discount and paid values in ways that require an explicit exact-money migration policy.
7. The unpaid portion alone increases `SUPPLIERS.Current Due` and creates a **Supplier Ledger Debit**, not a general-ledger debit.
8. An immediate cash or bank purchase payment is a **Cash Book or Bank Book Debit**, and a fully paid purchase does not create a new supplier due ledger row.
9. `Suppliers.gs::paySupplier` decreases supplier due via a **Supplier Ledger Credit**, and paying beyond due creates a negative supplier balance/advance instead of automatically clearing Customer receivables.
10. `PurchaseReturn.gs::completePurchaseReturn` preserves the original purchase, lot and return reference chain and either records a limited verified cash refund or a supplier-credit reduction of the obligation.
11. Any D1 implementation must enforce current permission, open Cash Session, reviewed supplier link, tenant identity, product state, operation receipt, stock/lot/ledger atomicity and exactly-once reversals at its SQL mutation boundary.
12. Approval must resolve precision and account-provenance questions below before M03 is authorized to propose a numbered operational schema.

## 2. Source ledger and reference matrix

| Source operation | Source record and native sign | Financial impact | Required reference |
| --- | --- | --- | --- |
| Credit purchase | `PURCHASES` + `PURCHASE_ITEMS` + `STOCK_LOTS` + `STOCK_MOVEMENT`; `SUPPLIER_LEDGER.Debit = Due Amount` when due > 0 | Supplier payable increases; no immediate money-book entry when payment is zero | Original `Purchase ID`, `Supplier ID`, `Lot ID`, `Movement ID`, `Ledger ID`; movement Reference = purchase |
| Cash purchase | `CASH_BOOK.Debit = Paid Amount` when paid > 0 | Cash drawer decreases; only unpaid remainder affects supplier due | Cash Book Reference = Purchase ID |
| Bank purchase | `BANK_BOOK.Debit = Paid Amount` when paid > 0 and bank-like method | Bank account decreases; Cash Book unchanged; **entry still requires active Cash Session in pinned source** | Bank ID and Bank Book Reference = Purchase ID |
| Supplier payment | `SUPPLIER_LEDGER.Credit = Payment + allowed discount`; money book Debit = actual payment | Supplier due decreases; negative due is supplier advance; noncash discount is not cash outflow | Supplier Ledger `Ledger ID` is money-book Reference; legacy older rows may reference Supplier ID |
| Supplier credit return | `PURCHASE_RETURN` + items, lot reduction and Stock Movement, `SUPPLIER_LEDGER.Credit = Return Total` | Supplier obligation falls; possible advance; no money book | Return `Purchase ID`; return item `Return ID`, `Purchase ID`; movement `Lot ID`, Reference = Return ID |
| Cash refund return | `CASH_BOOK.Credit = verifiably refundable amount` | Cash drawer increases; limited by original verified cash paid less prior refunds | Cash Book Reference = Return ID; original Purchase ID retained on return |
| Historical supplier opening | `SUPPLIERS.Opening Balance`, opening Supplier Ledger debit/credit according to sign | Historical baseline only; must not be recast as today's cash-session turnover | Original Supplier ID and opening ledger reference |

**Attention:** "Debit" and "Credit" above name physical **source columns**; they do not automatically specify general-ledger journal direction. Fully paid purchases must remain visible in the read-only Supplier Ledger *projection* even though the source wrote a financial Supplier Ledger entry only for the unpaid amount.

## 3. Identity and gross-account mapping for M02/M08 approval

- `(tenant_id, source_group='SUPPLIERS', source_id=original Supplier ID)` must resolve only through an explicitly reviewed link. Preserve every source Party role and ID; do not auto-merge by phone/name.
- A Supplier may also be a Customer, Vendor, Owner, Lender, Borrower or Payee. One Party identity never creates a global combined Current Due.
- Supplier `Current Due > 0` maps to **SUPPLIER_PAYABLE**; `Current Due < 0` maps to **SUPPLIER_ADVANCE**. A role's signed historical `Opening Balance` must be reconciled independently from its current position.
- Supplier Ledger `Debit` raises source signed due; `Credit` lowers it. Distinguish payment amount from settlement discount and return credit.
- A Customer AR balance and a Supplier AP/advance of the same Party are two different accounts. Cross-role offsets remain off under ADR-007.
- Source-account reconciliation must compare original master current due, native ledger rows, purchase-specific obligations, payments, supplier credits and historical openings. If legacy rows cannot be attributed to a purchase, retain that ambiguity for reviewed reconciliation, not an invented purchase allocation.
- The physical source record identifiers and the original deletion/reversal history must survive import. No source ID reassignment, same-name aliasing, cross-tenant balance leak or netting.

## 4. Money, quantity and date rules requiring explicit review

**Pinned source behavior:** `subtotal += qty * price`; `discount` accepts a nonnegative number; `grandTotal = max(0, subtotal - discount)`; `paidAmount` is nonnegative and **clamped down to grandTotal**; `dueAmount = grandTotal - paidAmount`. Original GAS `Number` arithmetic is not, by itself, proof of cent-exact SQL arithmetic. Do not silently replace source accepted values with rounding or rejecting rules.

**Proposed operational representation (approval pending):** BDT integer paisa for stored money, exact integer/rational canonical quantity with product-specific multi-unit conversion, explicit per-line rounding, safe ranges/overflow rejection, stable effective date (Asia/Dhaka), original Purchase Date used for FIFO and original created/edited audit timestamps preserved. Preserve source-equivalent payment status and blank stored payment method when paid amount = 0. Test fractional quantity, discount allocation, payment cap and mixed unit measures on source fixtures before accepting the SQL contract.

**Conflict to resolve before implementation:** whether excessive discounts or paid amounts, and monetary values with more than two fractional digits, must continue to be accepted and source-rounded or must be rejected with a separately approved behavioral change. The M05 local synthetic writer rejects some values the pinned GAS source clamps. That difference is not an approved production rule change.

## 5. Required M03 Run 3 acceptance after joint approval

1. M02 and M08 review the source/group/ID and gross-account matrix above; attach source-package reconciliation (real data requires separate private approval). M05 reviews FIFO/quantity and M04 reviews trusted `purchase:add` plus session actor authority.
2. M03 proposes **one reviewable operational schema** for original PUR / purchase line / LOT / SM / Supplier Ledger / Cash Book / Bank Book / reversals and supplier-account links, including ID issuance, indexes, CHECKs, versioned migration and rollback.
3. Run the already merged real local M05 Workerd/D1 purchase tests, then add source-shaped tests using the accepted schema, not the M05 disposable table names as a production shortcut.
4. Test the merged #708 two-purchase oracle: 10 × ৳60 credit and 10 × ৳75 cash → 20 stock units, ৳1,350 original lot cost, ৳600 supplier payable, −৳750 cash movement, unrelated same-Party Customer AR still ৳90.
5. Require SQL-time authenticated actor, trusted tenant/shop binding, exact permission, Cash Session state, supplier active/reviewed link, product version, stock and receipt checks within the same D1 atomic unit; no preflight-only authorization.
6. Assert same-operation replay, changed intent/actor denial, simultaneous conflicting operations, failed final ledger leg rollback, backdated FIFO ordering, bank payment with no cash entry and zero-paid purchase requiring a session.
7. Reconcile native ledger columns and gross Party checkpoints without netting; preserve supplier discount/advance and return credit lineage, source purchases and exactly-once reversal allocation.
8. Run full current-head CI and real Workerd/D1 tests; keep staging off until separate schema, backup and owner release approval. M03 owns integration, no other module writes shared SQL.

## 6. What this PR actually proves

`tests/contract/m08-purchase-source-financial.test.mjs` runs **the actual pinned GAS function bodies** under synthetic in-memory stubs. It tests credit/cash purchases, bank-vs-session behavior, ID rejection, native Supplier Ledger/Cash Book signs, supplier advance payment and supplier-credit return lot references. It also invokes existing `prepareGrossPartyBalances` to verify same-Party gross source-group/account separation. These are **source behavior and independent financial contract checks**, not a real D1 write, cross-request atomicity, a supplier-account reconciliation of private data or authorization to deploy. Existing M05 real local Workerd/D1 synthetic posting evidence is documented by merged #708.

### Suggested local commands

```sh
npm run verify:source
node --test tests/contract/m08-purchase-source-financial.test.mjs
node --test tests/integration/m05-purchase-posting-workerd.spec.mjs tests/integration/m02-gross-parity-workerd.spec.mjs
```

**Required owner/M02/M08 review decision:** approve or amend exact source account semantics and the unresolved monetary/quantity policies; only then allow the single M03 integrator to begin operational Run 3 SQL work. No changes to `legacy/source` or release flags in this PR.
