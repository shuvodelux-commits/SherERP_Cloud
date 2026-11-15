# M09 Report Date Window Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and test-driven-development, with actual RED → GREEN observations.

**Goal:** Implement source-faithful, deterministic date windows for a future M09 read-only report query.
**Architecture:** A single pure ESM module, Node tests with the pinned `Reports.gs` function bodies as an isolated oracle, and no database or RPC integration.
**Tech Stack:** Node.js 22+, node:test, node:vm; no dependencies.
**Spec:** `docs/superpowers/specs/2026-11-15-m09-report-date-range-design.md`

## Global constraints
- GitHub-only branch and PR; zero source or runtime endpoint mutations, no local PC tooling.
- Preserve source's lexicographic date filters and reversed-range swap, but fail closed for invalid caller-supplied trusted shop date and noncanonical row date.
- Explicit shop-local `today` input, never implicit browser/Worker clock.

## Review focus
- Reversed ranges must swap, not yield empty results.
- Invalid/missing *one* end only defaults that end, not the whole range.
- Include exact first and last dates, exclude one day outside each boundary.
- Never use UTC conversion of an invoice timestamp as if it were a shop-local date.
- No silent mutation of filters, no invocation of getters/inherited properties.

### Task 1: Test-first source-equivalence contract
**Files:** `tests/m09-report-date-range.test.mjs`.
**Consumes:** frozen `legacy/source/Reports.gs`; requires exact helper functions by name.
**Produces:** expected exports from `src/modules/report-date-range.js`.
- [ ] Add oracle extraction of original `reportRange_` and `inRange_` functions, with deterministic shop-local `today` and sanitized input, running inside Node VM.
- [ ] Assert source parity for empty, partial, reversed, today, month boundary, trim and regex-malformed inputs; inclusive boundaries, no mutation; reject unsafe caller context.
- [ ] Commit test alone, draft PR, observe expected missing-module RED in GitHub Actions.

### Task 2: Minimal adapter
**Files:** `src/modules/report-date-range.js`.
**Produces:**
- `normalizeReportRange(filters,today)`
- `dateInReportRange(dateOnly,range)`
- `reportDefaultRange(today)`
- [ ] Implement minimal pure read-only functions using the source lexical regex/fallback/swap and explicit trusted date.
- [ ] Verify focused tests, full `npm test`, `npm run verify:source`, `npm run build:frontend` and existing GitHub Actions on final exact head.
- [ ] If shared CI failures persist, report exact tests and refer to appropriate upstream owner; do not change shared auth/DB.

### Task 3: Review and handoff
- [ ] Inspect diff and test/oracle behavior; document affected files, pinned source functions, RPC/tables impact, RED/GREEN evidence, uncovered M09 totals and real D1 gates.
- [ ] Leave PR draft unless full CI green and independently reviewed; never auto-merge, never enable production reports.

**SQL/tables:** none. **Financial/account/Party effects:** none. **Original frontend:** untouched. **Rollback:** revert isolated new files.
