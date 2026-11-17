# M10-17 — Connect the merged M10-15 evidence packet and M10-16 replay witness

**Date:** 2026-11-17; **issue:** M10 #312; **coordination:** #456.
**Base:** `main@e75cde4f49f511f3e95f7c07bd896cdd69bd9e81`.
**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Scope/owner:** M10 exclusively, new `src/migration/m10-replay-packet-continuity.js`, `tests/m10-replay-packet-continuity.test.mjs`, and this plan. Read-only on merged `src/migration/m10-evidence-packet.js` and `m10-import-replay-evidence.js`. No M02/M03/M04/Worker/shared files.

## Overview — twelve sentences

1. M10-15 validates supplied source-to-D1-to-backup-to-restore evidence while M10-16 separately validates source-to-first-import-to-replay-to-rejected-retry metadata.
2. Each independent gate can report a synthetic candidate for different historical data without necessarily establishing that both concern the same original source.
3. M10-17 introduces a pure read-only continuity assessment that connects those already-implemented gates rather than re-implementing source ID, D1 import, Party-account or retry verification.
4. The assessment requires both existing gates to be candidate-ready before considering a combined candidate.
5. It cross-checks all 49 fixed source groups and their exact row counts, canonical row digests and original legacy ID commitments.
6. The special legacy `LOGS` group must retain physical source-row positions and must not receive an invented ID digest.
7. It compares the M10-16 original source capture with the M10-15 stable source summary and the repeated/rejected D1 readbacks with the M10-15 D1 and backup summaries.
8. It verifies that the M10-16 source capture follows the M10-15 second freeze pass and that the rejected retry readback precedes the M10-15 backup.
9. It rejects accidentally reused capture identifiers across the independently supplied freeze, replay and recovery evidence.
10. Every finding must be a deterministic fixed code and count without revealing sheet names, actual original IDs, amounts, source rows, capture tokens or SHA digests.
11. Tests will be committed first, require an observed failing check, and then validate the minimum implementation using full exact-head GitHub CI without touching shared M03 files.
12. Even complete synthetic continuity does not establish actual source custody, independently executed D1 import, owner approval, recovery review or a production GO.

## TDD and acceptance

1. RED: tests for a successful but candidate-only synthetic link, individually green-but-different datasets, LOGS position drift, chronology drift, reused cross-gate capture identifier, incomplete gates, hostile accessor redaction and immutability.
2. GREEN: minimal pure comparator reusing existing public M10 `assessM10EvidencePacket` and `assessM10ImportReplayEvidence`, exact structural checks, fixed output, no database access.
3. Verify 49-group exactness; no new shared source maps, ID issuance rules, D1 repositories or RPCs.
4. Run full exact-head GitHub Foundation/Workerd/UI CI; require independent Super QA/Review and human-approved merge.
5. All output flags `authorizesImport`, `authorizesPosting`, `authorizesRestore`, `authorizesCutover` and `productionReady` remain false.
6. Run 2 remains **NO-GO** while 14 versioned operational migrations cover 19 groups only partially, 30 groups are unmapped and 0/49 historical source→real D1 groups are independently reconciled. A private owner-approved source snapshot and operational M03 D1 reader/importer remain external blockers.

## No-overlap audit

At task start there were four open PRs: M03 #614 (private D1 counter seed), M03 #616 (Product master atomic original ID floor), M09 #615 (ledger source links), and M01 #613 (tablet dashboard QA). **No M10 PR existed**, and no known open PR owns the two new M10-specific paths. A different ChatGPT tab may prepare an unpublished task; recheck the PR list before merging. All M03 shared D1, SQL, source, Worker and RPC paths remain exclusively reserved to M03.
