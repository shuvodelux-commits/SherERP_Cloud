# M01 — Original POS V2 pointer reorder browser parity

**Date:** 2026-11-20  
**Issue:** #754; previous M01 #747 / merged PR #749  
**Branch:** `m01/posv2-pointer-reorder-qa-20261120`, base `main@9591444b105af09487fc251a583b0f007bf74645`  
**Frozen original:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`

## Superpowers implementation overview

1. The original M01 browser suite now covers real keyboard product selection, cart quantity editing, item removal and empty-cart state, merged through #749.
2. POS V2 still has an unverified drag-to-reorder interaction implemented in its frozen `posv2.html`.
3. This test exercises that behavior with authentic Chromium mouse pointer events rather than calling the internal reorder function to fabricate success.
4. The two test products are synthetic standard stock items inserted only into an isolated Chromium tab's original `posState`.
5. The browser logs in through the same M01-only synthetic Clerk fixture without granting product administration or backend posting permissions.
6. The test runs in phone 390×844 and desktop 1280×800 viewport configurations.
7. Each run creates two populated source cart rows with different quantities, units and selling prices, then renders the source POS V2 cart.
8. It verifies actual accessible drag handles and the preserved mobile or desktop row numbering.
9. Dragging the first product after the second must change only row order, leaving product IDs, quantity, unit price, computed line totals and total unchanged.
10. Re-rendering the original cart must never accumulate extra reorder handles or duplicate item rows.
11. The test checks that no sale, draft, payment or ledger-writing RPC reaches even the inert public Worker, and saves only synthetic screenshots.
12. Source UI, M03 integration, M05/M06 posting, D1 migrations, finance, runtime and Cloudflare configuration remain untouched until separately approved integration.

## Ownership and TDD

Exclusive changed paths: `qa/m01-landscape.spec.mjs` (append only) and new `docs/superpowers/plans/2026-11-20-m01-posv2-pointer-reorder-qa.md`. Read-only dependencies: `qa/m01-auth-nav-fixture.mjs`, `qa/serve-compiled-ui.mjs`, `legacy/source/pos.html`, `legacy/source/posv2.html`, `AGENTS.md` and parallel-readiness coordination.

Implement test first and execute it in GitHub Chromium. This is test-first coverage of behavior already implemented in the original source, so a truthful baseline GREEN is acceptable. On genuine RED, inspect browser evidence before modifying the test; any production source defect requires an M03/M01 coordination handoff instead of unauthorized shared edits.

**Acceptance gates:** real Chromium mobile/desktop test passing, source print/navigation suites remain passing, all exact-head GitHub CI green, independent QA/review evidence in PR, explicitly user-approved merge. No automated merge. No genuine multi-unit or Tile sales asserted—those are separately blocked by M03/M05/M06/M08 authorization and accounting gates.

**Rollback:** delete this one appended test and the new M01 plan. No production behavior or customer data changes.
