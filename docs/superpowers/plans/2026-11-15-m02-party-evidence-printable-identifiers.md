# M02-P Canonical Party Review Evidence Identifiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Follow test-first RED → GREEN and fresh exact-head GitHub verification.

**Goal:** Reject hidden/control characters in offline Party human-review evidence IDs without changing legitimate IDs.
**Architecture:** Reuse the existing `canonicalReviewId` check in the pure planner; add one small control/format-character rejection predicate, no new module or dependency.
**Tech Stack:** Node ES modules, `node:test`, GitHub Actions.
**Spec:** `docs/superpowers/specs/2026-11-15-m02-party-evidence-printable-identifiers-design.md`

## Global Constraints
- Preserve frozen original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
- No auto-merge by name/phone, no public approval RPC, no source-ID mutation, no D1 writes, financial posting, deploy or migration.
- GitHub-only dedicated branch/PR, Superpowers evidence, draft owner review; `PARALLEL-MODULE-READY=false`.

## Review Focus
- An approvalRef containing newline or NUL could mislead a human review export.
- A reviewer identifier containing zero-width or bidi override can be visually spoofed.
- A valid internal-space identifier should remain unchanged (do not trim/normalize).
- Two independent reviewed groups still require distinct canonical references.
- The output remains offline evidence only, not reviewer authentication or schema persistence.

---

### Task 1: Reject invisible characters in reviewed evidence identifiers

**Files:**
- Create `tests/contract/party-approval-evidence-printable.test.mjs`.
- Modify `src/party/party-import-plan.js` only in `canonicalReviewId`.
- Add this plan and spec; no changes to shared schema, `src/db/**`, existing source/UI or auth.

**Interfaces:** `planPartyImport(sourceRows,approvedGroups=[])` input/return shape unchanged.

- [ ] Step 1 RED: synthetic reviewed Customer+Supplier group tests with approvalRef/reviewedBy containing C0, DEL, zero-width and bidi formatting characters; assert rejection. Add accepted controls using ordinary visible identifiers and internal spaces.
- [ ] Step 2 RED proof: commit tests before production change, open draft PR, inspect GitHub Node test failure that shows hidden evidence was accepted.
- [ ] Step 3 GREEN: extend `canonicalReviewId` with a rejection regex for C0/DEL and selected invisible Unicode format/direction controls; no changes to approval ordering, IDs or readback.
- [ ] Step 4 verify: inspect GitHub Foundation full Node tests/source verification/frontend assembly, real M02 Workerd/D1, M03/M04 Workerd/D1, browser and PR-only no-secret preview checks on exact branch HEAD. Report pending/failures accurately.
- [ ] Step 5 review: inspect four-file diff and mergeability; keep PR draft/unmerged for owner.
