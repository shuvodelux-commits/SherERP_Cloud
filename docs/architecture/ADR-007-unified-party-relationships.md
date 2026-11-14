# ADR-007 — Unified Party Identity, Separate Role Accounts and Manual Cross-Role Settlement

**Decision:** Approved by project owner on 2026-11-14: one Party may have Customer, Supplier, Vendor, Owner, Lender, Borrower and Payee roles; financial balances stay separate by role/account; cross-role settlement is optional, explicit and authorized.  
**Implementation:** NOT approved as code in this ADR; architecture and migration sequencing only.  
**Authority:** This ADR overrides any earlier migration-plan assumption that these seven relationships must remain independent master identities. Preserve existing *economic semantics*, source transaction contracts and the original interface while transitioning.  
**Source reference:** `shuvodelux-commits/Mohim_ERP` pinned commit `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Context: how the original ERP works

The frozen `Config.gs` has distinct `CUSTOMERS`, `SUPPLIERS`, `VENDORS`, `EXPENSE_PAYEES`, `FINANCE_PERSONS`, plus their transaction/ledger tables. `FinanceModule.gs` already supports combinations of Owner/Lender/Borrower in one finance-person record. `Vendors.gs` deliberately tracks *Current Due* and *Current Receivable* separately. `OpeningBalance.gs` treats signed customer/supplier opening balances and owner/loan/borrower opening entries as historical baselines, **not** current cash-session turnover. `PartyLedger.gs` is a read-only projection and routes mutations to their native modules. Expense payees are selected through `EXPENSE_PAYEES` while expenses store legacy payee identifiers/names in expense ledger fields.

Migrating these directly into seven unrelated SQL master tables would keep identity duplication; prematurely merging their money fields would cause accounting errors.

## Binding invariants

1. **One identity, many roles:** Each real person or business may be one `party_id` and have any combination of the seven descriptive roles. User/staff authorization roles are a *different* concept; holding a Party role grants no ERP access.
2. **Independent financial accounts:** Customer receivable/advance; Supplier payable/advance; Vendor payable/receivable; Owner equity and drawings; Lender loan payable; Borrower loan receivable remain distinguishable. Each separately contracted loan or other obligation may have its own subaccount/contract.
3. **Payee is an identity role, not a liability.** An expense does not automatically create a payable; a recorded unpaid obligation is required.
4. **No automatic balance netting:** A Party overview may display an illustrative net *for the same legal entity/currency*, but that aggregate is **not a posting, settlement, cash balance, or substitute for gross reporting**.
5. **No automatic merge on name or phone:** Similar names, shared mobile numbers, absent phones or old alias names cannot justify merging financial identities. Preserve the original selected Customer ID as authoritative for POS/drafts/edits. Human-reviewed identity linking is required for ambiguous histories.
6. **Preserve legacy provenance:** Every mapped legacy master ID and linked transaction remains traceable to source group, original ID and original sheet/row where available. Old IDs cannot be silently reassigned or rewritten. Deletions/inactivation retain historical audit traces; no cascading deletion of posted history.
7. **No silent accounting-engine replacement:** Until a domain is migrated and fully reconciled, its existing customer/supplier/vendor/finance writers remain authoritative behind compatibility adapters. Do not dual-write two independently authoritative ledgers. New journal/ledger schemas must share one authoritative posting path only when formally cut over.
8. **Opening balances:** Are historical signed positions. Reconciliation must keep their original debit/credit direction and baseline handling, without creating today's Cash Book/Bank Book turnover or requiring an active cash session for a purely historical opening.
9. **No cash session for noncash offsets:** An authorized *pure cross-role noncash offset* generates **zero** current cash/bank movement; cash-session requirements still apply to any accompanying actual cash/bank transfer according to configured policy.
10. **No weakening of POS/inventory rules:** Cash sales are not forced to create a Party; FIFO/OVERSOLD/vendor shortages, bundles and returns keep current meaning.

## Logical model — reviewed intent, NOT final SQL DDL

| Entity | Responsibilities and critical keys |
| --- | --- |
| `parties` | Immutable internal `party_id`; identity name, type (person/business), phone/contact information, status and audit timestamps. Business names and phone numbers are **not** unique IDs. |
| `party_roles` | Composite unique `(party_id, role)`; role in Customer, Supplier, Vendor, Owner, Lender, Borrower, Payee; activation/deactivation/history policy. Distinct from staff RBAC. |
| `party_legacy_links` | Unique `(source_group, legacy_record_id)` → `party_id`; preserve original master row and reviewed attribution. Only confirmed mappings become active links. |
| `party_identity_review` | Quarantine ambiguous/unmatched legacy identities for authorized manual resolution; track review status, candidate mapping, evidence, approver, timestamp. Never infer that rows are the same person from phone/name. |
| `party_accounts` | Separate `account_id` per party/account-kind/currency/contract; account kinds include customer AR/advance, supplier AP/advance, vendor AP/AR, owner equity/drawings, lender loan AP, borrower loan AR. Do not store an undifferentiated `current_due` here. |
| `party_account_entries` | Account-aware source-linked debit/credit postings, with signed direction governed by account class, source transaction, stable posting id, reversal marker and audit reference. |
| `party_settlements` / `party_settlement_allocations` | Approved *new* noncash cross-role offset source document, allocating exact remaining obligations/advances to participating accounts and immutable source entries; idempotent and reversible with audit. |
| `journal_entries` / `journal_lines` | Proposed canonical balanced financial journal **only after** an explicit, reconciled ledger transition design; not license to create a second accounting truth while legacy writes continue. |

Names above are architectural interface candidates, **not executable schemas**. Before SQL is committed, decide legal entity scope, account types/subaccounts, amount precision in BDT minor units, timestamps, FK/unique/index/CHECK constraints, and backfill ordering through a reviewed migration and real D1 integration tests.

### Example: Rahim Enterprise

One `party_id`, roles Customer + Supplier + Lender:
- Customer AR = **৳5,000** (Rahim owes business)
- Supplier AP = **৳3,000** (business owes Rahim for purchases)
- Lender loan AP = **৳20,000** (business owes Rahim a separately contracted loan)

Display gross amounts separately. An arithmetic net of ৳18,000 payable may be shown only as an explanatory summary, not used to close anything. If an eligible, authorized **৳3,000 customer-versus-supplier offset** is accepted, the balanced noncash posting concept is **Dr supplier AP ৳3,000 / Cr customer AR ৳3,000**; resulting customer AR = ৳2,000, supplier AP = ৳0 and lender loan AP = ৳20,000, with **no cash/bank event**. These illustrative journal directions must be checked against approved historical sign conventions before implementation.

## Manual cross-role settlement — mandatory safety contract

The feature is **disabled until** authorization, accounting, D1 atomicity and legal eligibility gates are proven. When enabled, every settlement must:

1. Explicitly choose one resolved `party_id` plus the source/target `party_account_id` records, eligible source obligations, and exact proposed amount; require same legal identity, compatible currency, permitted account-type pair and any legally necessary consent/documentation.
2. Permit only reviewed account pairs. Default candidate: customer receivable versus supplier payable of the **same** party and currency. Any loan, vendor, owner equity/drawings, advance or different legal-entity combination requires a separate written policy/eligibility review; **Owner equity is never treated as a lender loan**.
3. Enforce a dedicated server-side permission such as `party.settlement.create`, plus an authorized approval capability `party.settlement.approve` according to a reviewed separation-of-duties/threshold policy. No client-supplied `isApproved` flag or Party role substitutes for authorization. Record proposer, approver, UTC timestamps, date, reference, documentary reason and optional attachment reference.
4. Validate against current unpaid/unsettled amounts, not merely cached/current display balances. Prevent offset exceeding any participating obligation; reject unrelated or disputed/frozen obligations.
5. Create a single **balanced noncash** posting and both allocation records, with one immutable operation ID and SQL-enforced guards in the same atomic D1 write boundary. A stale or duplicate request must fully abort or return the already committed result; **zero-row conditional updates are conflicts**, not success.
6. Keep cash/bank and today's cash session untouched for a pure offset. A mixed cash+offset workflow, if later approved, is a distinct posting plan with its own cash-session enforcement.
7. Allow reversal only via permissioned, source-linked, exactly-once reversing entries that restore available amounts. Forbid deleting posted ledger lines; preserve operator identity and reason.
8. Reconcile gross receivables/payables, account balances, original invoices/purchases/loans, Daybook reporting classification, settlement allocations and journal debits/credits after posting.
9. Require idempotency/replay, parallel approval, stale-balance, over-allocation, partial-failure and rollback tests **on actual D1**, not just mocked SQL.

A user selecting one person's Customer and Supplier roles must **not** automatically settle them during a sale, purchase, payment, return or opening-balance correction.

## Legacy migration strategy and rollout

- **Identity-first:** Preserve existing original masters/IDs. Create Party identities, role links and a review queue. Same name/phone can generate candidate matches, not automatic merges.
- **Legacy link map:** Establish `(CUSTOMERS, Customer ID)`, `(SUPPLIERS, Supplier ID)`, `(VENDORS, Vendor ID)`, `(EXPENSE_PAYEES, Payee ID)`, and `(FINANCE_PERSONS, Person ID)` to Party IDs, including historic aliases/soft-delete states where available. Mixed Owner/Lender/Borrower roles on one finance record map to multiple roles on one Party.
- **Source/contract preservation:** Sales, purchases, expenses, vendor sourcing, finance and ledger rows keep their original reference and account relationship through compatibility layers; no unapproved change to original UI/validation behavior.
- **Account backfill:** Backfill distinct accounts and opening/balance checkpoints; compare independently with every old customer, supplier, vendor due/receivable, owner equity, loan AP and borrower AR. Do not sum a person's roles into a single Current Due.
- **Native module bridge:** Existing POS/Customer/Supplier/Vendor/Finance/Expense screens continue to use their original RPC response contract and role-specific selectors; a unified Party workspace is an additive view unless separately approved.
- **Enable settlement last:** Only after M04 identity/auth, M05–M08 transaction posting/reversals and M10 reconciliation gates; no unsettled legacy mapping or conflict should be masked by an offset.
- **M11 cutover:** Same Party identity across roles, separate financial accounts, no historic balance drift, no failed identity mapping for posted obligations, correct rollback accounting.

## Testing and release gates

Fixtures must include:
- one Party with seven roles but seven independent scopes; inactive role with active historical ledger;
- customer advance (negative), supplier advance (negative), vendor AP and AR simultaneously;
- owner investment vs lender loan vs borrower loan, including all three under one original finance person;
- expense payee with no pre-existing debt;
- duplicate names/phones, blank phone, multiple businesses sharing phone, conflicting original IDs; require manual review;
- invoice referring to a preferred customer ID remains stable after a party name/phone change;
- original historical opening balances, returns, edits, soft-deletes and reversals; match source totals;
- valid proposed offset (e.g. AR/AP ৳3,000) and forbidden automatic/over-balance/cross-entity/currency/equity offsets;
- duplicate API request, simultaneous offsets, stale snapshot, authorization failure, failure-injected atomic batch rollback, exactly-once reversal;
- same pre/post total cash/bank and cash-session amounts for noncash settlement;
- matched gross-balance reconciliation **per account**, not a net number.

**Release blocker:** If any identity link is ambiguous, financial balance changes unexpectedly, cross-role offset posts without explicit authorization/approval, or any monetary posting can partially commit, do not enable settlement or finalize M10/M11.

## Open implementation policy gates (not changes to the approved principle)

- Which cross-role account-type pairs beyond same-party customer AR versus supplier AP are legally/operationally eligible?
- Approval and maker-checker thresholds, authority to reverse, freeze/dispute behavior and required evidence.
- Single-shop legal entity vs eventual multi-tenant/legal entity scoping; currency and rounding policy.
- Incremental journal adoption vs existing ledger projections while preserving single source of financial truth.

**Current decision stands regardless of those later details:** unified Party identity; roles are multi-valued; accounts are separate; offsets are opt-in, explicitly authorized and never automatic. Nothing here authorizes schema changes or financial-posting code.
