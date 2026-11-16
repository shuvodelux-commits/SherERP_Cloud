# M08 Cash Reconciliation Session Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project source-faithful Cash Reconciliation session overview rows for audit without financial writes.

**Architecture:** Read-only internal ES module; reuse existing `evaluateCashExplanation` and `safeSourceDateOnly` helpers. Compare each result to frozen GAS `cashReconciliationBuildRows_` using Node test VM and synthetic rows.

**Tech Stack:** Plain ESM, Node test, existing pinned GAS test fixture, existing Cloudflare CI.

**Spec:** `docs/superpowers/specs/2026-11-16-m08-cash-reconciliation-session-overview-design.md`.

## Global Constraints
- GitHub branch PR only; no source repo edits, D1/schema, Worker RPC, browser changes, financial writes or previews with binding.
- Source frozen at `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
- Accept only loaded record arrays, require explicit trusted timeZone.
- No netting customer/supplier/vendor/owner/loan/advance accounts or enabling M08-S offsets.

## Review Focus
- Session chronology sorted independently of incoming row order.
- A closing session or a Closed session without counted amount cannot seed the next opening.
- Explicit `Variance: 0` must not be mistaken for absence.
- Explanation linkage must not alter cash; missing/wrong-sign/deleted IDs go to review.
- Repeated use must not mutate frozen input, and Promise/array shape errors must fail closed.

---

### Task 1: RED source parity tests

**Files:** Create `tests/m08-cash-reconciliation-session-overview.test.mjs`.

**Interfaces:** 
- New `projectCashReconciliationSessions(sessionRows,cashRows,{timeZone})` returns array of source-shaped overview objects.
- Source oracle needs `Utils.gs:roundMoney_,formatDate_,safeDateOnly_` plus `CashReconciliation.gs` signed/delete/synthetic/ID helper/evaluate/sort/build functions. Test stub only: Session timezone Asia/Dhaka; Utilities.formatDate via Intl.

- [ ] Commit tests before implementation; compare full object deep equality to original GAS for unsorted sessions, closed/open/closing state, historical baseline, explained and invalid links, zero/blank money, explicit variance, timezone and invalid inputs.
- [ ] Verify expected `ERR_MODULE_NOT_FOUND` from `node --test tests/m08-cash-reconciliation-session-overview.test.mjs` on GitHub Actions (`npm test`).

### Task 2: GREEN minimal implementation

**Files:** Create `src/modules/m08-cash-reconciliation-session-overview.js`.

- [ ] Use existing read helper functions only; no new deps.
- [ ] Make session copies, sort by source key, advance prior Closed counted cash iff present; compute original opening/closing fields and statuses; keep balances gross and no persistence.
- [ ] Verify full `npm test`, `npm run verify:source` and `npm run build:frontend` via GitHub Actions logs. Confirm direct suite tests pass, not just build.
- [ ] Document RED/GREEN commits and verification evidence in PR.

### Task 3: Review

- [ ] Review diff file/table/RPC inventory and ensure zero writes, schema changes or external source edits.
- [ ] PR against fresh main; check all CI results; leave for owner merge.
