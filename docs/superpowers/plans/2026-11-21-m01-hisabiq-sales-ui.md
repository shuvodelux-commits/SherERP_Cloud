# M01 HisabIQ Sales UI Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the reference Sales UI to the existing backend-connected SherERP Sales page without reimplementing financial workflows.

**Architecture:** Add a compiled-only CSS/JS enhancement through the current frontend assembler, preserving original Sales HTML and loaders. Use the existing `smState.sales` read model for presentation; no new RPC or D1 writes.

**Tech Stack:** Native HTML/CSS/JS, Node test runner, Playwright Chromium, existing Cloudflare Worker/Shop D1.

**Spec:** `docs/superpowers/specs/2026-11-21-m01-hisabiq-sales-ui.md`

## Global Constraints
- GitHub main is canonical. One scoped M01 branch/PR; no direct main changes.
- Original legacy/Sales source and financial APIs remain byte-identical.
- Reference `hisabiq_ui@e42a00a`; target breakpoints 320/390/768/1024/1440.
- Disabled Owner financial commands remain disabled; no new backend or D1 writer.
- Test-first RED→GREEN, source verification, browser QA, review before merge.
- /ui-refine-skill and /ui-refine-loop only if actually available; otherwise note unavailable and perform screenshot-led iteration.

## Review Focus
- A failed or unauthorized invoice-list response must not be reported as a successful zero-sales load.
- Duplicate historical invoice IDs must remain guarded, not turned into working row actions.
- Mobile search and action menus must remain operable without horizontal page overflow.
- Sorting/pagination must never modify server records or suppress row action IDs.
- 0/negative/partial/returned amounts must never be recomputed as a financial posting.

### Task 1 — Compiled-only injection and source guard
**Files:** `scripts/patch-hisabiq-sales.mjs`, `scripts/build-frontend.mjs`, `tests/m01-hisabiq-sales-ui.test.mjs`
- [ ] Write tests for exact page/id requirements, duplicate rejection, harmless fixture fallback, original financial RPC preservation, owner compilation.
- [ ] Run RED against unmodified branch.
- [ ] Implement minimal compiled CSS/JS injection; compile and run GREEN.
- [ ] Verify frozen source manifest.

### Task 2 — Reference visual and accessible controls
**Files:** `src/ui/hisabiq-sales.css`, `src/ui/hisabiq-sales.js`, `qa/m01-hisabiq-sales-browser.spec.mjs`
- [ ] Write failing browser assertions for Sales header, authentic summary, columns, sorting, reset, page navigation and mobile touch layout.
- [ ] Implement DOM adapter reusing native `smState`, `smRender` and `goToPage`.
- [ ] Run Playwright matrix including modal, empty/error, focus, reduced motion, desktop/mobile.
- [ ] Inspect reference vs actual screenshots and refine.

### Task 3 — Review and integration
**Files:** `docs/reviews/m01-hisabiq-sales-ui-refine/README.md` and PR.
- [ ] Run Node/Playwright/source/docs verification and inspect exact failures.
- [ ] Confirm no overlapping PR file ownership, source/D1/RPC changes or financial writer.
- [ ] Open PR with changed-file inventory, screenshots, RED/GREEN evidence, explicit unverified gates and production release instructions.
