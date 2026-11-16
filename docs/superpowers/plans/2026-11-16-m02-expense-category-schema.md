# M02 — Source-verified Expense Categories D1 schema (2026-11-16)

**Branch/base:** `m02/expense-category-schema-20261116` from `main@920a019eaa686e84a308b927510555ee52877475`. **Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Read `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md` and ADR-007 first.

## 13-sentence design overview

1. M02 must preserve each of the 49 frozen source groups without inventing live schema coverage.
2. The current migrations contain catalog, Party identity and staff-auth foundations, but no expense-category table.
3. `ExpenseSettings.gs` maintains `EXPENSE_CATEGORIES` as a five-column master list.
4. Its original columns are Category ID, Category Name, Description, Status and Created At.
5. The approved scope is only this independent master group, not `EXPENSES` or `EXPENSE_PAYEES`.
6. A new append-only numbered migration will use a SQLite STRICT table with explicit stable source ID and optional physical source-row provenance.
7. Blank IDs or names, duplicate source IDs, duplicate physical rows and invalid status values will fail SQL constraints.
8. The source app rejects new duplicate category labels in its application logic, but SQL will not silently discard or combine preexisting duplicate historical labels.
9. Description, original status and original Created At strings will be preserved without timezone reinterpretation or financial coercion.
10. The frozen `Config.gs` inventory and a fixed allowlist mapper will reject unexpected or changed source headers.
11. M02/M03 coverage auditing will classify the added table as **catalog-schema-only**, not imported or reconciled.
12. Isolated local SQLite and GitHub local-D1 staging checks will prove migration and constraint behavior without touching remote D1 or source GAS.
13. M03 authenticated readers/writers, full snapshot import/reconciliation, production migration and actual expenses/cash posting remain separately gated.

## Scope / impact

- `migrations/0005_expense_categories.sql` — creates only `expense_categories`, source keys and indexes; zero financial tables.
- `src/db/catalog-mapping.js` — add fixed `EXPENSE_CATEGORIES` headers mapping; no new RPC or write function.
- `tests/m02-expense-category-schema.test.mjs` and existing mapping/coverage/staging tests — source and DDL proof.
- `scripts/audit-migration-coverage.mjs`, `tests/m02-m03-migration-coverage.test.mjs`, local schema verifier and local PR-only staging workflow — update exact reviewed baseline from 4 to 5 migrations; 4 catalog-only, 5 Party-identity-only, 3 auth-local-only, 37 unmapped; **zero fully reconciled**.
- `docs/reviews/2026-11-16-m02-m03-source-coverage.md` — reflect reviewed count, without claiming import readiness.
- No updates to original source files, Worker routes, auth, finance, Party identities/accounts, stock, preview D1 binding, production D1 or remote staging D1.

## Superpowers RED → GREEN sequence

1. Commit the failing Node regression *before* the migration/mapping (expected missing `0005` and missing mapper) and capture exact-head GitHub CI RED.
2. Add the smallest schema/mapping and update **only** baseline assertions tied to versioned schema count.
3. Run Node tests, frozen source checksum, frontend build and GitHub PR-local Workerd/D1 checks.
4. Recheck all CI workflows at the final branch head, and document anything not green.
5. Owner reviews/merges the PR; **do not apply remote D1 migrations**. Rollback before remote apply is revert of this PR; eventual remote change requires separate owner-approved backup and roll-forward procedure.

**Readiness:** not a complete M02 importer or a production ERP schema.