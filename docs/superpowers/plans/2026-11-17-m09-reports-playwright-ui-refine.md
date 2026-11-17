# M09 Reports Playwright refinement proof — implementation plan

> **For agentic workers:** use Superpowers RED→GREEN for the visual regression and keep its proposed UI implementation nondeployable until M01 owner review.

**Goal:** Capture current Reports UI truth, verify a small mobile toolbar alignment fix with Playwright, and hand an evidence-based patch to M01 without changing frozen source or public report behavior.

**Architecture:** Reuse the real `qa/serve-compiled-ui.mjs` local test server and existing compiled Reports DOM. The script injects synthetic data only for screenshots. Apply `docs/reviews/m09-reports-ui-refine/proposal.css` only in the proposal mode.

**Tech Stack:** Node 22+, Playwright Chromium, preserved original HTML/CSS/JS and Node test/CI scripts.

**Spec:** `docs/superpowers/specs/2026-11-17-m09-reports-playwright-ui-refine-design.md`.

## Tasks
- [x] Read fresh main/AGENTS/parallel board/Issue #431 and verify M01 frontend ownership.
- [x] Capture original 1440px desktop and 390px mobile Playwright full-page screenshots with synthetic data only.
- [x] Record the baseline RED defect: From y=68 and To y=122 at 390px.
- [x] Write report-scoped CSS proposal without touching production UI or frozen source.
- [x] GREEN screenshot check: both date inputs y=91 and 179px wide, report action buttons aligned, no viewport overflow, desktop toolbar unchanged.
- [x] Save before/after PNGs and source viewport metrics; document partial/tab/scroll review findings.
- [ ] Open one M09-only draft PR for script, proposal, screenshots and notes.
- [ ] Run complete required exact-head CI and M01 handoff/review, merge only after all required gates.
- [ ] M01 to integrate approved styling in separate owned PR, then repeat visual/functional browser verification; do not represent M09 evidence as deployment.

## Review focus
1. Screen must preserve all six Reports tabs and original IDs/handlers, including horizontal scroll/focus.
2. Mobile From/To controls must align and remain finger-target-sized.
3. Desktop Reports layout must remain unchanged.
4. Source checksum must remain valid, no frozen source edits.
5. No production Reports RPC, auth bypass, D1 read/write or financial totals introduced.

**Rollback:** remove M09-only QA script, screenshots, preview CSS, and docs. There is no source/data migration.
