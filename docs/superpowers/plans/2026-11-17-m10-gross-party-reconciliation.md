# M10-14 — Gross Party-account historical reconciliation (offline evidence)

**Owner:** M10 (issue #312; parallel board #456).
**Base:** `main@bcd2d3adbd03f35612c50c1a144a472b1683b412`.
**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Architecture:** `docs/architecture/ADR-007-unified-party-relationships.md`.

## Scope overview — 12 sentences

1. The M10 source-to-D1 gate currently trusts an externally supplied `grossParity` Boolean report rather than comparing every separate Party obligation itself.
2. The new offline evaluator compares supplied source and readback financial evidence by original source group, an opaque commitment to original source identity, account kind, contract and historical/current basis.
3. It deliberately distinguishes customer receivable/advance, supplier payable/advance, vendor payable/receivable, owner equity/drawings, lender loan payable and borrower loan receivable.
4. One Party may hold multiple roles, but none of their balances may be automatically netted or used as substitutes for one another.
5. Opening balances are historical baselines and are never treated as Cash Session turnover or live payments.
6. Balance amounts are exact signed BDT minor-unit integer strings, compared with `BigInt` instead of unsafe floating-point arithmetic.
7. Source and D1 captures must be separately identified, pinned to the original source commit and chronologically ordered.
8. Every per-account and per-contract row must appear exactly once on each side; missing, unexpected, duplicate and altered records fail closed.
9. The evaluator rejects unresolved identity reviews and unreviewed source-account plans, while refusing to invent a payable for a mere expense Payee identity.
10. Its discrepancy ledger reports only fixed issue codes and counts, never person IDs, names, account keys, money amounts, digests or private input exceptions.
11. Test-first cases cover gross-versus-net cancellation, opening/current basis shifts, vendor dual directions, loan/equity segregation, exact large values and malicious evidence.
12. Even perfect synthetic comparison is only candidate gross parity and does not authorize data import, source mutation, posting, settlement, staging migration or production cutover.

## File and dependency ownership

- **New, M10-only:** `src/migration/m10-gross-party-reconcile.js`, `tests/m10-gross-party-reconcile.test.mjs`, `docs/runbooks/M10_GROSS_ACCOUNT_REHEARSAL.md`, and this plan.
- **Read-only dependencies:** ADR-007, issue #312, 49-group frozen inventory, M02/M02-P source account/legacy-link mapping, M08 relationship ledger contracts. Rehearsal evaluator M10-01 remains unchanged pending a separately reviewed adapter to consume this proof.
- **No shared changes:** `src/db/**`, numbered migrations, `src/rpc/**`, `src/index.js`, Workers bindings/workflows, the shared posting/reversal kernel, private data, original GAS/Sheets or deployed state.
- **No SQL table, original ID or public RPC mutation** and no new financial writer.
- **Merge:** independent PR into `main`, verify test-first RED and minimal GREEN, full exact-head GitHub CI including local Workerd/D1 and policy suites, reviewed owner merge gate, verify landed main code.
- **Rollback:** revert four new module-only files; zero D1/data rollback.

## Exact supplied evidence contract

Top-level own-data fields: `source`, `d1`, `identityReviewsPending`, `sourcePlanReviewed`.
Each capture: `captureId`, `capturedAt`, `sourceCommit`, `accounts`.
Account: `sourceGroup`, `legacyIdDigest`, `accountKind`, `contractDigest`, `basis`, `currency`, `balanceMinor`.

- Allowed source mappings: `CUSTOMERS` → `CUSTOMER_AR`/`CUSTOMER_ADVANCE`; `SUPPLIERS` → `SUPPLIER_AP`/`SUPPLIER_ADVANCE`; `VENDORS` → `VENDOR_AP`/`VENDOR_AR`; `FINANCE_PERSONS` → `OWNER_EQUITY`/`OWNER_DRAWINGS`/`LENDER_LOAN_AP`/`BORROWER_LOAN_AR`.
- `EXPENSE_PAYEES` is **not** a financial payable without a separately documented obligation; no implicit entry.
- `basis` is `OPENING` or `CURRENT`; both must be compared independently, including negative historical values.
- Digests are externally supplied private commitments to authentic legacy IDs and contract identity, **not** proof that the commitments were derived honestly; original ID/ledger derivation and approved account-sign semantics remain M02/M08 dependencies.
- BDT amounts are canonical signed minor-unit strings with no negative zero or exponent; integers can exceed JavaScript safe-number size.
- Reject unrealistic or incomplete evidence in the gate, not by converting private values to a summary balance.

## Exit remains NO-GO

A synthetic positive proves only the deterministic comparison algorithm. M10 #312 still needs independently authorized private snapshot, actual full 49-group staged D1 reconciliation, gross Party opening/current sign review, transactions and rollback, security/performance, real recovery drill and written owner release decision.
