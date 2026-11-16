# M02/M03 — Source Group to Versioned D1 Coverage Gate (2026-11-16)

**Workstream:** M02 schema/import inventory with M03 async closure cross-check. **Baseline:** `SherERP_Cloud/main@ee86bcf5142bd63b376cc9be6e4cc123841f8ded`; **original source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. No credentials or live data involved.

## Design overview (15 sentences)

1. The pinned original `Config.gs` defines 49 configured source data groups, and all 49 must ultimately be reconciled to D1.
2. Current `migrations/0001..` through `0004..` are foundation schemas, not evidence of a complete production import.
3. The migration audit must distinguish **partial catalog schema**, **Party identity-only mapping**, **local auth-only schema**, and **no source-specific versioned mapping**.
4. A versioned target table name only proves that the DDL exists, never that source row values, relationships, signs, dates or posting are correct.
5. The review should take its group names and column counts from the pinned `schema-inventory.json`, which is already checked against source `Config.gs`.
6. Source groups must never be inferred from similar names or tests with synthetic D1 tables.
7. For the current catalog foundation, SETTINGS, PRODUCT_CATEGORIES and PRODUCT_UNITS have named local target tables.
8. For the approved Unified Party foundation, CUSTOMERS, SUPPLIERS, VENDORS, FINANCE_PERSONS and EXPENSE_PAYEES have **only** an identity/role/legacy-link path, no gross accounting parity claim.
9. For M04, USERS, ROLES and SESSIONS have proposed local D1 auth tables without public activation or protected production source import.
10. The remaining source groups have no source-group mapping in the current versioned production candidate migrations.
11. The scanner must check that the mapped target table is truly created by versioned SQL rather than just mentioned in a comment.
12. It must fail when a mapped target disappears or the frozen source inventory drifts, so the report cannot silently remain green.
13. It will carry the existing M03 `394` impacted-function count as a **source-audit fact**, not as a count of completed async conversions.
14. The CLI emits a deterministic JSON report suitable for future integration work and does not change the deployed Worker, the empty RPC registry or D1.
15. Each follow-on conversion PR will replace partial status with separately reviewed real-Workerd source fixture reconciliation evidence, not a self-declared green flag.

## File/RPC/table impact inventory

- Add `scripts/audit-migration-coverage.mjs`, a pure mapper and read-only `--check` CLI.
- Add `tests/m02-m03-migration-coverage.test.mjs`, with red tests for all four classifications, source/SQL drift, and genuine frozen inventory counts.
- Add this plan and a human-readable report once output is verified.
- Read `legacy/source/Config.gs`, `docs/baseline/schema-inventory.json`, `docs/baseline/m03-async-caller-closure.json`, `docs/baseline/source-manifest.json`, and `migrations/0001..` `0004..`; do not update source or schema.
- **No RPC changes**, frontend changes, auth changes, SQL writes, money/stock/Cash/Bank/Party ledger effects, secrets, remote migration or Cloudflare deployment configuration.

## TDD and acceptance

1. Commit tests requiring a missing `buildMigrationCoverage` exporter and CLI; record the exact failing CI check as **RED**.
2. Implement the minimum read-only validator + deterministic `--check` / `--json` CLI and prove **GREEN** on current-head Node tests and GitHub checks.
3. Assert exactly 49 source entries, 3 partial catalog, 5 Party identity-only, 3 local-auth-only, 38 without source-specific versioned mapping, **zero fully reconciled**, and 394 source async-impacted functions.
4. Reject a mapped SQL table that is only commented out; reject duplicate or missing source groups, drifted source Config, bad source SHA and drifted async count.
5. No source-to-D1 financial write or remote-data test is claimed; this is a source/schema coverage **audit** only.
6. Open one scoped PR, request owner review, and keep all rollout gates unchanged.
