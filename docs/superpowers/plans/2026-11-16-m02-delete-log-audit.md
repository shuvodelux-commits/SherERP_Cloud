# M02 — Frozen DELETE_LOG history schema and isolated offline import
**Base:** SherERP_Cloud/main@00e25f074c56da00dcdb7aa54c315b6e72770a6d. **Frozen source:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2. Read AGENTS.md, MIGRATION_PLAN.md, WORKSTREAMS.md and ADR-007.

## 13-sentence design overview
1. The next isolated M02 source group is DELETE_LOG, a historical audit record rather than a deletion service.
2. Frozen Config.gs defines Log ID, Date, Time, Module, Record ID, Invoice No, Reason, Deleted By and Deleted By Mobile, in exactly that order.
3. Config.gs allocates the DEL prefix to DELETE_LOG, but no fabricated or reassigned source ID is allowed.
4. Database.gs treats Deleted By Mobile as a phone-text column, so this importer will preserve existing string leading zeros and never coerce numeric phones.
5. Each row receives an internal SQLite integer key and separately retains its unique original Log ID and physical source-sheet position.
6. All nine source fields will remain TEXT so original reference strings and written explanations are not converted to financial amounts or dates.
7. Source values that are missing, malformed or ambiguous will fail closed for later review rather than being silently repaired.
8. A numbered SQLite STRICT table will enforce original identity and provenance constraints and disallow UPDATE or DELETE of imported audit history.
9. No foreign key to a Party, invoice, cash account, stock lot or user is introduced because historical references must not be rebound.
10. A fixed mapper and bounded full-snapshot importer will reject wrong headers, accessors, duplicate Log IDs, row gaps and unexpected values before D1 writes.
11. An empty-table guard and all row inserts will execute within one real local D1 batch, preventing concurrent replay and partial imports.
12. Tests will demonstrate original data readback, SQL failure rollback, append-only triggers and closed HTTP routes in a nondeployable Workerd fixture.
13. This is not source business-data export, financial posting, a live deletion implementation, production D1 deployment or full historical reconciliation.

## Impact boundaries
- New migration 0007, pure fixed mapper, internal one-shot importer, Node/real-Workerd tests and separate PR-only fixture.
- Update exact migration-count and coverage gates, review doc, local D1 schema validation; LOGS stays diagnostic-only and DELETE_LOG becomes audit-schema-only.
- No changes to legacy GAS, actual Sheet data, publicly bound Worker/RPC, financial state, UI or remote D1.
- TDD: commit missing-module/schema tests and capture RED CI, then add minimal implementation and check all affected GREEN CI. Owner reviews/merges only after exact-head checks pass.
