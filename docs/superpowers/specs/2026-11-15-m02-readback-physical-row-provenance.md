# M02-safe — Verify physical legacy source-row provenance in read-only Party reconciliation

**Authority:** AGENTS.md, ADR-007, frozen Mohim_ERP source `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `src/party/party-import-plan.js`.

## Issue and scope
The offline source planner accepts `_rowIndex` only when absent (represented by `legacySheetRow:null`) or a safe integer >= 2, and rejects duplicate known physical row positions within one legacy source group. After an offline plan is constructed, a tampered in-memory plan and mirrored future D1-shaped readback can currently carry an impossible negative, fractional, string, unsafe integer or duplicate `legacySheetRow` without a `PLAN_LINKAGE_INVALID` diagnostic, falsely certifying source-row identity parity.

This change makes `validPlanLinkage` enforce exactly the existing planner's rules on the *proposed plan* before trusting mirrored D1-shaped identity snapshots. For every link, `legacySheetRow` must be exactly `null` or a safe integer >= 2. For every source group, a nonnull physical row position can occur at most once; different source groups may use the same physical position, and multiple links with null position remain valid because an unknown physical position is not an asserted identity. Never fabricate physical coordinates or normalize source IDs; original sourceGroup and exact sourceId remain authoritative. No change to export source, planner, original frontend, monetary accounts, reviewer approval or D1 schema.

If the proposed graph violates the rules, return the existing fixed redacted `PLAN_LINKAGE_INVALID` issue with `identityRowsMatch:false` and `approvalEvidencePersistent:false`, even if future-schema readback rows mirror every altered value. A valid reviewed Party plan with original row positions, nullable positions, repeated row numbers *across different groups*, and independent role balances must keep its existing behavior. Local actual Workerd/D1 readback must fail closed on invalid in-memory positions without writes; the current deployed-schema `approval_ref` persistence blocker remains.

**Boundaries:** existing pure M02 reconciliation module, two tests, spec/plan. Do not modify source repo, Worker HTTP/RPC, M03/M04, original UI, SQL/migrations, D1 staging/production bindings or financial postings. `PARALLEL-MODULE-READY=false`. This is not permission to import Party records.
