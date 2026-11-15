# M02-P Stable Missing-ID Review Fingerprints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans, test-first RED → GREEN, fresh exact-head GitHub verification.

**Goal:** Make offline MISSING_ID review references stable under JSON property reordering when original row ID and sheet position are unavailable.
**Architecture:** Canonicalize only the flat source-row field names used in content hash; preserve preexisting source-group, row-position and review-ID schemes.
**Tech Stack:** JS ES modules, Node `node:test`, GitHub Actions including local Workerd/D1 suites.
**Spec:** `docs/superpowers/specs/2026-11-15-m02-party-missing-id-fingerprint-design.md`

## Global constraints
- Frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` never changed.
- No auto identity merge, no D1 writes, no public RPC, no financial/account work, no production/staging data migration.
- KISS, independent GitHub PR, RED proof before production code, reviewer approval for merge.

## Review focus
- JSON property order is not source-row identity.
- Without original ID or `_rowIndex`, content is a fallback review key, never an import link.
- Truly indistinguishable duplicates must remain quarantined/fail closed.
- Preserve caller snapshot immutability and existing review result shape.
- Stable physical `_rowIndex` must take precedence over content.

---

### Task 1: Canonical fallback fingerprint for no-ID/no-row-index rows

**Files:**
- Create `tests/contract/party-missing-id-fingerprint.test.mjs`
- Modify `src/party/party-import-plan.js` (one helper and one call)
- Create these spec/plan files only.

**Interfaces:** `planPartyImport(sourceRows,approvedGroups=[])`; report fields and ID format unchanged.

- [ ] **Step 1 RED**: test that two logically identical snapshots whose *single* missing-ID row's object property order differs produce equal `MISSING_ID` `reviewId` values; add stable-`_rowIndex`, changed-field and no-link controls.
- [ ] **Step 2 observe RED**: commit tests before any production change; capture actual expected assertion failure in GitHub Foundation Node workflow and ensure controls pass.
- [ ] **Step 3 GREEN**: replace insertion-order-dependent stringification with a stable, lexically key-sorted representation of the flat source row in the fallback hash. Do not touch any other matching logic.
- [ ] **Step 4 verify GREEN**: check exact-head Foundation Node/source inventory/frontend assembly and M02 real local D1, M03/M04, Chromium and PR-only Cloudflare safety. Report pending/failures.
- [ ] **Step 5 review**: inspect four-file patch and branch mergeability; leave PR draft/unmerged until owner review.
