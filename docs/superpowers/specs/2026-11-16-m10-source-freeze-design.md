# M10-03 — Two-pass source freeze and final-source binding

**Source:** Mohim_ERP pinned `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Parent:** M10-01 merged #311; M10-02 merged #316. **Tracker:** #312.

## Problem and scope
M10-01 accepts matching supplied source/D1 digest summaries without checking that the source did not change between successive captures. Active GAS/Sheets writes or inconsistent exports can change row counts, values and original IDs during a rehearsal, and a stale comparison can mask lost data. M10-03 introduces a conservative **offline evidence-only** double-capture check. Nothing in this increment exports live Sheets, freezes real writers, executes SQL, or approves cutover.

## Input contract
`assessM10SourceFreeze({inventory,firstPass,secondPass,finalSourceSummary})`: frozen 49-group inventory plus two independently supplied capture manifests. A manifest is exactly:
`{snapshotId,capturedAt,sourceCommit,groups}`. Snapshot IDs are distinct canonical ASCII tokens (8–64 bytes, `[A-Za-z0-9_-]`); capture timestamps are valid millisecond-precision UTC ISO instants, second strictly later than first; both `sourceCommit` fields must match the pinned original source commit. Each `groups` array has one summary per configured group in M10-01's `{sheetKey,rowCount,rowDigest,idDigest}` contract. All 49 groups are required (even zero-row groups); zero row count is legitimate; group ordering is immaterial. `finalSourceSummary` must exactly match second pass and is the summary that M10-01 compares to D1.

Validate exact manifest and group keys, unique reviewed group names, integer nonnegative counts and lowercase SHA-256 shape; unexpected columns or malformed metadata throw only `M10 source freeze evidence invalid`. Missing first/second/final inputs produce blocked fixed-code issues, not a synthetic green. For validly shaped evidence that differs, report fixed-code counts only.

## Safety / non-goals
- No source record, original ID, amount, digest value, snapshotId or private field appears in returned results or error messages.
- A matching pair is only **supplied summary consistency**, not proof that either export came from Sheets or that there were no writes between them. A future owner-approved export run and bounded GAS write-freeze remain required.
- `assessM10RehearsalEvidence` must fail closed without passing stable two-pass evidence, and must reject a final source summary not equal to the second capture. It remains `authorizesImport=false` and `productionReady=false` regardless of synthetic matching evidence.
- Separate gross Party accounts, all 49-group full D1 import, transactions, auth/security, performance p95/D1 budgets, restore drill and owner sign-off remain blocking.
- This work owns only `src/migration`, `tests/m10-*test.mjs`, and docs. No shared D1 schema, posting kernel, RPC, frontend, Cloudflare binding or source changes.
- Synthetic test fixtures only. No secrets/production data in GitHub or CI.

## Options considered
1. **Chosen:** pure source-freeze evidence comparator and wired M10-01 fail-closed gate. Smallest reviewable safety improvement.
2. Add a full live export operator now: prohibited without source authorization, 49-group readiness and owner write-freeze procedure.
3. Declare a single source/D1 digest match sufficient: fails to detect changes during export and permits stale comparisons.

## Acceptance
Two identical, distinct-time complete captures and matching final snapshot have `stable=true` but no cutover authority. Row-count/row-digest/ID-digest drift, missing/extra/duplicate group, capture reuse, invalid source pin, reverse timestamps and final-source mismatch never pass. Failures are redacted. M10-01 synthetic candidate parity requires verified-by-contract double-source summaries. TDD RED→GREEN in GitHub with exact-head CI results, draft PR pending owner merge.
