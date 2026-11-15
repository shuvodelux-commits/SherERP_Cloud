# M02-P Identity Review Summary D1 Success Envelope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Execute the task with test-first RED → GREEN, then fresh CI verification.

**Goal:** Make missing or malformed D1 success status fail closed for the internal OPEN Party identity-review counts.
**Architecture:** Preserve existing single prepared read and response object; strengthen the `.all()` response success gate only, with no writes.
**Tech Stack:** JavaScript ES modules, Node `node:test`, existing GitHub Actions real local Workerd/D1.
**Spec:** `docs/superpowers/specs/2026-11-15-m02-party-review-summary-d1-success.md`

## Global Constraints
- Original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` read-only.
- Private M02-P internal helper only; no public RPC or migrations.
- Separate GitHub branch and scoped PR; Superpowers TDD evidence mandatory; no direct main commit; `PARALLEL-MODULE-READY=false`.

## Review Focus
- A missing success field must not turn zero apparent rows into approved zero-pending-review output.
- A nonboolean or null status must not turn plausible counted rows into accepted output.
- D1 `success:false` remains rejected and sanitized.
- D1 `success:true` with zero rows still yields legitimate zero summary.
- D1 `success:true` valid count rows retain OPEN-only reason grouping and PII redaction.

---

### Task 1: Validate D1 success envelope before counting reviews

**Files:**
- Create: `tests/m02-party-review-queue-success-envelope.test.mjs`
- Modify: `src/party/d1-review-queue-summary.js` (one condition)
- No changes to existing real Workerd/D1 fixture; its tests continue to exercise true D1.

**Interfaces:**
- Consumes: `summarizeOpenPartyIdentityReviews({DB})` from existing M02-P.
- Produces: same return shape on verified success; sanitized fail-closed error otherwise.

- [ ] **Step 1 RED:** add tests using the real helper with small D1-shaped `.all()` results: `{results:[]}`, `{success:null,results:[]}`, `{success:0,results:[]}`, `{success:'true',results:[{reason:'MISSING_ID',count:1}]}`; each must reject rather than claiming a valid summary. Add controls for `success:true` and `success:false`.
- [ ] **Step 2 verify RED:** commit tests *before* production changes, open draft PR; GitHub Foundation test run must fail for expected false-positive count behavior, not a module-not-found or runner error.
- [ ] **Step 3 GREEN:** replace `result.success===false` with `result.success!==true`, without editing SQL, fields, error strings or other logic.
- [ ] **Step 4 verify GREEN:** current-head Foundation Node suite, `npm run verify:source`, `npm run build:frontend`, PR-only Cloudflare safety, M02 Workerd/D1, M03/M04 local D1 and Chromium; explicitly report any pending/failing workflows.
- [ ] **Step 5 review:** inspect exact four-file PR diff, no migration/Worker/finance/auth changes; PR remains draft/unmerged for owner review.
