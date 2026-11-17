# M01 / #25 — Repeated browser print dialog isolation across A4 and thermal formats

**Date / module:** 2026-11-17, M01 original-UI Playwright QA  
**Coordination:** `AGENTS.md`, `docs/PARALLEL_EXECUTION.md`, issue #456  
**Base:** `main@7c81dca09f975fbda37586eb50c2763c7f8506df` (M01 #499 merged)  
**Source provenance:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/**` unchanged  
**Depends on:** merged #494 compiled CSS fix, #476 responsive POS V2 QA, #499 keyboard/search QA, existing M01 A4/58/80 print lifecycle tests  
**File owner:** M01 QA exclusively  
**Changed files:** `qa/m01-print-flow.spec.mjs`, new `qa/m01-print-sequence-fixture.mjs`, this plan.  
**Read/write:** synthetic Chromium DOM and review-only screenshots in existing `test-results/m01-browser`; **no** prod DB/RPC/schema, physical printer, source HTML or backend.  
**Merge order:** own branch and PR to current `main`, full current-head Playwright/CI, review, squash merge, verify main.

## Superpowers acceptance and implementation (13 sentences)

1. The original source `printInvoice_` uses `#invoicePaper` as its source preview and `#printHost` as a temporary printable copy.
2. It must add `body.printing-invoice` only while `window.print()` is invoked and remove it even if printing throws.
3. Existing tests check A4 and 58mm/80mm individually, but not multiple print formats in one live Chromium document after a cancelled dialog.
4. Add a Playwright browser test to the existing M01 Chromium gate and exercise the unmodified original compiled UI at a 320px touch phone and 1280px desktop.
5. Use only synthetic item/brand/amount/phone-free invoice fixtures; do not authenticate or fetch a real sale.
6. Start with the locked original login overlay and confirm the protected app remains hidden throughout.
7. Invoke A4, 58mm, 80mm, and A4 again sequentially in the same page without rebuilding its DOM.
8. Intercept the physical print dialog with a synchronous stub that observes the genuine `#printHost` DOM while `printing-invoice` is active.
9. Deliberately throw a synthetic print-dialog cancellation/error on the 58mm attempt, then invoke a normal 80mm print to prove recovery.
10. For every format assert one in-flight printable wrapper with the right thermal/58mm classes and exactly one synthetic line, and never a stale wrapper from the previous attempt.
11. After every attempt assert that `#printHost` is empty, `printing-invoice` removed, the locked shell remains locked, and the original preview markup is retained.
12. Save a synthetic evidence screenshot at each viewport and assert no RPC posts or business writes happen because of preview printing.
13. Commit the acceptance test before its deliberately separate reusable M01 synthetic print fixture (RED), then add only the minimal fixture (GREEN) and verify all real browser and repository checks before merge.

## Invariants and release boundary

Tests call the real pinned `printInvoice_` but stub only the operating-system print dialog; this is not proof of physical printer output, receipt hardware feed/cut, or production financial posting. Existing native Chromium PDF and thermal width checks remain separate in the same mandatory CI. Do not change `legacy/source`, `scripts/build-frontend`, public Worker or common `src/db` / posting paths. This is M01 presentation-only QA. If source behavior fails, keep the RED regression and coordinate the minimal compiled source-safe fix with M03/M01 rather than editing protected UI files from this branch. Rollback is a three-file M01 QA-only revert.
