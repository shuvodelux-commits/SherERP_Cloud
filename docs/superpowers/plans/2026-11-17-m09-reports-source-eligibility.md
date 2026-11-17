# M09 Reports Source Eligibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Preserve RED→GREEN evidence.

**Goal:** Pin the source-completeness prerequisites for all six original Reports without enabling any report execution.

**Architecture:** One pure source-group review validator consuming a trusted server-created review manifest; no DB, external services, UI or RPC. `ready:false` regardless of input.

**Tech Stack:** Node >=22, ESM, node:test, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-17-m09-reports-source-eligibility-design.md`

## Global Constraints
- Follow `AGENTS.md`, `docs/WORKSTREAMS.md`, frozen `Reports.gs`/`Config.gs`, ADR-007.
- GitHub-only branch/PR, do not modify `legacy/source`, `src/rpc`, Wrangler, migrations, reports UI or data.
- No auto-netting or imported financial balance calculations; zero financial writes.
- All new source keys must be original configured group names, not aliases.

## Review Focus
- Missing source group silently replaced by a valid-looking empty array.
- Zero-count historical groups versus absent group evidence.
- Positive-only and zero/negative lot information and deleted/reversed source state.
- Unreviewed identity/provenance, duplicated/partial imports and customer/supplier gross account mismatches.
- Forged all-true receipts inadvertently unlocking public reports.

### Task 1 — RED acceptance tests and source plan
**Files:** Create `tests/m09-reports-source-eligibility.test.mjs`, this plan and spec.
**Interface:** Planned `evaluateM09ReportsSourceEligibility(manifest)`.
- [ ] Write tests for all six exact report dependencies, missing/mismatched/unreviewed/invalid receipts, required per-report reviews, zero counts and never-ready semantics.
- [ ] Commit test first, run `node --test tests/m09-reports-source-eligibility.test.mjs` on exact test-only SHA; record expected missing-module RED before implementation.

### Task 2 — GREEN minimal pure eligibility
**Files:** Create `src/modules/m09-reports-source-eligibility.js`.
**Interface:** `evaluateM09ReportsSourceEligibility(manifest)` returns `{ready:false,reports:[{key,ready:false,evidenceComplete,status,missingGroups,unreviewedGroups,countMismatchGroups,missingReviews}]}`.
- [ ] Use fixed groups based on original source + fixed global/report-specific review names; do not infer trust from table presence.
- [ ] Reject malformed manifests without accessing getters; inspect only own data properties; sanitize output.
- [ ] Run focused test and entire `npm test`; run `npm run verify:source` and PR checks; no financial integration tests are claimed because this is pure internal preflight, not D1.
- [ ] Refactor only as needed; preserve checks.

### Task 3 — Review gate
- [ ] Record RED/GREEN commit SHAs and exact-head CI state in PR #431-linked body.
- [ ] Verify changed paths and no production binding changes; owner reviews before merging.
