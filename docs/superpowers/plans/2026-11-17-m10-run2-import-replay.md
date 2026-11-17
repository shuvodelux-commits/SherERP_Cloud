# M10 Run 2 / M10-16 — Offline 49-group import replay and rejected-retry evidence

**Issue:** #312 (coordinated by #456). **Base:** `main@40f6ae4b9cb6f17bbd6fed72a3455ba356ffed02`. **Original pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Prerequisite:** M10-15/PR #510 confirmed merged to main; source/D1 repository and transaction writer ownership remain exclusively M03.

## Implementation overview — 12 sentences

1. M10 Run 2 requires not only initial source-to-D1 parity but an independently repeated import/readback and proof that a rejected retry does not leave partial writes.
2. The current M10 source freeze and restore checks do not cover first-import versus replayed-import readbacks or a failed retry readback as a single source-linked chain.
3. A new pure M10 comparator will accept externally supplied metadata for the frozen source, first import, replayed import and post-rejection readback.
4. Each metadata capture must contain all 49 original source groups, exactly preserved counts, content digests and original source-ID commitments.
5. The original `LOGS` group remains physical-row-position-only and cannot gain a fabricated legacy business ID.
6. The comparator will require separately identified and ordered capture receipts for each attempt, including a recorded rejected retry, without calling D1 or pretending those receipts are independently authenticated.
7. Missing, unexpected or duplicate groups, a changed digest or row count, stale chronology and reused receipt identifiers must produce deterministic redacted error codes and counts.
8. Original identity-review and account-gross parity are separate M10-15 gates and must never be inferred from matching 49-group hashes.
9. The comparator consumes the exact existing M02 source-coverage audit contract and rejects `fullyReconciled:0` or any partially reconciled group as a candidate replay.
10. A read-only CLI will evaluate a single explicitly provided local JSON evidence file without network access, D1 writes or private source exports.
11. Tests must be committed first and prove that matching synthetic snapshots cannot override real M02 unmapped coverage or mark a false successful retry rollback.
12. Even when synthetic input is internally consistent, the result is candidate-only and always forbids import, posting, rollback execution, production cutover and release approval.

## Exact ownership

**New M10-only:** `src/migration/m10-import-replay-evidence.js`, `tests/m10-import-replay-evidence.test.mjs`, `scripts/m10-import-replay-check.mjs`, `tests/m10-import-replay-cli.test.mjs`, `docs/runbooks/M10_RUN2_REPLAY.md`, and this plan. **Read-only shared inputs:** original inventory, M02 coverage audit, M10-15 packet, M02/M03 isolated source import/replay data contracts. No common `src/db/**`, numbered `migrations/**`, `src/rpc/**`, Worker config/index, posting kernel, auth, branch policy, or original GAS/Sheets edit.

## Evidence shape

`{inventory,coverage,source,firstImport,replayedImport,rejectedRetryReadback,receipts}`.
Each capture has `{captureId,capturedAt,sourceCommit,groups}`; original source must be before all three D1 readbacks.
Each receipt has `{attemptId,readbackCaptureId,outcome,recordedAt,isolatedTarget}`, required outcomes in order `COMMITTED`, `REPLAYED`, `REJECTED`.
The three separate D1 capture IDs and three attempt IDs must be unique, and receipt timestamps follow the prior capture while not exceeding that readback's timestamp. Each of the 49 exact canonical groups is required on all four sides. For `LOGS`, use `{sheetKey,rowCount,rowDigest,positionDigest,identityKind:'SOURCE_ROW_POSITION_ONLY'}`; for every other group use `{sheetKey,rowCount,rowDigest,idDigest}`.
The existing M02 audit `coverage` must contain the frozen 49-group inventory, reported group count 49, consistent `fullyReconciled` and `sourceImportReconciled` flags per source group. A coverage count of zero or any unreviewed row fails closed, even when synthetic snapshots match.

## TDD and release rules

Create failing Node tests before module implementation; implement minimum comparator and CLI; run focused and full exact-head GitHub CI before merge; require review and verify final M10-owned code on `main`. Never treat a synthetic `REJECTED` claim as an actual failure-injected Workerd/D1 rollback, and never mark M10 issue #312 or M11 production complete from this candidate. Upstream M02/M03 own true source mapping and D1 import execution; owner must separately authorize all private source/target access. **Rollback:** revert six M10 files only, no D1/data migration.
