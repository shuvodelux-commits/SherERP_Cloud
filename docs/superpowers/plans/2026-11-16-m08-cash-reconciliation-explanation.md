# M08 Cash Reconciliation Explanation Read Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an internal, read-only Cash Reconciliation explanation evaluator matching frozen source behavior.
**Architecture:** Keep a pure JS projection separate from D1, authentication, sessions and posting. Compare structured results to selected original GAS functions in a restricted synthetic Node VM.
**Tech Stack:** JavaScript ES modules, node:test, existing Acorn VM source fixture.
**Spec:** `docs/superpowers/specs/2026-11-16-m08-cash-reconciliation-explanation-design.md`.

## Global Constraints

Source pin `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; do not edit `legacy/**`, migrations, `src/db`, RPC, frontend or deployment. Internal read-only calculations only. No cash/bank movement or cross-role account netting.

## Review Focus

Malformed/promised array, deleted linked entry, duplicate linked IDs, overlinked difference, baseline/zero difference and input mutation. Require tests for each.

---

### Task 1 — Characterization + RED

**Files:** Modify `tests/fixtures/m08-legacy-source-runner.mjs` allowlist only; create `tests/m08-cash-reconciliation-explanation.test.mjs`.
**Interfaces:** `evaluateCashExplanation(difference,storedEntryIds,cashRows,{isBaseline}={})` yields legacy status and amounts; test oracle loads eight selected original GAS functions.

- [ ] Write synthetic tests comparing to source for baseline, no variance, zero with links, exact positive/negative, invalid/deleted/synthetic/wrong-direction, missing/overlinked, duplicate formats, immutable and unloaded inputs.
- [ ] Run `node --test tests/m08-cash-reconciliation-explanation.test.mjs` before implementation: verify expected missing implementation module (RED).
- [ ] Record RED output / commit SHA in the PR.

### Task 2 — Minimal GREEN implementation

**Files:** Create `src/modules/m08-cash-reconciliation-explanation.js`.
**Interfaces:** `export function evaluateCashExplanation(difference,storedEntryIds,cashRows,{isBaseline=false}={})`.
- [ ] Implement minimum source-faithful pure calculation with synchronous input guard, original ID normalization/sign semantics, and no mutations.
- [ ] Run targeted test, then `npm test`, `npm run verify:source`, `npm run build:frontend`; preserve CI output as evidence.
- [ ] Commit implementation and update PR with RED/GREEN, source provenance, affected files, no-D1/test limitations and rollback (revert PR).

### Task 3 — Review and merge gate

- [ ] Confirm GitHub CI green for final head; check PR diff for any runtime wiring or financial mutations.
- [ ] Leave PR for owner review; do not merge, enable settlements, import production data, or deploy functioning ERP.
