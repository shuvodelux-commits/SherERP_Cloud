# M11-11 — Single-writer authority epoch timeline (offline documentary preflight)

Date: 2026-11-17. Tracks M11 #306, blocked by M10 #312. Base `SherERP_Cloud/main@9f49453705071dbdd2be02b67138b81e510accfb`. Original source pin `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Follow repository `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, ADR-007 and `docs/runbooks/M11_PRODUCTION_CUTOVER.md`.

## Twelve-sentence overview

1. M11-03 validates the reviewed ordering of cutover events, but it does not check that the two systems' write-authority intervals are nonoverlapping.
2. M11-02 accounts for post-cutover D1 write dispositions, but it does not compare a time-bounded D1 commit count with the rollback journal.
3. M11-11 adds a pure offline, operator-supplied **single-writer authority epoch** validator to cross-check those existing gates.
4. The validator accepts exactly three reviewed modes: `activation`, `rollback-to-legacy`, and `hold-d1-readonly`.
5. Each mode requires its fixed sequence of legacy-only, both-frozen and D1-only epochs, with no missing or reordered fence.
6. UTC timestamps must be canonical, strictly positive in duration and adjacent without unaccounted gaps or overlaps.
7. Every epoch requires a distinct private record reference and explicit legacy/D1 committed-operation counts that are nonnegative safe integers.
8. Any D1 commit before switch, either-system commit in a frozen epoch, or legacy commit in a D1-only epoch fails closed.
9. Rollback and read-only hold must use existing reviewed write-delta evidence with the expected disposition mode, and aggregate D1 epoch commits must exactly match the delta's committed-write checkpoint.
10. A final reviewed checkpoint must report zero unresolved acknowledged operations, duplicated effects, gross Party-account drift, stock drift and post-freeze legacy writes.
11. Test-first implementation creates regression tests, demonstrates the missing checker in GitHub Actions, then adds the minimal validator, private CLI and runbook section without touching runtime infrastructure.
12. All returned statuses are documentary only and **never** authorize production deployment, source freeze, data import, backup restore, transaction resumption or traffic switching.

## Owned files and acceptance

- New: `tests/m11-single-writer-timeline.test.mjs`, `scripts/check-m11-single-writer-timeline.mjs`, this plan.
- Updated: `docs/runbooks/M11_PRODUCTION_CUTOVER.md` only.
- Reuse unchanged: `assessM11CutoverOrder` and `assessM11WriteDelta`; this does not reimplement their event or canonical-digest rules.
- Exact shape: `{schemaVersion,releaseSha,sourceSha,sourceSnapshotSha256,mode,epochs,checkpoint}`; each epoch `{startedAt,endedAt,authority,legacyCommits,d1Commits,record,releaseSha}`; the checkpoint `{status,record,releaseSha,unreconciledAcknowledgedOperations,duplicateOperationEffects,grossPartyDiscrepancies,inventoryDiscrepancies,legacyWritesAfterFreeze}`.
- Separate source SHA, release SHA and final source snapshot SHA-256 pins supplied by caller; source SHA must equal immutable M00 pin.
- Epoch patterns: activation `legacy,frozen,d1`; rollback `legacy,frozen,d1,frozen,legacy`; hold `legacy,frozen,d1,frozen`.
- All source/D1 authority and finance evidence is externally operator-supplied; this checker does not authenticate it.
- Read-only JSON inputs only; never log raw evidence IDs, private paths, tokens or content.
- No Worker, RPC, D1 schema/posting, public preview, Cloudflare deployment or original GAS/Sheets changes, and no private business data in CI.
- The PR must remain draft pending exact-head checks and owner review. M10 and production remain NO-GO.
