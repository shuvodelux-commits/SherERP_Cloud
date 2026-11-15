# M02-P Finance Gross Soft-Delete Parity Plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven-development; watch GitHub RED before minimal GREEN.

**Goal:** Make offline Finance gross-account preflight match the established source export's case/whitespace treatment of `Is Deleted`.
**Architecture:** Modify exactly one string comparison in `src/party/gross-balance-preflight.js` to trim around `TRUE`; reuse existing deleted-row skip and counters. No new functions/dependencies, no source or DB behavior changes.
**Tech:** Node ESM, `node:test`, full GitHub Actions.
**Spec:** `docs/superpowers/specs/2026-11-15-m02-finance-gross-soft-delete-parity-design.md`.

### Constraints
GitHub-only branch and PR; original source pin `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` remains immutable. No D1 imports, migrations, Worker auth/RPC, financial or cash posting, identity auto-merge, original UI or source GAS changes. No parallel PR file overlap. KISS and approval gate. `PARALLEL-MODULE-READY=false`.

### Task 1: Finance soft-delete parity

**Files:** create `tests/m02-gross-finance-soft-delete-parity.test.mjs`; modify `src/party/gross-balance-preflight.js` (the `deleted` predicate only); add spec and plan.

1. **RED**: Commit synthetic tests first. Check padded TRUE and tab/newline padded lower-case flags exclude transaction amounts, track deletion counts, avoid false active-ID collisions, skip deleted blank amounts, preserve active FALSE and boolean/bare TRUE; ensure no input mutations, no money postings.
2. **Observe RED**: Open draft PR and inspect actual GitHub Foundation failing tests; expected failures must be direct `prepareGrossPartyBalances` behavior.
3. **GREEN**: Change one predicate to `string(row?.['Is Deleted']).trim().toUpperCase()==='TRUE'`. Do not modify other business logic.
4. **Verify**: Capture exact-head Node/source/frontend tests, local M02 Workerd/D1 proof and synthetic rehearsal, M03/M04 Workerd D1, M01 Chromium and Cloudflare PR safety. Report all failures/pending accurately.
5. **Review**: Confirm four-file patch, lack of overlap, and PR mergeability. Record RED/GREEN evidence, rollback (revert PR), and no production impact. Leave PR draft for owner review.
