# M02-P Duplicate Blank-Name Identity Quarantine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure duplicate original Party master IDs are quarantined even if one or more duplicate rows have no display name.
**Architecture:** Keep the existing offline `planPartyImport` contract; record nonblank original identity keys before checking names, defer `OTHER` reviews so duplicate-ID takes precedence, and leave the rest of the planner unchanged.
**Tech Stack:** Existing Node.js ES modules, `node:test`, GitHub Actions.
**Spec:** `docs/superpowers/specs/2026-11-15-m02-party-duplicate-blank-name-identity-design.md`

## Global Constraints
- Source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` is read-only; no new dependency or schema.
- Offline identity plan only; no Party auto-merge, financial account netting, remote D1 data writes or public RPC.
- Dedicated GitHub branch/PR; no direct `main` commits; preserve existing source ID provenance.

## Review Focus
- A valid-name row sharing its original ID with an unnamed row must not be imported.
- Two unnamed duplicates must not produce two colliding `OTHER` reviews.
- A unique unnamed row must retain its existing `OTHER` quarantine.
- Identical ID text in different masters is valid, never a within-group duplicate.
- Explicit human-approved group may not claim any quarantined duplicate key.

---

### Task 1: Detect all present source IDs before checking display names

**Files:**
- Create `tests/contract/party-duplicate-id-blank-name.test.mjs`
- Modify `src/party/party-import-plan.js` only for source ID registration and incomplete-name review precedence.

**Interfaces:**
- Consumes: `planPartyImport(sourceRows,approvedGroups=[])`.
- Produces: unchanged API/shape, deterministic `DUPLICATE_ID` quarantine of every repeated `(group,id)`.

- [ ] **Step 1 RED:** add regressions for named+unnamed and unnamed+unnamed duplicates; assert zero returned links for duplicated key and one `DUPLICATE_ID` review. Add preservation tests for unique unnamed row and same ID in two groups.
- [ ] **Step 2 verify RED:** on test-only GitHub branch/PR, run `node --test tests/contract/party-duplicate-id-blank-name.test.mjs`; expect named+unnamed acceptance to fail because planner still returns a link.
- [ ] **Step 3 GREEN:** register `(group,id)` in duplicate tracker before name check, defer unique missing-name `OTHER` review until duplicate status is known; preserve existing `MISSING_ID` behavior.
- [ ] **Step 4 verify GREEN:** run focused regression, full `TZ=UTC npm test`, `npm run verify:source`, `npm run build:frontend` and existing GitHub D1/browser/preview workflows; inspect exact head results.
- [ ] **Step 5 review:** confirm only planner/test/docs changed, no sensitive preview routes or production migrations; keep PR unmerged for owner review.
