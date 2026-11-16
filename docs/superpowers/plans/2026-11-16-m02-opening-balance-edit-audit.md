# M02 — Frozen OPENING_BALANCE_EDIT_LOG immutable D1 history

**Branch base:** `SherERP_Cloud/main@cd798b3325a62b13fbc9d45805804a85c78b59df`. **Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `Config.gs`, `OpeningBalance.gs`. Read `AGENTS.md`, `docs/MIGRATION_PLAN.md`, ADR-007 and `docs/WORKSTREAMS.md`.

## 13-sentence design overview
1. The next M02 migration increment is original `OPENING_BALANCE_EDIT_LOG` historical correction evidence.
2. Frozen `Config.gs` lists 12 headers: Audit ID, Changed At, Entity Type, Entity ID, Entity Name, Old Opening Balance, New Opening Balance, Delta, Current Due Before, Current Due After, Reason and Changed By.
3. `OpeningBalance.gs` writes this log only after modifying customer or supplier master, ledger and historical opening cash entries, so its archival rows must never be treated as a posting API.
4. Original Audit ID values and physical source-sheet rows remain separate, immutable provenance keys; no generated substitute source IDs are permitted.
5. The candidate SQL will be an independent SQLite STRICT table with original historical values held as TEXT, including signed and negative amounts.
6. Source numeric values may become finite safe decimal text, while original string forms such as `-0.00` must remain unchanged.
7. Native Date source values may be converted to ISO strings, while original Changed At string values remain byte-for-byte intact.
8. No automatic validation of Delta against old/new balances will alter or reject historical evidence based on current accounting rules.
9. Empty, duplicate, ambiguous, accessor-based, unexpected-field or out-of-order source records will fail closed before any D1 writes.
10. Database triggers will forbid UPDATE or DELETE of imported opening-balance audit history.
11. One atomic local D1 batch will enforce a fresh-target sentinel and insert the complete bounded prevalidated source snapshot.
12. Postcommit readback compares every source field and physical row exactly, reporting NEEDS_REVIEW without pretending to roll back committed data.
13. We will prove the boundary in test-first GitHub RED/GREEN Node and actual Workerd/D1 tests without touching production Sheets, remote D1, Party financial accounts, cash sessions, posted balances or public RPC.

## Execution boundaries
- New `0010` migration, fixed source mapper and internal one-shot offline importer, test-only Workerd configuration, Node and D1 checks.
- No FK to Party, Customer, Supplier, cash book or ledger; do not infer identity.
- Update exact schema count and 49-source-group coverage baselines: audit-schema-only grows from 3 to 4, unmapped decreases from 33 to 32, fully reconciled remains **zero**.
- Commit tests and isolated CI first; prove intentional `ERR_MODULE_NOT_FOUND` RED. Then add minimal GREEN implementation, resolve failures and keep PR unmerged until all exact-head checks succeed.
