# M09 Reports UI control QA — test-first plan

**Goal:** Prove with real Playwright/browser DOM that original Reports Print and date-cache states require the merged M09 guard before production wiring.

**Base:** main `892115db23b9dead40dce9ed1c69b536d11c0b6c`. **Issue:** M09 #431. **Dependency:** merged #583. **Ownership:** M09 QA `qa/m09-report-control-browser.mjs`, `qa/m09-report-print-preview.js`, M09 docs/spec only; M01 owns deployed frontend. M03 owns shared D1/RPC.

## RED
1. Commit `qa/m09-report-control-browser.mjs`, plan and spec from latest main first.
2. Run `node qa/m09-report-control-browser.mjs --assert-fixed` against the exact GitHub test-only head, with Playwright Chromium. Verify it fails because original Print is allowed before load or date cache remains present.
3. Capture original mobile/desktop screenshot and JSON evidence in ignored local `test-results`.

## GREEN nondeployable preview
1. Add only `qa/m09-report-print-preview.js`, which evaluates the already-merged pure state inspector in an isolated browser script and intercepts Print/caches on test-only events. Do not modify built output.
2. Run `node qa/m09-report-control-browser.mjs --proposal --assert-fixed`: print blocked before load, stale date cache invalidated, no stale print; six tabs and keyboard work.
3. Run full `npm test` with locked packages/CI-equivalent timezone, `npm run verify:source`, source-preserving Chromium smoke and required exact-head 44+ GitHub Actions.

## Handoff
1. PR to main with screenshots/evidence and RED→GREEN logs; no original frontend edits.
2. Follow M01 Issue #25 with proposed UI integration lifecycle; avoid dashboard/Products PR overlap.
3. Merge only with all required CI/review. Verified merged proof is NOT a deployed Reports control patch.

**Rollback:** revert M09-only QA and docs. No data/schema/frontend rollback.
