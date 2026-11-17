# M10-14 — Gross Party-account historical reconciliation (offline evidence)

**Owner:** M10 (issue #312; parallel board #456).
**Base:** `main@bcd2d3adbd03f35612c50c1a144a472b1683b412`.
**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Architecture:** `docs/architecture/ADR-007-unified-party-relationships.md`.

## Scope overview — 12 sentences

1. The M10 source-to-D1 gate currently trusts an externally supplied `grossParity` Boolean report rather than comparing every separate Party obligation itself.
2. The new offline evaluator compares supplied source and readback financial evidence by original source group, an opaque commitment to original source identity, M02 account kind, original balance field and historical/current basis.
3. It deliberately distinguishes customer receivable/advance, supplier payable/advance, vendor payable/receivable, owner equity/advance, lender loan payable/credit and borrower loan receivable/credit.
4. One Party may hold multiple roles, but none of their balances may be automatically netted or used as substitutes for one another.
5. Opening balances are historical baselines and are never treated as Cash Session turnover or live payments.
6. Balance amounts are exact signed BDT minor-unit integer strings, compared with `BigInt` instead of unsafe floating-point arithmetic.
7. Source and D1 captures must be separately identified, pinned to the original source commit and chronologically ordered.
8. All six source-supported coverage domains and each present account row must appear on each side; missing, unexpected, duplicate and altered evidence fails closed.
9. The evaluator rejects unresolved identity reviews, source-sign conflicts and unreviewed account plans, and refuses to invent a payable for an expense Payee identity.
10. Its discrepancy ledger reports only fixed issue codes and counts, never person IDs, names, account keys, money amounts, digests or private input exceptions.
11. Test-first cases cover gross-versus-net cancellation, missing opening domain attestations, vendor dual directions, loan/equity segregation, exact large values and malicious evidence.
12. Even perfect synthetic comparison is only candidate gross parity and does not authorize data import, source mutation, posting, settlement, staging migration or production cutover.

## File and dependency ownership

- **New, M10-only:** `src/migration/m10-gross-party-reconcile.js`, `tests/m10-gross-party-reconcile.test.mjs`, `scripts/m10-gross-party-check.mjs`, `tests/m10-gross-party-cli.test.mjs`, `docs/runbooks/M10_GROSS_ACCOUNT_REHEARSAL.md`, and this plan.
- **Read-only dependencies:** ADR-007, issue #312, 49-group frozen inventory, M02/M02-P source account/legacy-link mapping, M08 relationship ledger contracts. Rehearsal evaluator M10-01 remains unchanged pending a separately reviewed adapter to consume this proof.
- **No shared changes:** `src/db/**`, numbered migrations, `src/rpc/**`, `src/index.js`, Workers bindings/workflows, the shared posting/reversal kernel, private data, original GAS/Sheets or deployed state.
- **No SQL table, original ID or public RPC mutation** and no new financial writer.
- **Merge:** independent PR into `main`, verify test-first RED and minimal GREEN, full exact-head GitHub CI including local Workerd/D1 and policy suites, reviewed owner merge gate, verify landed main code.
- **Rollback:** revert six new module-only files; zero D1/data rollback.

## Exact supplied evidence contract (aligned to existing M02 source checkpoint)

Top-level own-data fields: `source`, `d1`, `identityReviewsPending`, `sourcePlanReviewed`.
Each capture: `captureId`, `capturedAt`, `sourceCommit`, `domains`, `accounts`.
Account: `sourceGroup`, `legacyIdDigest`, `accountKind`, `sourceField`, `basis`, `currency`, `amountMinor`.

**The accepted 12 kinds are exactly the existing M02 `src/party/gross-checkpoint-parity.js` kinds**, not a new M10 financial account vocabulary:

- `CUSTOMERS`: `CUSTOMER_RECEIVABLE`, `CUSTOMER_ADVANCE` on `Current Due` (SOURCE_CURRENT) or `Opening Balance` (HISTORICAL_OPENING).
- `SUPPLIERS`: `SUPPLIER_PAYABLE`, `SUPPLIER_ADVANCE` on `Current Due` (SOURCE_CURRENT) or `Opening Balance` (HISTORICAL_OPENING).
- `VENDORS`: `VENDOR_PAYABLE` on `Current Due`, `VENDOR_RECEIVABLE` on `Current Receivable`; SOURCE_CURRENT only.
- `FINANCE_PERSONS`: `OWNER_EQUITY`, `OWNER_ADVANCE`, `LENDER_LOAN_PAYABLE`, `LENDER_CREDIT`, `BORROWER_LOAN_RECEIVABLE`, `BORROWER_CREDIT` on `FINANCE_TRANSACTIONS.Amount`; SOURCE_CURRENT only.
- `EXPENSE_PAYEES`: identity role only, no implied payable.
- Six required coverage domains are the four CUSTOMER/SUPPLIER CURRENT+OPENING pairs and VENDOR/FINANCE CURRENT. A domain assertion makes an empty account set explicit, without inventing zero rows for original source balances. **The assertion must be grounded in an approved source/D1 reader**, not trusted solely because its Boolean claims to be reviewed.
- M02 derives signed positions into one *positive* source account direction (receivable/payable) **or** its corresponding advance/credit kind for the same original source account, not both in a single source channel. Historical negative balances do not become today's Cash or Bank.
- `amountMinor` is a strictly positive canonical decimal integer string (up to 38 digits), never a floating-point BDT amount. Zero source balances result in no checkpoint row, but the required domain must still be attested.
- `legacyIdDigest` is an externally supplied SHA-256 commitment to original ID identity, not a fabricated Party ID. This M10 contract **does not** require a `contractDigest` not provided by the current M02 checkpoint shape. Future contract-level loan subaccounts require a separately reviewed M02 schema/identity contract.
- Historical-source row identity, amount sign interpretation, mapping of original finance persons/transactions, and receipt provenance remain external M02-P/M08 reviewer obligations. Test fixture positives never certify real source data.

## Local operator preflight (nondeployable)

The additive `scripts/m10-gross-party-check.mjs` accepts exactly one explicit local regular JSON evidence file and prints only the redacted issue-count report from this module. It never reads from a D1 binding, fetches any source Sheet or writes a file. It rejects flags, missing files, symlinks, malformed input and failed parity with exit code 2; zero means candidate-only offline comparison, **not a GO decision**. Seven synthetic CLI tests cover positive evidence, mismatch, privacy, argument handling and symlink rejection, in addition to 20 isolated comparator tests. A real private input requires separate explicit authorization; no production/private fixture is committed or sent to GitHub Actions.

## Exit remains NO-GO

A synthetic positive proves only the deterministic comparison algorithm. M10 #312 still needs independently authorized private snapshot, actual full 49-group staged D1 reconciliation, gross Party opening/current sign review, transactions and rollback, security/performance, real recovery drill and written owner release decision.
