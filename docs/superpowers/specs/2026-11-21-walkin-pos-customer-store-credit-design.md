# Walk-in Sales, POS Quick Customer and Store Credit Return — Design Proposal

**Status:** Proposed; requires owner approval before implementation.
**Date:** 2026-11-21.
**Related:** [Sales UI PR #888](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/888) (merged), ERP integration [#690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690), shared-writer coordination [#456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456), ADR-007, M01/M03/M04/M06/M07/M08.
**Reference UI:** `shuvodelux-commits/hisabiq_ui` POS and Sales visual rules; preserve current original compiled frontend IDs/events.

## Owner intent
1. Walk-in is the frictionless default for a **fully paid** sale. A walk-in invoice must not create a Party, Customer, due or credit account at checkout.
2. Show a small **[+]** immediately beside the POS customer selector. Quick Add collects Customer Name and Phone, saves once via the **real authenticated, Shop-scoped** backend, refreshes the customer list, and selects the returned Customer ID **without losing the cart**.
3. A fully paid walk-in invoice is returnable by **Cash** using the existing authorized return flow, **without requiring registration**.
4. When **Store Credit** is chosen for such a walk-in return, show a dialog: **Create customer (Name + Phone)** or **Select an existing customer** explicitly. The chosen customer must be linked to the original invoice and its credit/return, so Sales History, Customer/Party Ledger and future credit tracking agree.
5. Cancellation leaves all persisted records unchanged. Confirmation commits everything exactly once or commits nothing.

## Current implementation facts (main branch inspected 2026-11-21)
- `legacy/source/pos.html` around lines 49–60 and 2505–2518 requires name + phone even without a selected ID. Its `posCompleteBtn` uses `customerId,customerName,customerPhone,paymentType,paidAmount`.
- `legacy/source/customers.html` already implements `custOpenAdd_(onSaved)` and `addCustomerChecked` in original GAS, but the private Owner dispatcher in `scripts/build-owner-frontend.mjs` has no live Customer add/list RPC mapping.
- `src/db/m03-owner-mvp-cash-sale.js` rejects any `customerId` and only accepts an exactly paid Cash single-SKU pilot. `staging-migrations/shop-owner-write/0007_owner_mvp_cash_sale.sql` requires nonempty name **and phone**, and makes posted receipts immutable.
- `legacy/source/returns.html` offers both Cash and Store Credit; `src/db/m03-owner-mvp-cash-return.js` and `src/m03-owner-redemption-worker.js` currently support **Cash only**, via receipt/stock/Cash Book trigger `0008_owner_mvp_cash_return.sql`; that trigger must **never** be reused as a disguised credit return.
- `migrations/0002_party_identity.sql` models Party identity and roles, but does **not** itself prove that a Shop Customer credit-account writer exists or is activated. ADR-007 requires separate Customer receivable and customer advance/store-credit accounts.
- Today's successful local real-D1 one-SKU Cash Return tests are evidence for that limited supported path, not for multi-item/dated historical returns or Store Credit.

## Approaches evaluated
**A. Frontend-only walk-in string and Store Credit toggle:** lowest effort; **rejected** because the current schema requires a phone and a noncash selection would still post Cash Book or fail.
**B. Existing Customer backend + additive customer attribution + authorized store-credit accounting (recommended):** preserve immutable original cash receipt and return contracts; reuse M03's Shop binding, M04 role/session, M07 return checks and M08 role-specific Customer credit account. Requires reviewed D1 extension, but avoids fake ledger entries and transaction drift.
**C. Rewrite invoice receipts/retroactively edit old sales:** **rejected** because original receipts are immutable, audit identity/stock/cash reconciliation and historical return audit would be compromised.

## Proposed UI behavior and limits
- POS V2 default: `Walk-in Customer` selected, no phone required or stored as customer contact. The UI includes an explicit switch/select Customer state. For `walk-in`, the **server** must enforce due=0 and paid=grandTotal before posting; no client-only shortcut.
- Quick Add: `[+]` near the customer combobox; name+phone required, one button to Save and Select, duplicate phone can suggest candidates but **must never auto-merge identities**. Cancel returns focus to the selector with the cart untouched. Quick Add creates a **zero-opening** Customer role, not today's Cash Book activity.
- Registered Customer: the selected ID is server-revalidated in the current Shop; no trust in posted name or phone. Cash-paid registered sales gain an immutable customer attribution; due/split/bank purchases remain separately gated until M06/M08 permits them.
- Returns: Cash stays the exact authorized refund operation (and cash-session policy). Store Credit opens an identity dialog **only when the original invoice is unregistered**; create or explicitly select a customer. A registered invoice uses its existing ID and confirmation only. An unavailable/invalid/refused Store Credit path remains disabled and visibly explained.
- For a walk-in Store Credit return, create/select the customer, bind the **original sale ID** to that customer in an immutable audited attribution, post one Store Credit return and credit the **Customer advance/store-credit liability**. Show a return receipt and Customer Ledger entry linked to the invoice. No Cash Book debit for Store Credit, no automatic offset with unrelated Customer AR or Supplier/Vendor/Owner/Lender roles.
- Example: walk-in invoice paid ৳1,000; merchandise worth ৳200 is returned as Store Credit. **Cash movement on return: ৳0; Customer Store Credit: +৳200 liability; invoice net sales decreases by ৳200; original FIFO stock is restored.** The original ৳1,000 checkout cash receipt remains unchanged.
- Future redemption should reuse M08's account allocation and M06's tender integration; **do not claim redeemable Store Credit is enabled** until a real future-sale redemption test passes. At minimum the ledger must track available vs consumed credit accurately and label unsupported redemption explicitly.
- Cancellation or a failed create/link/return must not leave orphan customer, credit, invoice attribution or stock movement. No additional cash-session transaction for a pure noncash credit.
- Compatibility: original paid Cash and its Cash Return unaffected. Preserve frozen `legacy/source`, HisabIQ dimensions, 320/390/768/1024/1440 breakpoints, keyboard/touch/BN hints and the real Owner session/permissions.

## Domain and D1 invariants
1. Existing receipts `owner_mvp_sale_receipts` remain immutable; customer attachment is an explicit **append-only, unique source sale → Customer ID** attribution with actor, operation ID, timestamp, original invoice ID and Shop-scoped foreign-key integrity. Never overwrite historical receipt name or phone.
2. First-Shop legacy `customer_phone` has a nonempty CHECK; an approved **versioned schema transition or an explicitly typed, non-contact guest marker** must be decided by M03 before coding. Never expose a fabricated phone as customer contact or make a normal phone search treat all walk-ins as one customer.
3. Customer create/list/resolve must enforce current authenticated Shop identity, staff Customer permissions and revocation at request and SQL write time; no cross-Shop ID resolution. Reuse the existing Party Customer role and corresponding M08 account model rather than building a second independent customer ledger.
4. Monetary entries use integer paisa (BDT); credit lives under Customer **advance/liability**, never masquerades as an incoming payment or a historical opening balance.
5. A Store Credit return shares the **same SQL-enforced original-sale quantity, FIFO lot, original-price, prior-cash-returns and total-refund ceilings** as the current Cash Return. Both return methods must count against the same remaining sale quantity; a concurrent Cash + Store Credit return cannot exceed the original invoice.
6. One `operationId` with canonical intent hash and SQL-time actor, Shop, open/closed-policy, stock and money guards; replay with identical intent returns the original receipt; mismatch or excess is rejected without side effects. New customer + sale attribution + credit liability + return/stock posting are one D1 atomic transaction, not a sequence of fallible browser requests.
7. For cash returns, customer remains `null` for genuine walk-ins and no Customer ledger is posted. Cash refund still obeys its existing Cash Session rules; Store Credit does not touch cash/bank and does not invent a Cash Session close or opening entry.
8. Customer role vs ERP user role remain distinct; audit/permission rules apply across original Sale → Return → Customer Ledger → Reports, and no other Party account is netted.

## Test/acceptance matrix
- Walk-in Cash fully paid: no name/phone requested, invoice persists and reloads, Customer list unchanged, no AR/credit.
- Walk-in amount underpaid, split tender or due requested: both UI and direct API reject until an identified Customer + approved tender path is available.
- Quick Add: accessible `[+]`, valid name/phone, async save/selection, zero opening balance, no cart reset; cancel/failure/duplicate phone handled explicitly.
- Cash Return: walk-in refund succeeds, one FIFO restock + one cash movement + zero customer credit; duplicate or concurrent replay cannot double refund.
- Store Credit dialog: absent Customer blocks return, Cancel means zero D1 writes, success creates/selects Customer and links invoice; credit equals exact return value, customer account reports it.
- Same phone across existing customers never selects automatically; unknown, revoked, wrong-Shop, stale invoice, returned-out stock, conflicting operation ID and concurrent Cash+Credit attempts are all rejected.
- Customer Ledger/Invoice Detail/Return History/Daybook reconcile after refresh; no phantom Cash Book transaction for Store Credit; return reversal or correction never silently deletes credit.
- Browser screenshot iteration across 320,390,768,1024,1440 plus keyboard, touch, focus, mobile modal/sheet, loading/error/success; compare to `hisabiq_ui`.
- Real isolated Workerd/D1 with two Shops, noncached reads, migration verification and failure-injection before production flag approval.

## Execution ownership and release gate
- **M01/M06:** POS/customer button and Return dialog (compiled-only UI, source-preserving).
- **M03 integrator exclusively:** D1 migrations, invoice attribution, validated tenant-scoped Customer master endpoints, SQL-atomic Store Credit return/account integrations, Worker routes. **M04** security, **M07** return invariants, **M08** Customer advance/ledger directions.
- Use separate reviewed PRs in this order: Customer master+guest sale contract → POS quick add/cash return parity → noncash Store Credit kernel → Return dialog/read projections → full E2E and launch gate. No parallel writers or unreviewed public RPC.
- Full financial posting/store credit remains disabled until backend schema/version, customer account authority, exact-head GitHub Actions, cross-Shop D1 tests and owner-approved Cloudflare deployment prove readiness. No live D1 migration or automatic production flags are authorized by this spec.

**Decision requested:** Approve the recommended approach B and its atomic Store Credit design before using the execution plan. No feature implementation is included in this planning branch.
