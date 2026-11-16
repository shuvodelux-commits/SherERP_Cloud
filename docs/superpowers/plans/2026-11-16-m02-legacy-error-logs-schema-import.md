# M02 — Frozen LOGS source schema + isolated offline D1 importer (2026-11-16)

**Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` — frozen `Config.gs`, `Utils.gs`. **Target base:** `SherERP_Cloud/main@32cc294965d33ae4db6964aae03f30e623b09ac7`. **Rules:** `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, ADR-007; GitHub-only RED→GREEN.

## 13-sentence overview

1. The next independent source group is the original `LOGS` error-diagnostic sheet.
2. Its frozen columns are Timestamp, Context and Message in that order.
3. The original `Utils.gs` `logError_` appends a date, diagnostic context and error text to this sheet.
4. LOGS has no source Log ID or guaranteed unique timestamp, so the D1 schema must never invent an external business ID or deduplicate on time.
5. An internal auto-increment key and optional unique physical source-sheet row provenance will preserve distinct historical entries, even if all three fields match.
6. Each original field will be stored as TEXT, with valid Date objects mapped explicitly to ISO text while existing textual bytes remain intact.
7. The migration uses a SQLite STRICT table and a nonunique timestamp lookup index, with no FKs or references to Party, auth, finance or transaction tables.
8. The pure mapper rejects unknown columns and accessor properties instead of coercing arbitrary objects.
9. The bounded whole-snapshot importer requires consecutive row provenance and refuses malformed or reordered snapshots before D1 writes.
10. A fixed SQL empty-target sentinel and the inserts share a single atomic D1 batch to refuse replay, partially populated targets and concurrent imports.
11. Exact source-to-D1 readback of every field and physical row must either reconcile the provided local fixture or report NEEDS_REVIEW after commit.
12. Node SQLite and actual isolated Workerd/D1 tests will prove duplicate preservation, validation, SQL rollback, replay and nonpublic routing using synthetic log entries.
13. This is not live Sheets collection, a production logging transport, remote D1 migration, financial audit conversion or verified full business-data reconciliation.

## Affected files and boundaries

- New `migrations/0006_legacy_error_logs.sql` and `src/db/legacy-error-log-mapping.js`, `src/db/legacy-error-log-import.js`.
- New Node/Workerd tests and PR-only isolated worker/workflow, no production secrets.
- Update fail-closed version-count/coverage/local-schema checks and the source coverage review; classify LOGS as **diagnostic-schema-only**, not catalog or reconciled.
- Do not change source GAS, live D1 or existing Worker HTTP/RPC, authentication, stock/finance posting, Party identity or UI.

## RED → GREEN

1. Commit source contract, missing-mapper/schema/importer regression tests and real-D1 fixture first, and record expected failing CI.
2. Add the minimal schema, fixed mapping and internal batch importer; update exact existing version-count assertions without masking failures.
3. Verify source pin, Node test suite, frontend build and all exact-head GitHub Actions (including Workerd/D1).
4. Owner review and merge only after all checks pass; staging/production D1 application is a separate explicit approval.
