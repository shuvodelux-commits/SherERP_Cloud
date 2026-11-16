# M10-01 — Offline source-vs-D1 rehearsal evidence gate (design)

**Source authority:** Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; SherERP Cloud `AGENTS.md`, `docs/WORKSTREAMS.md`, ADR-007.

## Intent
Begin M10 without misrepresenting the incomplete M02–M09 migration as a complete ERP. Create an **offline, pure, read-only evidence comparator** for the future private staging import. The comparator must fail closed today, because none of the 49 source groups has full production-equivalent reconciliation. It is a contract check, **not** a live spreadsheet exporter, D1 importer, performance benchmark, security attestation or M11 cutover approval.

## Inputs
- Frozen source schema inventory (`formatVersion: 1`, 49 unique `sheetKey` values) and the M02/M03 coverage audit, both on the pinned source SHA.
- Optional independently prepared source and D1 readback summaries for every source group, each containing `sheetKey`, nonnegative `rowCount`, lowercase SHA-256 `rowDigest` and `idDigest`. Importers must later define, independently compute and test a canonical source/target row serialization before using this contract for real evidence. A supplied hash is **not proof** that either database was read.
- Optional existing M02 gross Party checkpoint parity result; this must include independently checked current **and historical opening** balances, not net Party money.
- Optional count of pending/ambiguous identity reviews (nonnegative integer).

## Output and safeguards
- Deterministic fixed-code issue counts only. **Never** echo raw source rows, Party IDs, source identifiers, amounts, phone numbers, checksums or provided error strings in logs/reports.
- Missing evidence is a blocker, not a pass. A digest match without complete versioned table/import coverage is insufficient. Exact row, original-ID and gross-account parity must all be independently evidenced; pending ambiguous identity decisions block sign-off.
- The evaluator is advisory **and always refuses to grant live-import, production and cutover approval**. Security, concurrency/failure tests, query/CPU p95 budgets, private backup/restore and written owner sign-off are separate mandatory M10 gates.
- No code changes to shared `src/db`, migrations, RPC, preview configuration or frontend. No credentials, remote DB connections, destructive operations, or live sources.

## Approaches considered
1. **Selected:** pure offline comparator + RED/GREEN tests, isolated from runtime and deployment.
2. Run production-like staging import immediately — unsafe with 38 unmapped source groups and unapproved source exports.
3. Merely add a written checklist — fails to catch count/identity/gross-evidence drift in later rehearsals.

## Acceptance
- Frozen 49-group inventory and current migration coverage produce blocked M10 status.
- Every group count and both digests must match, including source-ID provenance; missing/extra/duplicate group cannot pass.
- A successful synthetic parity sample still **cannot** authorize remote import or production cutover; gross-account evidence is independently required.
- Tests exercise missing, malformed and private inputs; reports remain fully redacted and deterministic.
- GitHub Actions RED test evidenced before adding implementation, then GREEN exact-head CI reviewed. PR remains unmerged pending owner review.

## Open gates
Real 49-group D1 schema/import; independent canonical source/readback digests; reviewed distinct Party accounts; integration transaction/authorization tests; owner-approved source export, private staging/restore drill, benchmark thresholds and sign-off.
