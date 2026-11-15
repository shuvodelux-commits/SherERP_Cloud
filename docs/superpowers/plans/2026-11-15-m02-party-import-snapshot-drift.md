# Superpowers TDD plan — Party Import Snapshot Drift Validation

**Date:** 2026-11-15.
**Spec:** `docs/superpowers/specs/2026-11-15-m02-party-import-snapshot-drift-design.md`.
**Objective:** detect changes after review and before any synthetic Party import rehearsal; do not grant production import permission.
**Stack:** Node ESM tests (fixtures already in repo) and current GitHub Actions.

## Task 1 — RED before production module

Create only new docs and `tests/m02-party-import-snapshot-drift.test.mjs`.
- [ ] Pin exact source groups and original row provenance; use existing synthetic snapshot and synthetic reviewed claim.
- [ ] Test accepted source-exact snapshots, export object/row order invariance, original ID, names/phone, Owner/Lender/Borrower role, vendor due/receivable, Customer signed opening, retired status and position changes; additions, removals, missing/duplicate IDs and malformed types.
- [ ] Test duplicate original ID with blank-name row (open #144 separately changes the planner), fail-closed review evidence, unchanged caller input and PII-safe output.
- [ ] Commit and create GitHub draft PR **without production file**. Confirm a failing GitHub Node workflow due to `ERR_MODULE_NOT_FOUND` for `src/party/import-snapshot-guard.js`.

## Task 2 — minimal GREEN

Create **only** `src/party/import-snapshot-guard.js`.
- [ ] Parse explicit JSON-shaped rows from five known source groups; source key by original sheet row when present, original ID otherwise; reject unanchored IDs.
- [ ] Canonicalize raw field values with sorted object keys, preserving numeric/string distinctions and all original financial fields; compare keyed reviewed and candidate rows per group.
- [ ] Aggregate **redacted** `SOURCE_ROW_CHANGED`, `SOURCE_ROW_ADDED`, `SOURCE_ROW_REMOVED`, `DUPLICATE_SOURCE_ID`, `MISSING_SOURCE_ID`, `PENDING_IDENTITY_REVIEW`, `QUARANTINED_SOURCE_ROWS` with fixed group labels and counts.
- [ ] Reuse existing `planPartyImport` for reviewed and candidate snapshots with the same supplied evidence, but do not copy/return plan, source rows or reviewer IDs.
- [ ] Define `sourceSnapshotMatches` separately from `offlineRehearsalClear`. No writes, no auth, no live imports or schema changes.

## Task 3 — verified review

- [ ] Verify exact-head source audit, Node suite, M02 Party Workerd/D1, M03 local D1, M04 auth, original Chromium/UI smoke, Cloudflare no-secret PR safety.
- [ ] Confirm exactly **four new files**, no modified existing files, no open PR overlap, current main mergeability.
- [ ] Record RED/GREEN hashes, actual workflow results and production gates in PR. Leave draft/unmerged pending owner approval.
