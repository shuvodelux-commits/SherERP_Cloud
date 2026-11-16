# M02 — Frozen STOCK_LOT_COST_CORRECTIONS immutable source history

**Base:** SherERP_Cloud/main@0f1adc86c89d7eeb504ae516c876ddf8c5265b9c. **Frozen source:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2; Config.gs + StockLots.gs. Follow AGENTS.md, docs/MIGRATION_PLAN.md, docs/WORKSTREAMS.md, ADR-007, and Superpowers test-first delivery.

## 13-sentence overview
1. The next isolated M02 group is the frozen STOCK_LOT_COST_CORRECTIONS history.
2. Config.gs defines exactly sixteen columns from Correction ID to Created At.
3. StockLots.gs appends records after original stock-lot purchase-price and historical sale-cost updates.
4. These historical rows are evidence, not authorization to rerun cost updates or change current inventory valuation.
5. The new independent SQLite STRICT audit table will retain every field and original physical sheet row.
6. Original Correction ID must remain the unique import key without inventing replacement identifiers.
7. Original monetary amounts, quantities, counts, signed historical COGS deltas and blank fields are stored as descriptive text, not recomputed.
8. Native Date values may map to ISO strings, while existing date strings must remain unmodified.
9. This archive does not add foreign keys to active stock lots, products, sales, suppliers or accounting tables.
10. Immutable SQL triggers prohibit UPDATE or DELETE, preserving audit history once loaded.
11. Import is internal only, bounded to 1000 rows, fails closed on duplicate IDs, missing or extra fields, invalid values or gaps, and atomically guards an empty D1 target.
12. Postcommit readback verifies each source position and all sixteen field values, returning NEEDS_REVIEW on mismatch rather than claiming rollback.
13. GitHub RED → GREEN Node and actual isolated local Workerd/D1 tests prove these boundaries without touching production Cloudflare D1, private Google Sheets, live posting logic or public RPC.

## Execution
- Test-first RED commit: source shape, immutable SQL, exact cost text, atomic rollback, replay/conflict and no public route assertions.
- GREEN commit: migration 0011, pure mapping, one-shot offline importer, frozen coverage and exact local schema checks (including existing M03/M04 gates).
- 49 total groups remain, audit-schema-only becomes 5, unmapped becomes 31 and fully production-reconciled remains 0; synthetic test success is not proof of business-data migration.
- Owner reviews after full exact-HEAD CI, no automatic merge.
