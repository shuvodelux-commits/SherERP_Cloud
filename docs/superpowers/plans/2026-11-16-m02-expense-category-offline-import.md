# M02 — One-shot Expense Categories snapshot import and local D1 reconciliation

**Base:** SherERP_Cloud/main@d33bbe17d46f1e62dc29ab0a4222d22ab5c198b3. **Frozen source:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2. **Dependency:** merged PR #301 schema `0005_expense_categories.sql`.

## 13-sentence design overview

1. The original ExpenseSettings.gs exposes EXPENSE_CATEGORIES as a five-column master independent of Expense transactions.
2. Its source headers are Category ID, Category Name, Description, Status and Created At.
3. The new D1 table already preserves these values and optional physical source-sheet row provenance.
4. We will add only an internal, one-shot offline importer for this group, not an HTTP or authenticated production import route.
5. The importer will accept only a complete bounded snapshot with every original field and its consecutive physical row index.
6. Empty names or IDs, non-text fields, absent/extra headers, invalid statuses, duplicate IDs and changed row order must fail before writing anything.
7. Duplicate category names remain distinct by their original IDs to avoid silently rewriting historical snapshots.
8. Values including Bangla text, whitespace in descriptions, Created At and blank status must survive exact field-by-field projection.
9. A fixed parameterized SQL INSERT and a same-batch empty-target sentinel will prevent overwrite or concurrent double import.
10. All rows will be inserted using an actual local Workerd/D1 atomic batch; a synthetic late SQL trigger must prove rollback.
11. A bounded full D1 readback will compare each original ID, value and source row index, reporting NEEDS_REVIEW on mismatch rather than claiming rollback after commit.
12. Synthetic Workerd tests will prove one concurrent winner, replay refusal, source immutability, readback mismatch detection and absence of public routes.
13. None of this constitutes authorization to read live Sheets, touch remote D1, migrate Expenses/Payees, launch finance posting or claim full business reconciliation.

## File and interface inventory

- New `src/db/expense-category-source-import.js`: pure preflight and isolated D1 offline import/reconciliation; reuses existing fixed mapper.
- New `tests/m02-expense-category-import.test.mjs`: source contract and rejection tests.
- New `tests/integration/m02-expense-category-import-workerd.spec.mjs`: atomicity and readback on actual local Workerd/D1.
- New `wrangler.m02-expense-categories-test.jsonc`, `tests/fixtures/m02-expense-categories-worker.mjs`: isolated nondeployable binding, no import HTTP route.
- New `.github/workflows/m02-expense-category-import-workerd.yml`: PR-only, no-secrets CI.
- Unchanged: all versioned migrations, source GAS, catalog importer/readers, production Worker/RPC, Party/finance/stock, remote staging and production D1.

## Superpowers RED → GREEN

1. Commit test and local fixture before importer; confirm the new GitHub Workerd job fails for the missing implementation.
2. Add minimal importer; keep SQL identifiers static and fail closed on unexpected input.
3. Run source/static Node tests and PR-only real local Workerd/D1 integration, recording exact HEAD evidence.
4. Review all CI on latest branch commit, mark the result as synthetic/offline only, request owner review; never self-merge or migrate remote data.
