# M10 — Materialized synthetic SQLite migration / recovery rehearsal

**Workstream:** M10 / issue #312 / coordination #456. **Base main:** `872ca8560906afe9dfd2ee8e7e8e80be4a597158`. **Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Implementation overview (12 sentences)
1. Existing M10 gates compare supplied metadata and digests but do not themselves materialize and restore a disposable SQLite database.
2. This isolated M10 step exercises the operational *shape* of a backup and recovery rehearsal without handling original or customer data.
3. The 49 frozen inventory group names determine 49 fabricated group records with two rows each.
4. The generator retains synthetic source IDs for ordinary groups and NULL original IDs for legacy LOGS, which relies on physical row positions.
5. Fabricated payloads include leading-zero text, amount-as-text, date-as-text, deletion flags, and tile-unit markers to detect storage representation changes.
6. The first import uses a local in-memory SQLite transaction and scans its materialized rows back to the synthetic source.
7. Repeated import of the same rows must be idempotent and must not create duplicates.
8. A deliberately conflicting retry containing a partial extra insertion must fail as a single transaction and leave the database unmodified.
9. SQLite's local backup function copies the in-memory source to a temporary backup file, which is reopened and independently scanned.
10. The backup is copied to a separate restored SQLite file that is opened, fault-injected and scanned again.
11. Missing rows, extra rows, changed row contents, synthetic ID drift and LOGS positional drift must produce only fixed aggregate diagnostic codes.
12. A clean synthetic rehearsal authorizes neither real import, real Cloudflare D1 writes, genuine backup restoration, external source validation nor production cutover.

## Scope, prerequisites and file ownership
- **Only NEW files:** `src/migration/m10-synthetic-sqlite-recovery.js`, `tests/m10-synthetic-sqlite-recovery.test.mjs` and this plan.
- **Read-only dependency:** `docs/baseline/schema-inventory.json`; frozen canonical source SHA above.
- **Out of scope:** `src/db/**`, `migrations/**`, `staging-migrations/**`, `src/rpc/**`, `src/index.js`, M03 workerd, M02 import tooling, auth, ERP UI, private backups and remote D1.
- **Side effects:** `node:sqlite` with a disposable in-memory database, two *fabricated* temporary SQLite files and cleanup in `finally`. No network call, Cloudflare credential, source workbook access, real-data import or permanent output file.
- **Test runtime:** Node >=22, using built-in `node:sqlite` including the local `backup` API; no added production dependency or CI workflow.
- **Explicit limitation:** The 49 group names are source inventory labels, not operational D1 tables or a migration from actual GAS/Sheets. This is not proof that the actual historical data or operational schema can be imported. The real 49-group D1 readback and independent Party/FIFO/returns/cash accounting reconciliation remain open.

## RED → GREEN → QA → Review
- **RED:** test-only commit `c53da6dc691b6189b99f803bf10fe8815497c96f` on draft PR #736 imports the absent new module and deliberately fails module resolution; GitHub Actions evidence must be read separately.
- **GREEN:** commit `2fe4c3003912e6042c581cc61fe217061a9a6716` adds the smallest isolated materialized test runner; 11 focused tests passed on an offline local synthetic prototype under Node 22.16.0 (not a real source/D1 rehearsal).
- **QA:** Run `node --test tests/m10-synthetic-sqlite-recovery.test.mjs`, full foundation `node --test`, `npm run verify:source`, and all required exact-head GitHub CI checks. Recheck current PR base, conflicts and active reservations.
- **Independent review:** Confirm a synthetic-only runner, stage-by-stage row evidence, rollback atomicity, local backup/restore readback, redacted diagnostics and cleanup; do not approve external migration or remote D1.
- **Merge:** Human approval only, after green exact-head CI and reviewers. Rollback by reverting the three files; no data or schema rollback required.
