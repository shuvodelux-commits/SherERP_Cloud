# M02-P Finance export: reject Boolean Person ID cells

**Date:** 2026-11-15. **Authority:** pinned Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2, FinanceModule.gs, Config.gs, docs/baseline/schema-inventory.json, AGENTS.md, ADR-007. **Scope:** offline-only Finance Transactions source export completeness, not finance posting or import authorization.

## Evidence of defect
The existing validateFinanceTransactionExport checks all 20 original source columns, header order, declared row count, physical source positions, money precision and duplicate Finance IDs. It correctly flags numeric Finance ID and Person ID values as UNSAFE_IDENTIFIER, but treats a Boolean Person ID as a safe generic sheet cell. The missing Person ID counter only checks null, undefined and blank strings, so non-deleted Person ID=true or false can still produce offlineExportComplete=true. The original writer obtains a finance Person ID from an existing stable person master (a string) and never uses Boolean Party identity. The validator must not certify a Boolean ID, even for retained soft-deleted history.

## Chosen minimal correction
Mark Boolean Finance transaction Person ID as an UNSAFE_IDENTIFIER alongside numeric Person ID. Preserve the existing issue/count contract (no new code), exact original Person ID strings including zero prefixes, original numeric detection, null/blank active MISSING_PERSON_ID, deleted-row amount exemption, all existing source headers and financial account behavior. The generic cell validator may still allow Boolean values for genuine Boolean source columns like Is Deleted; reject only Boolean identity cells. Boolean Finance ID already fails as MISSING_FINANCE_ID and remains unchanged. This narrowly fixes a type-specific integrity hole without altering source row data, mapper semantics, D1 schema, authorizations or accounting.

## Acceptance
1. Both active Person ID=true and Person ID=false produce UNSAFE_IDENTIFIER count 1 and offlineExportComplete=false even when the export is otherwise complete.
2. The same invalid type on a soft-deleted source transaction is rejected, because the source row must remain provenance-valid even though its Amount may be blank.
3. String Person ID values 'true', 'false', '000123' remain unmodified and accepted by export *shape* validation; no identity merge/reconciliation is implied.
4. Numeric Person ID remains rejected; null/blank active Person ID remains MISSING_PERSON_ID; valid Boolean Is Deleted remains allowed.
5. Input rows/headers unchanged; outputs fixed counts/codes only, never values, names, phone or approval refs. Test-first GitHub RED -> GREEN and exact-head CI.

## File impact and rollback
Only src/party/finance-export-coverage.js, new tests/m02-finance-export-boolean-person-id.test.mjs, this spec and a TDD plan. No src/db, migrations, RPC, Worker, staging/prod DB, original GAS/UI, account posting, cash/bank, approval or cross-role settlement. Existing parallel PRs own finance gross preflight, Party readback, rehearsal and M03/M04/M05 files. Revert four PR files for rollback. Offline completeness is not permission for production financial cutover or PARALLEL-MODULE-READY.
