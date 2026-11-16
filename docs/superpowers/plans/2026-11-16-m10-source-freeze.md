# M10-03 Two-pass Source Freeze — Superpowers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Implement via test-first RED → GREEN, independently review exact-head CI, keep PR draft.

**Goal:** Block M10 candidate data parity when two source capture summaries or the compared final source summary disagree.

**Architecture:** A pure `src/migration/m10-source-freeze.js` validator compares two separately supplied 49-group manifests. The existing `assessM10RehearsalEvidence` consumes its `stable` outcome as a new mandatory gate. No DB / source I/O or new dependency.

**Tech Stack:** Node 22 built-ins, node:test; source summary v1 from M10-01/M10-02.

**Spec:** `docs/superpowers/specs/2026-11-16-m10-source-freeze-design.md`

## Global constraints
- Source pin: `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
- Exactly 49 reviewed source groups, no auto identity merging, no raw IDs or digest bytes in reports.
- Only M10 source files, tests and docs may change. No live source export, remote D1 writes, public auth, financial post, migration, or cutover approval.
- One GitHub branch/PR. No local machine changes.

## Review focus
- Source may change in content only, original ID only, or count only: pin each negative.
- Snapshot replay with same ID or non-increasing capture timestamp: reject.
- Missing/duplicate/unreviewed group with equal totals: block.
- Final D1 comparison must use precisely second-pass source digest; reject mismatch.
- Error/report must never expose source row, digest, ID, amount or snapshot ID.

## Task 1 — RED automated tests
**Files:** Create `tests/m10-source-freeze.test.mjs`; modify `tests/m10-rehearsal-gate.test.mjs` to enforce freeze gate.

- [ ] Add tests for stable complete 49-group passes and row/count/ID/final-source drift.
- [ ] Add tests for missing passes, duplicate/unreviewed groups, invalid capture identity/timestamps, source SHA drift, no data disclosure, input immutability.
- [ ] Assert M10-01 now blocks otherwise matching fake source/D1 summaries unless source freeze evidence is valid and final source match holds.
- [ ] Commit RED, open draft PR, inspect actual GitHub Foundation failure for missing new import before coding.

## Task 2 — GREEN minimal checker
**Files:** Create `src/migration/m10-source-freeze.js`; modify `src/migration/m10-rehearsal-gate.js` to enforce freeze.

- [ ] Require exact canonical summary/manifest fields, pinned inventory and sourceCommit. Validate 49 groups and distinct increasing captures.
- [ ] Return fixed codes/counts and `stable:boolean`; no raw metadata.
- [ ] M10-01 evaluates freeze, adds redacted issue codes and blocks candidateDataParity when unstable; keep `authorizesImport=false` and `productionReady=false` always.
- [ ] Run full `npm test` in GitHub PR CI; verify original source manifests, Cloudflare Preview safe build checks; no actual D1 integration claimed for M10-03.
- [ ] Keep exact RED/GREEN commit SHAs, CI evidence and remaining M10 blockers in PR.

## Task 3 — Review, handoff
- [ ] Recheck latest `main`, no overlapping files with M02–M09.
- [ ] Verify only M10 tests/src/docs affected.
- [ ] Leave PR draft/unmerged for owner. Revert PR for rollback.
