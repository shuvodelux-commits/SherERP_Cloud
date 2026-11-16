# M02 — Frozen SALES_DRAFT_AUDIT historical D1 slice

**GitHub base:** `SherERP_Cloud/main@c489b339cece536e95c59b0cba069515fdc5570f`; **frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (`Config.gs`, `DraftSales.gs`). Refer to `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md` and ADR-007.

## 13-sentence design overview
1. M02's next safely bounded source group is the historical `SALES_DRAFT_AUDIT` log.
2. Frozen `Config.gs` defines precisely Audit ID, Timestamp, Action, Draft ID, Draft No, Version, Actor ID, Actor Name, Source Owner ID, Invoice ID and Note.
3. The original `appendSalesDraftAudit_` records CREATED, UPDATED, DELETED, POSTED and POST_CLEANUP_RETRY under their original Audit ID.
4. The source also scans historical Draft No values to prevent reusing a posted or deleted draft number, so the D1 candidate must preserve them exactly.
5. We will retain the entire audit payload, original source ID and physical row provenance without adding foreign keys to live sales or users.
6. Timestamps are stored as source-preserving text, with valid native Date objects converted only when the offline source export provides Dates.
7. Source Version may be a positive safe integer or its exact positive decimal text, but must never be coerced to a floating-point financial value.
8. Blank source Audit IDs, unsupported actions, invalid Versions, row gaps, duplicate audit IDs and unexpected fields fail before D1 is touched.
9. A SQLite STRICT table and immutable UPDATE/DELETE triggers prevent the imported history from being casually rewritten or removed.
10. A one-shot internal importer uses fixed parameterized INSERT statements and an empty-table sentinel in a single D1 batch transaction.
11. Its full bounded readback compares every original identifier, field and physical row to the synthetic offline snapshot, signalling NEEDS_REVIEW after commit on mismatch.
12. GitHub test-first RED and real isolated Workerd/D1 GREEN cover source preservation, rollback on a later row, concurrent imports, replay refusal, immutable audit history and no public HTTP route.
13. This does not authorize production D1 migrations, access the original private Sheets, post sales, revive deleted drafts, or claim full historical business-data reconciliation.

## File boundaries / TDD
- Append migration `0008_legacy_sales_draft_audit.sql`; fixed mapper `src/db/sales-draft-audit-mapping.js`; one-shot offline importer `src/db/sales-draft-audit-import.js`.
- Add Node and real local Workerd/D1 tests, isolated nondeployable fixture and PR-only CI.
- Update frozen audit coverage, version-count assertions, local schema-verifier counts and the review matrix, without broadening source-import reconciliation claims.
- Commit tests/fixture first, confirm exact-head RED, then implement minimum code and verify all GitHub CI at final head. Owner reviews and merges.
- No source GAS/Sheets change, no Worker/RPC/preview deployment change, no Party/finance/stock/ledger mutation, no remote D1 apply.
