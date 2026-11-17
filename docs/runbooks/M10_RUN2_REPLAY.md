# M10 Run 2 — 49-group import replay and rejected-retry evidence

**Status:** offline rehearsal validator implemented; **actual private staging migration NOT performed**. This runbook never authorizes reading live Sheets, writing isolated remote D1, changing Worker bindings or production cutover.

**Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Tracking:** M10 [issue #312](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/312), parallel coordination [#456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456).
**Source schema owner:** M02 #24. **D1/SQL posting/Worker integrator:** M03 #22. **Independent gross accounts:** M02-P and M08. **Release:** M11 with explicit owner GO only.

## 1. What has been implemented

`src/migration/m10-import-replay-evidence.js` compares supplied, independently named and timestamped metadata for the **frozen source**, **first D1 import readback**, **second import/replay readback**, and **readback after a reported rejected retry**, for every one of 49 source groups. The `LOGS` group is compared using its **physical source position**, not a fabricated source ID; all other groups compare counts, canonical row hashes and original source-ID commitments.

The read-only comparator rejects omissions, extra groups, duplicate groups, altered rows/IDs/positions, reused or out-of-order captures, mismatched/duplicate operation receipts, invalid chronological ordering, and a nonisolated target. It also checks the existing M02 coverage contract `sourceImportReconciled` per group; **all 49 must be explicitly true** to allow a *synthetic candidate*. It will not silently equate static D1 table presence with a historical import.

A `REJECTED` outcome in a supplied receipt is **not** proof that Workerd/D1 injected a failure or rolled back an atomic transaction. The D1 kernel owner M03 must separately provide actual executed rollback/readback evidence, with transaction-specific retry/concurrency/reversal tests; M10 compares those approved receipts without creating another financial writer.

### Current actual source→D1 mapping blocker

The last verified static audit on GitHub main (prior to this task) showed **49 source groups**, **19 only partially mapped**, **30 unmapped**, and **0 fully reconciled** in the conservative M02 coverage contract. It is **not** valid to submit `fullyReconciled:49` merely to make a local synthetic test green. Re-run the authoritative `scripts/audit-migration-coverage.mjs --json` on the exact reviewed main revision before any rehearsal and require a real M02/M03 accepted mapping revision; M10 does not edit shared schema/migrations.

The 30 prior uncovered groups include sales, purchase, returns, postings/ledger, bank/cash, finance, vendor and stock/lot histories. Their exact names are recorded in `docs/runbooks/M10_EVIDENCE_PACKET.md`. Until M02 and M03 supply independent, signed source mappings and real readback proof for them, Run 2 cannot be completed.

## 2. Required private evidence contract

Supply an *authorized local JSON file* with these seven top-level own-data keys:

```js
{
  inventory: {formatVersion:1,tables:/* original 49-group frozen Config inventory */},
  coverage: { // existing reviewed M02 coverage contract
    formatVersion:1,
    sourceCommit:'29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2',
    summary:{sourceGroups:49,fullyReconciled:49},
    rows:[/* exactly 49 original group identities with
      sourceImportReconciled:true only when actually reconciled */]
  },
  source: {/* captureId, capturedAt, sourceCommit, groups */},
  firstImport: {/* distinct captureId, later capturedAt, sourceCommit, groups */},
  replayedImport: {/* distinct captureId, later capturedAt, sourceCommit, groups */},
  rejectedRetryReadback: {/* distinct captureId, later capturedAt, sourceCommit, groups */},
  receipts:{
    first:{attemptId:'ATTEMPT-FIRST01',readbackCaptureId:'D1-FIRST-IMPORT-001',
      outcome:'COMMITTED',recordedAt:'2026-11-17T06:01:00.000Z',
      isolatedTarget:true},
    replay:{attemptId:'ATTEMPT-REPLAY01',readbackCaptureId:'D1-REPLAY-IMPORT01',
      outcome:'REPLAYED',recordedAt:'2026-11-17T06:03:00.000Z',
      isolatedTarget:true},
    rejected:{attemptId:'ATTEMPT-REJECT01',readbackCaptureId:'D1-REJECT-RETRY01',
      outcome:'REJECTED',recordedAt:'2026-11-17T06:05:00.000Z',
      isolatedTarget:true}
  }
}
```

All capture IDs and attempt IDs must differ, all captures are UTC milliseconds, and for each attempt: `previous readback capturedAt < receipt.recordedAt <= current readback capturedAt`. `source` precedes the first readback, then `firstImport`, `replayedImport`, and `rejectedRetryReadback` follow in order.

A normal group requires exactly `{sheetKey,rowCount,rowDigest,idDigest}`. Only legacy `LOGS` requires `{sheetKey,rowCount,rowDigest,positionDigest,identityKind:'SOURCE_ROW_POSITION_ONLY'}`. Each hash is lowercase 64-character hexadecimal, externally committed using the approved frozen source-to-D1 canonical serializer; no private group content or source ID is returned by the evaluator.

## 3. Safe local dry-run

For a **synthetic** check using checked-in tests, with no database access:

```sh
node --test tests/m10-import-replay-evidence.test.mjs
node --test tests/m10-import-replay-cli.test.mjs
```

Only after **separate, written, scope-limited owner authorization** for an isolated private capture/readback, place evidence in private storage outside the repository and run:

```sh
node scripts/m10-import-replay-check.mjs /private/authorized/import-replay-metadata.json
```

The CLI reads exactly one regular local JSON file (64 MiB maximum, no symbolic links), writes no output files, has no network/D1 connection, and prints **only fixed issue codes/counts, candidate booleans and unconditional no-GO flags**. A return code of **0** means only externally supplied offline candidate data was internally consistent. Exit code **2** means no candidate, invalid input or missing file. Never paste raw source rows, login tokens, names, original IDs, financial amounts or even private digest commitments into GitHub/CI or a Cloudflare preview.

## 4. Blocker diagnostics and operational responsibility

| Example issue | Meaning | Owner and required action |
| --- | --- | --- |
| `REPLAY_COVERAGE_UNRECONCILED` | Some/all of 49 source groups not independently reconciled | M02 original group mapping + M03 D1 integration; do not alter flags manually |
| `REPLAY_FIRST_ROW_DIGEST_MISMATCH` / `ROW_COUNT_MISMATCH` | First import changed/missed source content | M02/M03 original source import and SQL mapping |
| `REPLAY_REPEAT_ROW_DIGEST_MISMATCH` / `ID_DIGEST_MISMATCH` | Replayed import not idempotent | M03 shared source-ID and idempotent upsert/posting owner |
| `REPLAY_REJECTED_ROW_COUNT_MISMATCH` | Rejected retry left unexpected readback state | M03 transaction rollback and failure-injection owner |
| `REPLAY_REJECTED_POSITION_DIGEST_MISMATCH` | Physical `LOGS` positions diverged | M02/M03 position-only legacy audit mapping |
| `REPLAY_RECEIPT_OUTCOME_MISMATCH` / `CAPTURE_MISMATCH` | Supplied attempt/receipt not linked to corresponding capture | M03 approved private operator and reviewer |
| `REPLAY_TARGET_NOT_ISOLATED` | Staging target not declared isolated | M11 operations owner, owner source-data authorization |
| `REPLAY_CAPTURE_NOT_ORDERED` / `REPLAY_RECEIPT_CHRONOLOGY_INVALID` | Evidence custody order logically inconsistent | Private source/D1 capture operator |

A zero discrepancy count here does not cover missing real D1 tests, Cash Session, Party gross source account signs, FIFO/OVERSOLD, return reversals, security, performance baselines, UI or independent accountant signoff. Those remain distinct M10-15/M03/M02/M04–M09 and M11 gates.

## 5. Run 2 exit gate

**Run 2 is NO-GO until all of these are independently evidenced:**

1. Explicit written owner authorization for original source snapshot and an isolated private D1 target, including retention and custody safeguards.
2. All **49/49** original group mappings and canonical source row/ID/position/count/hash parity, not merely schema presence.
3. Independently repeated D1 import and readback with **zero critical unexplained discrepancies** and a genuine failure-injected rejected retry with rollback proof.
4. M02/M08 original-ID gross Party account balances and opening/current direction reconciled without any automatic cross-role netting.
5. M03/M04/M05–M08 real D1 transaction retry/concurrency/reversal, authorization and Cash Session evidence.
6. Numeric thresholds approved and measured for Workers CPU, p95/p99, D1 queries/rows; M01/M09 preserved browser/mobile/print parity.
7. Private immutable capture provenance and reconciliation artifacts under approved custody; signed data reviewer evidence to support Run 3 recovery/security/accounting review.

If any prerequisite is missing, preserve original source and staging snapshots; record the outstanding issue and leave the run/release NO-GO. The read-only evaluator **always** reports `authorizesImport:false`, `authorizesPosting:false`, `authorizesRollback:false`, `authorizesCutover:false`, and `productionReady:false`.
