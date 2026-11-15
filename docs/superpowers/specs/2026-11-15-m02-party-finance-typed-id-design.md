# M02-P: Finance transaction source IDs must be literal strings

**Date:** 2026-11-15. **Workstream:** M02-P Party Import Validation, source-only gross account preflight. **Authority:** pinned Mohim_ERP SHA 29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2 (FinanceModule.gs), AGENTS.md, ADR-007. Depends on merged PRs #155 (exact Person ID provenance) and #165 (required Finance Amount).

## Defect
prepareGrossPartyBalances still converts Finance ID using String(value).trim() and Person ID with String(value). A numeric transaction Person ID can silently match a different string-typed master ID, falsely attributing its financial account. A numeric Finance ID can be accepted or collide with a valid string ID, suppressing a legitimate transaction as a purported duplicate. Furthermore, distinct string Finance IDs differing only in whitespace are trimmed together even though original source identity must be exact.

The original FinanceModule.gs writer generates Finance ID with generateId_('FINANCE_TRANSACTIONS') and stores a sanitized string Person ID, never an arbitrary numeric/object identifier. Names and phones are not fallback proof of financial identity.

## Chosen minimum correction
Require strict literal string type for non-deleted FINANCE_TRANSACTIONS Finance ID and Person ID. Preserve original nonblank strings byte-for-byte. Trim only when checking blank/missing. Missing/null/blank IDs keep FINANCE_ID_REQUIRED or FINANCE_PERSON_ID_REQUIRED; nonstring present values emit FINANCE_ID_INVALID_TYPE or FINANCE_PERSON_ID_INVALID_TYPE, fixed review codes with no raw identifying data. An invalid Finance ID must never mark another valid string ID duplicate. Exact duplicate strings remain FINANCE_ID_DUPLICATE. Deleted finance transactions are skipped before validating IDs as before.

Alternatives rejected: coercion or normalization (loses source identity), silently excluding bad transactions while marking readiness true, new financial D1 SQL/importer (owner/reviewer gated).

## Acceptance
1. Numeric/boolean/object Finance ID or Person ID blocks readiness with its respective INVALID_TYPE issue and produces no attributed balance.
2. A numeric Finance ID and a string ID with the same printed characters never collide; the valid string record still contributes its checkpoint while readiness is false.
3. Distinct nonblank string Finance IDs that differ only in whitespace are not duplicates and each contributes.
4. Missing, null, blank and identical repeated string IDs retain REQUIRED or DUPLICATE protections.
5. Valid Owner/Lender/Borrower amounts remain gross and independent; deleted rows ignored; inputs unchanged; reported issues contain only fixed sourceGroup/reason/provenance fields.
6. Test-first RED evidence then GREEN full GitHub CI, source hashes and preserved frontend.

## File ownership and release limits
One existing pure module src/party/gross-balance-preflight.js, one new test tests/m02-party-finance-typed-id-preflight.test.mjs, this spec and a short plan. No src/db, migration, Worker/RPC, auth, original GAS/UI, staging/production DB data, financial posting, Party auto-merge or settlement. Revert four-file PR if needed. PARALLEL-MODULE-READY stays false; offline preflight is not permission to import financial data.
