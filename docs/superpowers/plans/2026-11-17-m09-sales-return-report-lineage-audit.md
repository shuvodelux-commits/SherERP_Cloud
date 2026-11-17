# M09 Sales Return Report Lineage Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, verifying RED and GREEN independently.

**Goal:** Fail closed on source-corrupt Sales Return parent/child invoice attribution before M09 reporting can be activated.

**Architecture:** One pure internal M09 source-lineage audit, no data access or mutation. Returns only fixed redacted blocker codes and always `ready:false`.

**Tech Stack:** Node native `node:test`, ESM; GitHub Actions with frozen-source checks.

**Spec:** `docs/superpowers/specs/2026-11-17-m09-sales-return-report-lineage-audit-design.md`

## Global Constraints
- GitHub-first branch `m09/sales-return-report-lineage-audit-20261117` off main `666dd0ca5e0632dbc5bb3fb75c4584e0433d36ec`, issue #431.
- Respect `AGENTS.md`, `docs/PARALLEL_EXECUTION.md`, coordination #456, ADR-007 and M03 readiness.
- M09 owns **only four new paths**: this plan, design, new tests and new `src/modules/m09-sales-return-report-lineage-audit.js`.
- No `src/db`, `migrations`, `src/rpc`, `src/index.js`, Worker bindings, financial posting or original UI source modification.
- Original source is read-only; all report results remain unavailable until authoritative authenticated D1 reconciliation and separate owner cutover.

## Review Focus
- Same Return ID but different header/child Invoice IDs changes refund attribution.
- Orphan child Return ID silently omitted in source active-child filtering.
- Deleted header/child must not cause false active-money evidence.
- Duplicate Return ID makes child ownership ambiguous; duplicate Sales invoice ID makes destination ambiguous.
- Missing sale parent and empty active return child set require review, not zero-return fabrication.

### Task 1 — RED source-lineage behavior
**Files:** Add `tests/m09-sales-return-report-lineage-audit.test.mjs`.
**API:** `auditM09SalesReturnLineage(snapshot)`.
- [ ] Test valid multiple returns and source handling of deleted parents/children.
- [ ] Test mismatched child Invoice ID, orphan active child, missing/deleted source sale, duplicate Return ID/sale ID, empty header.
- [ ] Test no source leaks, own-data getter safety, no mutation, never-ready output.
- [ ] Commit before production code; observe actual GitHub Actions RED failure for missing module on test-only SHA.

### Task 2 — GREEN minimum pure auditor
**Files:** Create `src/modules/m09-sales-return-report-lineage-audit.js`.
- [ ] Validate fully loaded dense original arrays and plain own-data rows.
- [ ] Use original `Is Deleted` semantics, exact string Return/Invoice IDs and non-mutating maps/sets.
- [ ] Produce only fixed unique codes, `ready:false`, `lineageComplete`, `status` with no financial totals.
- [ ] Run focused tests, full `npm test`, `npm run verify:source`, and exact-head GitHub CI. Real D1 is **not claimed** for this pure task.

### Task 3 — PR review and integration
- [ ] Use required PR template with workstream, dependencies, owner, path list, source SHA and RED/GREEN evidence.
- [ ] Verify compare vs latest main and zero overlap with other modules.
- [ ] Keep PR open for owner review until full CI green. Future M03 integration requires separate signed contract and PR.
