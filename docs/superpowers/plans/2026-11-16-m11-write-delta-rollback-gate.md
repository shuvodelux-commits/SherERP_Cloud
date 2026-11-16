# M11-02 — Post-cutover write-delta completeness gate (2026-11-16)

**Issue:** #306. **Target base:** `SherERP_Cloud/main@18b3e3b9d231a601e7d050e56e35730613a50d17`. **Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Prerequisite:** merged M11 PR #309. Read `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, `docs/runbooks/M11_PRODUCTION_CUTOVER.md` and ADR-007.

## Twelve-sentence implementation overview

1. M11 must not switch back to the legacy GAS system while committed post-cutover D1 writes remain unaccounted for.
2. A simple source snapshot backup is insufficient because sales, returns, financial postings and stock mutations can occur after the initial Worker traffic switch.
3. This slice creates an **offline documentary** comparison of separately supplied, redacted committed-operation IDs, acknowledgment IDs and rollback dispositions.
4. Its input is metadata-only and contains no invoice bodies, Party details, stock quantities, credentials, database exports or SQL.
5. The caller must pin the exact target release SHA and the private final legacy source-snapshot checksum, and must supply separately reviewed freeze evidence for both writing systems.
6. Explicit checkpoints specify how many committed writes and acknowledged requests were extracted by authorized operators.
7. Each committed operation must appear exactly once and be paired with exactly one disposition carrying a matching canonical-operation digest and a private evidence reference.
8. Every acknowledgment must refer to a committed operation; duplicates, unknown IDs, count discrepancies and missing dispositions fail closed.
9. A proposed legacy-resume path requires every committed operation to be classified as verified replay to legacy; a roll-forward path requires every committed operation to be retained in D1.
10. An empty delta is accepted only when both freeze records, both zero-count checkpoints, release pin and source checksum are supplied.
11. Passing this structural gate **never** establishes true source/D1 equivalence, authorizes a restore or permits a traffic switch; real operator verification and signed release authority are still required.
12. GitHub CI must show an expected test-first RED failure before the minimal validator is implemented and verify the GREEN candidate without touching production, staging or original source.

## Acceptance and scope

- **Add test first:** `tests/m11-write-delta-gate.test.mjs` using synthetic IDs and digests, showing expected missing-module RED in GitHub Actions.
- **Add minimum implementation:** `scripts/check-m11-write-delta.mjs` exports pure `assessM11WriteDelta` for offline report-only checks plus a private-path CLI that outputs only fixed codes, never operation IDs or secrets.
- **Update:** `docs/runbooks/M11_PRODUCTION_CUTOVER.md` with private evidence artifact shape and live-owner review limitations.
- **No changes:** existing Worker entry, deploy/build workflows, `wrangler*.jsonc`, original GAS/Sheets, import logic, D1 migration/schema, product/Party/finance posting kernel, RPC, M10 rehearsal contracts or source files.
- **Review:** compare exact-head test, source verification and CI; no production launch until real M10 and M11 owner GO; do not merge without review.
