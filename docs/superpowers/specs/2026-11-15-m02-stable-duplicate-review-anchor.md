# M02-safe — Deterministic duplicate legacy ID review provenance

**Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Authority:** `AGENTS.md`, `docs/MIGRATION_PLAN.md`, ADR-007. **Workstream:** offline M02 Party import validation only.

## Existing defect
The planner correctly quarantines every row with the same *exact literal* `[sourceGroup,sourceId]` identity. Yet its one `DUPLICATE_ID` review currently uses `byKey.get(key)[0]` to obtain `legacySheetRow`, which varies if an exported array is reordered. The review ID remains stable but its physical source row provenance can drift. Reordered source data is common in offline reconciliation and must not silently change a review record's physical anchor. Do NOT normalize padded source IDs: current Finance Person contracts explicitly require `FIN-001` and ` FIN-001 ` to remain distinct until human review.

## Acceptance
For exact duplicate source IDs in the same source group, identify one deterministic, non-mutating review anchor: select the smallest supplied *safe integer* `_rowIndex` (>=2); if none has physical row metadata, retain `null`. Preserve the exact group and raw source ID as-is, the same `reviewId`, and exactly one OPEN `DUPLICATE_ID` review. Quarantine **all** duplicate records regardless of input order; the plan must not contain a Party/link for a duplicate source. Source groups remain independent. Missing-name duplicates must not create a second `OTHER` review. An optional missing row position must not hide an available numbered row. Never assign a new row index or mutate a source record.

## Safety
Pure planner and offline tests only. Real local Workerd/D1 preflight test must reject either source order before preparing any SQL statement, with unchanged D1 rows. No `src/db`, SQL/migrations, M04 reviewer permissions, financial postings, original GAS/HTML, Worker RPC, preview bindings, staging/prod D1 or schema changes. The current approval reference and authenticated reviewer migration gates remain. `PARALLEL-MODULE-READY=false`.
