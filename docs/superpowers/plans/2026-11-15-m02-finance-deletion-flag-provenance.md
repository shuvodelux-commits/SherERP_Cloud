# Superpowers TDD Plan — M02-P Finance Soft-Delete Marker Validation

> Use Superpowers `test-driven-development`, `executing-plans`, and `verification-before-completion`; commit failing regressions before production code, observe GitHub RED, implement minimal GREEN, retest all exact-head CI.

**Goal:** Fail closed on ambiguous Finance Transactions soft-delete marker source values before offline gross financial reconciliation.
**Architecture:** Add a narrow `validDeletionFlag` predicate in the existing pure read-only `validateFinanceTransactionExport`; count invalid `Is Deleted` values as the established fixed-code `UNSAFE_VALUE`. Do not change `softDeleted` interpretation, gross account preflight, or persisted data.
**Tech:** Node ESM `node:test`, frozen schema inventory, GitHub Actions, local Workerd/D1 CI.
**Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Spec:** `docs/superpowers/specs/2026-11-15-m02-finance-deletion-flag-provenance-design.md`.

### Task 1 — Reproduce and fix ambiguous source deletion flags

**Files:** `src/party/finance-export-coverage.js`, new `tests/m02-finance-deletion-flag-provenance.test.mjs`, spec, plan.

1. **RED:** Commit direct synthetic Finance transaction export tests with 20 exact original columns and declared counts; invalid numeric/string flags must fail export completeness with `UNSAFE_VALUE`, two bad markers count two; controls for valid blank/null/boolean/TRUE/FALSE and deleted rows with blank Amount, exact IDs/row numbers, preserved inputs and redacted issues. Observe actual GitHub Foundation RED for only the intended new tests.
2. **GREEN:** Add a small private deletion-marker predicate accepting only null, boolean, blank or trimmed case-insensitive `TRUE`/`FALSE`. Combine with existing generic cell validation for `Is Deleted` inside one conditional. No new public API, dependencies or writing paths.
3. **Verify:** Exact-head Foundation Node suite, 84 pinned source files, 36 original includes, M02 Party identity/review/gross/staging local D1, M03 runtime Workerd/D1, M04 auth, M01 Chromium, M09 source parity and Cloudflare no-secrets safety. Record all run IDs and their actual conclusions.
4. **Review:** Four-file patch and absence of overlap with other active PRs, issue code/count redaction, no D1/import/posting impact. Leave as draft pending all CI green and owner review; rollback by PR revert. `PARALLEL-MODULE-READY=false`.
