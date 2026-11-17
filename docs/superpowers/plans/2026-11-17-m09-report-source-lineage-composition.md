# M09 Report Source + Return Lineage Evidence Composition Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development. TDD RED must be observed before GREEN.

**Goal:** Prevent the six-report source evidence manifest from treating a return lineage review Boolean as sufficient without actual source-lineage audits.

**Architecture:** One pure M09 composition function wraps three already merged M09 pure evaluators. No new external dependencies, no upstream module modifications and no live report activation.

**Tech Stack:** ESM Node `node:test`; GitHub CI, same frozen legacy sources.

**Spec:** `docs/superpowers/specs/2026-11-17-m09-report-source-lineage-composition-design.md`

## Global Constraints
- M09 owns only this plan, spec, `src/modules/m09-report-source-lineage-evidence.js`, `tests/m09-report-source-lineage-evidence.test.mjs`.
- Start from fresh `main@bcd2d3adbd03f35612c50c1a144a472b1683b412`; merged #450/#459/#473 are prereqs.
- Do not change `src/db/**`, `src/rpc/**`, `migrations/**`, `src/index.js`, Worker bindings, shared posting, the original GAS/HTML files or any public report endpoint.
- `ready:false` is invariant; no ready-to-report claim based on synthetic manifests.

## Review focus
- Complete reviewed manifest with missing Sales snapshot blocks Sales+Profit only.
- Complete reviewed manifest with missing Purchase snapshot blocks Purchase+Profit only.
- Wrong child parent key or orphan in either return audit blocks exactly dependent reports.
- Getter/prototype/sparse array source inputs fail closed without executing getters or leaking IDs.
- Source receipt count/review drift stays blocked independently; no source or input mutation.

## Task 1 — RED
- [ ] Commit new standalone tests of the composition gate, without implementation.
- [ ] Verify full GitHub Node test log has expected missing-function test failures and unaffected tests pass.
- [ ] Preserve RED commit and CI link in PR description.

## Task 2 — GREEN
- [ ] Write minimal module importing `evaluateM09ReportsSourceEligibility`, `auditM09SalesReturnLineage`, `auditM09PurchaseReturnLineage`.
- [ ] Return only predetermined redacted lineage blocker codes and preserve existing report keys.
- [ ] Run focused and complete Node tests, frozen source checks, and all required local Workerd/D1 CI on current head.
- [ ] Preserve exact GREEN log/check evidence.

## Task 3 — Review/integration
- [ ] Open one draft PR to main, list exact paths, dependencies, source baseline and test proof.
- [ ] Review current main, no ownership overlap or unreviewed shared modifications.
- [ ] Owner-approved merge only with all exact-head checks and required reviews; then verify files landed on main and update Issue #431.

**Rollback:** Revert the four M09-only new files. No financial, D1 or source migration rollback.
