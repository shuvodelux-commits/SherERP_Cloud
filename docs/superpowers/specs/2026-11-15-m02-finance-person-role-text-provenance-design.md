# M02-P — Finance Person source role type provenance

**Authority:** `AGENTS.md`, M02-P in `docs/WORKSTREAMS.md`, owner-approved ADR-007 and immutable `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (original `FinanceModule.gs`).

## Root cause

The original ERP writes `FINANCE_PERSONS.Roles` as canonical comma-delimited **text** and `FINANCE_PERSONS.Person Type` as **text** (FinanceModule.gs, `addFinancePerson` and `updateFinancePerson`). Its `financePersonRoles_` interprets `Roles` first, falls back to legacy `Person Type`, and finally uses historical `Owner` as a last fallback. The M02-P `validatePartyExportCompleteness` accepts any finite numeric or boolean cell value in these two fields. A corrupted export can therefore pass source completeness with `Roles: true` or `Person Type: 123`, after which role parsing silently uses another value or the historical Owner fallback, undermining identity/financial-role evidence.

## Design

Require `FINANCE_PERSONS.Roles` and `FINANCE_PERSONS.Person Type` to be **string or null**, preserving original empty string and nullable legacy exports. Existing canonical role parsing and Owner fallback are untouched; do not validate or rewrite role contents, coerce values, assign a role, invent review evidence, or infer identity. All other export group fields retain existing types, notably numeric Customer/Supplier/Vendor balances.

Use the existing redacted `UNSAFE_VALUE` issue and `counts.unsafeValues`; no new report fields or issue codes. Reject numerical or boolean values for these two finance role fields even if both fields are present and the source export headers are otherwise correct. Gate occurs offline before `validatePartyImportCandidate` can reuse approvals, compare snapshots or design financial accounts.

## Acceptance

- Numeric and boolean `Roles` cannot pass `offlineExportComplete`; issue `FINANCE_PERSONS / UNSAFE_VALUE`.
- Numeric and boolean `Person Type` cannot pass either.
- If both are corrupted, unsafe field count is two; no transaction/account posting.
- Text `Roles` and textual `Person Type`, including blank historical values, remain unchanged, with their existing Owner/Lender/Borrower interpretation.
- Null/empty nullable legacy fields remain eligible for the existing review/fallback policy (not implicit approval).
- Numeric source balance cells outside finance roles remain valid, all exports/diagnostics redact identity and monetary data, and validation does not mutate inputs.
- GitHub TDD RED before source modification; full exact-head GREEN verification through Foundation, source/UI checks, local Workerd/D1 and Cloudflare PR safety.

## Scope and non-goals

Only `src/party/export-column-coverage.js` (two field names in one existing validation clause), `tests/m02-finance-person-role-type-coverage.test.mjs`, this spec and implementation plan. No D1 writer, schema, RPC, authentication, original GAS/Sheets/UI, cash/Bank/ledger posting, cross-role settlement or production import/cutover. Revert the PR to roll back. `PARALLEL-MODULE-READY=false`.
