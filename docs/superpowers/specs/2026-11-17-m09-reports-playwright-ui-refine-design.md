# M09 Reports visual refinement handoff — nondeployable UI QA

**Base:** main `59b0e2e4b7184acf2f3645aca32da1cb1c6d5cb3`. **Issue:** M09 #431; M01 integration #25; coordination #456.

SherERP Cloudflare preserves the original HTML/CSS/JS UI, and the M09 module currently returns `ready:false` for all financial reports. User requested a `ui-refine-loop` polish and actual Playwright screenshots. Rather than change frozen `legacy/source` or M01-owned compiled build assets, this handoff stores a reproducible before/after *preview* of one report-scoped mobile CSS layout adjustment.

The two date fields wrap unevenly at 390px in original `reports.html`, while desktop remains readable at 1440px. The proposed CSS changes only `#page-reports > .toolbar` at `max-width:540px`, aligning two labels above two equal-width date fields and two rows of action buttons. It preserves all six tab names and their horizontal scroll state, adds a minimal right-edge cue, and retains the original palette and button sizes. No separate dark theme exists in current original CSS; do not create fake dark captures. Screenshots display synthetic Sales figures only and reveal a local test-only view; they never claim to be authenticated or live.

**Owner boundary:** M09 owns `qa/m09-reports-refine-preview.mjs`, this design and plan, and `docs/reviews/m09-reports-ui-refine/**` evidence. M01 owns any change to the original source UI/build pipeline. No component framework, API, Worker, production D1, financial report logic, or shared posting edits are authorized here.

**Acceptance:** reproducible Playwright RED before CSS, GREEN after proposed CSS, 390px date alignment, no document-level horizontal overflow, report tabs remain scrollable, unchanged desktop toolbar geometry, zero page errors, four screenshots, exact owner handoff. Proposed CSS is **not deployed** by this PR. Any later integration requires an M01-owned reviewed PR and full CI.
