# SherERP Unified Party — Approved Design Direction

**Date:** 2026-11-14  
**Product decision:** Owner-approved unified Party identity, multi-role membership, separate account balances, optional explicitly authorized manual cross-role settlement.  
**Implementation scope:** No code, migrations, auth policy or settlement enabled in this document.  
**Binding architectural record:** [ADR-007](../../architecture/ADR-007-unified-party-relationships.md).

## Goal

A person or business that buys from, sells to, lends to, borrows from, owns or receives expenses from SherERP appears as **one Party** with any combination of Customer, Supplier, Vendor, Owner, Lender, Borrower and Payee roles. Existing ERP module screens and financial obligations remain correct throughout the Google Apps Script → Cloudflare Workers/D1 migration.

## Approaches considered

| Approach | Advantage | Rejected cost |
| --- | --- | --- |
| Keep seven separate master identities | Small initial migration change | Duplicate identities, repeated contact edits and difficult cross-role visibility |
| One Party with one automatically netted balance | Smallest overview model | Destroys separation of customer receivables, supplier/vendor payables, loans and owner capital |
| **Selected: One Party + role membership + independent accounts** | Unified identity and safe financial reporting; explicit optional offsets | Requires a staged identity-link map, account-specific reconciliation, permissions and settlement engine |

**Chosen design:** One Party for identity, descriptive roles as a join table, independent relationship/contract accounts, source-linked postings and optional explicit approved noncash settlement. The exact table DDL will be reviewed and test-driven after this design documentation is approved in GitHub.

## Existing behavior to preserve

- `Mohim_ERP` has distinct Customers, Suppliers, Vendors, Expense Payees and Finance Persons masters. Finance Persons can already combine Owner/Lender/Borrower.
- Original Vendor Due and Vendor Receivable are separate. Owner equity is separate from Lender Loan Payable and Borrower Loan Receivable. A Payee has no automatic debt.
- Signed customer/supplier opening balances, historical owner/lender/borrower openings and historical Cash Book baseline adjustments are not current-day Cash Session movement.
- Native POS, sales, purchase, expense, vendor, returns, corrections, ledgers and invoices remain operational; the new unified Party view must not cause an unapproved redesign.
- Only identity references are unified; financial account types and source/contract IDs must remain distinct and reconcilable.

## Data model boundaries

- `parties`: identity (not staff user authentication).
- `party_roles`: membership (not permissions).
- `party_legacy_links`: reviewed mappings to original source IDs.
- `party_identity_review`: ambiguous candidates awaiting human decision.
- `party_accounts`: role/account-kind/currency/contract-specific balances or derived positions, not one common Current Due.
- `party_account_entries`: financial source-linked posting projections / eventual canonical entries. No duplicate authoritative ledger.
- `party_settlements` and `party_settlement_allocations`: new narrowly scoped, noncash manual offsets with idempotency and reversal audit.
- Any future general journal must be one authoritative posting pipeline after a separate financial-engine transition gate.

## Unified Party view contract

A Party workspace shows identity and role badges, then **separate per-account receivable, payable, advance, loan and capital positions** and role-specific ledgers. The overview can compute display-only net exposure when legal entity and currency align, always labeling it non-posting. Roles can be added/disabled independently; historical source links must remain traceable.

## Manual settlement contract

- **Default disabled** until eligibility matrix and authorization have been approved, M04 auth is in place, and M05–M08 financial atomicity/reversal tests pass.
- User chooses an eligible same-party pair, obligation references, amount and reason. Appropriate module rights **and** settlement proposer/approver permissions are checked server-side; the approval policy is reviewed before activation.
- A pure cross-role offset is a balanced noncash posting, not an exchange of money; it must never change current cash/bank or Cash Session totals.
- D1 transaction guard enforces current available amounts, unique operation ID, no double-allocation, immutable source links, all-or-nothing posting, exactly-once reversal.
- No automatic netting during normal sales, purchases, finance, returns or cash-session activity.
- Owner equity, lender/borrower loans, vendor AP/AR and advances cannot be added to eligible pairings without further policy review.

## Migration strategy

Identity-first mapping of source records → roles → account mapping → read-only parity → native writers and reconciled source links → additive Party view → tightly permissioned settlement last. The source system remains read-only as a migration input; actual historic data will not be uploaded to GitHub.

## Five implementation risks requiring explicit tests

1. Same phone, similar name, or missing contact fields: do not silently merge into one identity.
2. Customer advance and supplier advance: do not invert their balance direction or net them.
3. Same Party as Owner, Lender and Borrower: do not convert capital to a loan or erase separate agreements.
4. Stale invoice/purchase/loan balances during parallel settlement requests: prevent over-allocation in one SQL atomic boundary.
5. Legacy backdated opening/correction and noncash offset: do not create Cash Book/Bank Book or active Cash Session movement.

## Approval status

The **principle** is owner-approved. The **SQL DDL, eligible offset pair matrix, approval thresholds and journal transition** remain implementation-policy gates; [ADR-007](../../architecture/ADR-007-unified-party-relationships.md) records them. A separate documented review and test gate precede actual implementation.
