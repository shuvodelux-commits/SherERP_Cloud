# M09 Stock Report Product ID integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, verifying RED before GREEN.

**Goal:** Reject source-corrupt Product IDs in the internal Stock & Valuation Report instead of silently grouping them into invented identities.

**Architecture:** Single private, pure projector guard, no new abstraction or DB access. Pinned source semantics remain unchanged on valid input.

**Tech Stack:** Node >=22, native `node:test`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-17-m09-stock-report-product-id-integrity-design.md`

## Global Constraints

- GitHub-first PR; immutable original `legacy/source` and Sheets.
- No public RPC, frontend change, schema, financial write, or Cloudflare deployment.
- Exact source Product ID text preserved for grouping; no Party merging, no netting.
- RED test commit must precede implementation; observe actual failing CI.
- Run full `npm test`, source manifest verification, and affected M09 regression after GREEN.

## Review Focus

- Missing/blank own Product ID, not inherited/accessor
- Positive and nonpositive legacy lot entries with missing identities
- Valid exact ID string preservation and orphan-lot historical compatibility
- Zero unintended mutation of report sources
- No production D1 or public RPC activation

### Task 1 — RED: source-corrupt Product identity rejection

**Files:** Create `tests/m09-stock-report-identity-integrity.test.mjs`.

**Interface:** Existing `projectStockReport({activeProducts,stockLots})`.

- [ ] Add table-driven negative cases for Products and Stock Lots and valid-input fixture.
- [ ] Commit tests before production code, open scoped draft PR, verify actual `npm test` failure on GitHub Actions for the new behavior.

### Task 2 — GREEN: narrow Product ID guard

**Files:** Modify `src/modules/stock-report-read.js` only.

- [ ] Make the existing `id(value)` reject non-string or whitespace-only Product IDs, keeping original exact valid ID string.
- [ ] Verify `node --test tests/m09-stock-report-identity-integrity.test.mjs tests/m09-stock-report-read.test.mjs`, `npm test`, `npm run verify:source`, and PR checks.
- [ ] Refactor only if necessary; no behavior change outside source-invalid input.

### Task 3 — Review

- [ ] Document RED/GREEN SHAs, actual CI evidence, changed paths and limitations.
- [ ] Keep PR unmerged until owner review and exact-head green checks.
