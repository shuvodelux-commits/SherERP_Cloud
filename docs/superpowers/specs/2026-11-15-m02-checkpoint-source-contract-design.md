# M02-P — Checkpoint Source/Account Contract Guard (2026-11-15)

**Original source:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2. **Authority:** AGENTS.md, docs/WORKSTREAMS.md, docs/M03_PARALLEL_READINESS.md, owner-approved ADR-007 and the approved original gross Party checkpoint preflight. **Base:** merged #202 pure gross comparator and #213 synthetic local Workerd/D1 proof.

## Root cause
`src/party/gross-checkpoint-parity.js` currently validates `sourceGroup`, `kind`, `sourceField` and `basis` against independent global vocabularies only. A caller can fabricate an **internally consistent** ready source preflight carrying `CUSTOMERS / Current Due / VENDOR_PAYABLE` or a Vendor current receivable labeled Vendor payable; by updating gross kind totals and supplying the same fabricated readback, `offlineCheckpointParity` becomes `true`, contrary to ADR-007's separate account provenance. A Customer historical opening could also be misreported as a source-current due even if counts and amounts agree. The previous separate source export/review gate is not cryptographic authentication; this comparator still must reject internally impossible source tuples before readback.

## Proposed minimal solution
Add an allowlist of source tuple **(`sourceGroup`, `basis`, `sourceField`, `kind`)** derived from `prepareGrossPartyBalances`'s original contracts:
- `CUSTOMERS`: SOURCE_CURRENT Current Due and HISTORICAL_OPENING Opening Balance, each with CUSTOMER_RECEIVABLE or CUSTOMER_ADVANCE (signed amount routes to distinct kind).
- `SUPPLIERS`: SOURCE_CURRENT Current Due and HISTORICAL_OPENING Opening Balance, each with SUPPLIER_PAYABLE or SUPPLIER_ADVANCE.
- `VENDORS`: only SOURCE_CURRENT Current Due → VENDOR_PAYABLE and SOURCE_CURRENT Current Receivable → VENDOR_RECEIVABLE. No historical opening checkpoint for Vendor.
- `FINANCE_PERSONS`: only SOURCE_CURRENT FINANCE_TRANSACTIONS.Amount → OWNER_EQUITY, OWNER_ADVANCE, LENDER_LOAN_PAYABLE, LENDER_CREDIT, BORROWER_LOAN_RECEIVABLE or BORROWER_CREDIT. Original Opening Owner Capital/Loan Finance transaction *events* are in this derived current bucket, not the Customer/Supplier historical balance bucket.
- `EXPENSE_PAYEES` has no gross account merely because it is a Payee identity role.

Run this **strict tuple guard on private expected source checkpoints** as the first index step, before examining caller-supplied readback. Any impossible tuple fails closed with the existing generic `Gross checkpoint parity unavailable` exception, never leaking Party/source identifiers or amounts. **Do not alter the readback mismatch behavior:** valid-but-different readback tuples continue to yield fixed `MISSING_CHECKPOINT`/`EXTRA_CHECKPOINT` stage counts instead of a new exception. Existing strict shape, safe integer, exact source ID, pinned source SHA, summary count, original kind totals, basis, no-DB-read on invalid source and immutable output guarantees remain.

## Scope
One new design and plan, one new focused Node test file, **one existing comparator JS file** with a minimal tuple contract. No new D1/account schema, production data, SQL migrations, Worker, RPC, auth, GAS/frontend, cash/bank, financial posting or cross-role settlement. No new dependencies. Other workstreams untouched. Local M02 D1 and full repo CI must pass at the PR's exact head. **No claim of production account reconciliation or human-authorized review.** `PARALLEL-MODULE-READY=false`.

## TDD evidence required
Commit spec + plan + regression tests only first. Observe actual GitHub Foundation RED due to **assertions detecting impossible tuple accepted**, not missing-module import. Then add the smallest allowlist to the existing comparator, commit GREEN, inspect exact-head Foundation, M02 Party/D1 + synthetic gross Workerd, M03, M04, M01 and Cloudflare PR-safety workflows. Remain draft/unmerged for owner. Revert PR to roll back.
