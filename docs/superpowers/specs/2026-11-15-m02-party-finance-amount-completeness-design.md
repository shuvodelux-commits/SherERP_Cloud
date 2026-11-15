# M02-P Party import: Finance transaction amount completeness (offline preflight)

**Date:** 2026-11-15. **Workstream:** M02-P Party Import Validation. **Original authority:** frozen `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, original `FinanceModule.gs` finance transaction writer `isValidNonNegativeNumber_(payload.amount)`, `Number(payload.amount)<=0`, and roundMoney-positive check; `AGENTS.md`, ADR-007, existing gross Party preflight. **Dependency:** merged PR #155 exact source Finance Person IDs.

## Defect
Current source-only `prepareGrossPartyBalances({sourceRows,approvedGroups,financeRows})` calls `toMinorUnits(row['Amount'])` on each non-deleted recognized Finance row. `toMinorUnits` deliberately permits absent/null/empty values as zero for optional **master opening and current balance cells**, but this default is not valid for an **active finance transaction Amount**. Consequently an active `FINANCE_TRANSACTIONS` row with missing `Amount`, `null` or `''` can silently pass without any ledger checkpoint and still return `readyForAccountDesignReview:true`. An explicit zero amount is similarly accepted. This disguises missing financial data as a certified zero obligation.

## Selected design
Preserve `toMinorUnits` for master columns and the existing exact Finance Person ID / role / signed-bucket algorithms. At the point where a valid, non-deleted Finance transaction amount is read, require explicit nonblank `Amount` (non-null, non-undefined, not whitespace-only), and a **strictly positive** value in safe integer BDT minor units. Missing/blank values produce the existing redacted `blockingIssues` form with new fixed code `FINANCE_AMOUNT_REQUIRED`; explicit zero produces `FINANCE_ZERO_AMOUNT`; negative continues to emit the existing `FINANCE_NEGATIVE_AMOUNT`. No amounts, phones, names, Finance IDs, reviewer data, or SQL details are included in the new issues. Invalid numeric precision and nonfinite amounts remain rejected by the existing converter. Preserve `deletedFinanceRows` skip (a historical deleted row need not have a valid amount to change no current balances).

Alternatives rejected: globally disallow empty master balance fields (changes unrelated source semantics); coerce an incomplete transaction to a default amount (financial data invention); drop an invalid row silently (concealed corruption); introduce D1 financial importer/SQL (unapproved shared posting and cutover).

## Acceptance
1. Missing, explicit `undefined`, `null`, `''` and whitespace-only Finance Amount block readiness with `FINANCE_AMOUNT_REQUIRED`, no fabricated checkpoint.
2. Explicit `0`/`'0.00'` Finance Amount blocks with `FINANCE_ZERO_AMOUNT`; negative continues to emit `FINANCE_NEGATIVE_AMOUNT`.
3. Valid positive Finance Amounts in distinct Owner/Lender/Borrower accounts preserve exact original ID attribution and independent non-netted integer minor-unit checkpoints. A mix of valid and missing amounts retains the valid checkpoint while blocking overall readiness.
4. Deleted finance rows are counted but do not post/checkpoint, including deleted rows with blank amounts.
5. Amount/source inputs and review evidence are never changed; output never carries original names, phone, or raw finance amount; no D1, RPC or remote data.
6. GitHub Superpowers TDD RED (actual expected assertion failures) before minimal GREEN, then full GitHub Foundation Node/source/frontend and existing PR CI on exact head.

## Scope / rollback
Only one existing pure `src/party/gross-balance-preflight.js` and one new Node regression `tests/m02-party-finance-amount-completeness.test.mjs` plus this spec and corresponding implementation plan. No dependency, migration, schema, Worker RPC, auth, frontend, original GAS/Sheets, remote/staging/prod D1, production customer data, financial write, cash movement, role auto-link or cross-role settlement. **Rollback:** revert four-file PR. A green source-only preflight is not a real D1 finance reconciliation, authenticated approval, or production import authorization; `PARALLEL-MODULE-READY` stays false.
