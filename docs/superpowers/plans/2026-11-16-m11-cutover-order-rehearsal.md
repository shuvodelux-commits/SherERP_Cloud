# M11-03 — Cutover and rollback event-order rehearsal (2026-11-16)

**Tracking:** #306. **Frozen original:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Base:** `SherERP_Cloud/main@0c4da87695bcebfbe6ba7658446fcce9a6213f97`. **Prerequisite:** merged #309 and #318. Read `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, `docs/runbooks/M11_PRODUCTION_CUTOVER.md` and ADR-007.

## Twelve-sentence implementation overview

1. A valid source freeze or write-delta report alone does not establish that production release steps occurred in a safe order.
2. M11-03 adds an offline event-order rehearsal for activation, emergency legacy rollback and D1 read-only incident hold.
3. Every proposed sequence references one pinned release commit, the frozen source commit and a final source-snapshot SHA-256 checksum.
4. The activation path requires legacy writes frozen before final snapshot, target restore point, completed reconciliation and explicit owner live GO before routing changes.
5. Successful production smoke and single-authority verification must follow the traffic switch.
6. An emergency legacy rollback may begin immediately after switching and must first freeze D1 writes and capture the committed-operation journal.
7. Legacy resumption requires the merged M11-02 delta gate to accept the complete, pinned, metadata-only `resume-legacy` disposition evidence before any rollback GO or routing restoration.
8. The D1 incident-hold path similarly requires a complete `roll-forward` disposition report and must not reopen the legacy application as a writer.
9. The validator will also call the merged M11-01 release-evidence gate for the switch phase and reject mismatch between all SHA/checksum inputs.
10. It rejects missing, extra, duplicated, out-of-order and unreviewed events using fixed error codes that disclose no underlying source records.
11. Tests will first introduce a failing import in a dedicated GitHub branch and then verify the smallest pure implementation under CI.
12. This is a syntactic rehearsal of operator-supplied references only; no Cloudflare API, deployment, D1 data, source GAS, actual routing or authority change is authorized.

## Impact / acceptance

- Add `tests/m11-cutover-order.test.mjs` **first**; demonstrate expected missing-module RED in GitHub Actions.
- Add pure `scripts/check-m11-cutover-order.mjs` and a redacted private-manifest CLI after RED; test activate, rollback, read-only hold, malformed and stale evidence.
- Append concise invocation/evidence guidance to `docs/runbooks/M11_PRODUCTION_CUTOVER.md`.
- Reuse existing M11-01 `assessM11Evidence` and M11-02 `assessM11WriteDelta`; no schema, posting kernel, RPC, Worker entry, Cloudflare config, original GAS/Sheets, production source data or permissions changes.
- Exact-head `npm test`, source verification, build, PR no-secrets preview safety and affected CI must pass; keep PR draft until owner review.
