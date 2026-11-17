# M01 HisabIQ Dashboard — Step 1/3: Visual Parity & Responsive Structure

Issue: #567 · Existing draft PR: #570 · Owner approved three-step UI completion (2026-11-17).
Reference: `shuvodelux-commits/hisabiq_ui` main at `0b7a94faae94f5a3aa0e24a71e2226d4c2cf6327`.
Target at intake: `SherERP_Cloud` main `76cca6a9b107603cc19a727a6907c7602cddd011`.
Workstream: M01, isolated compile-only UI. M03 owns shared D1, RPC, auth and posting. M09 owns business reporting reads. No original source edits.
Reserved writes: `src/ui/hisabiq-dashboard.html`, `tests/m01-hisabiq-dashboard.test.mjs`, `qa/m01-browser.spec.mjs`, this plan. Existing PR #570 owns all these paths.

## 12-sentence implementation overview
1. Step 1 establishes visual parity for the *already created* compiled dashboard without adding any business data or API.
2. The six reference metric cards remain the default and the extra SherERP summary fields stay optional and hidden.
3. Their metric icons use actual inline Lucide-style SVG geometry instead of mismatched text glyphs.
4. The top heading follows the reference inline English/Bangla hierarchy, date, and authenticated business identity.
5. Brand color, typography, card radius, spacing, and panel header dividers mirror HisabIQ theme tokens and component layout.
6. The existing six-card desktop, three-card tablet and two-card phone grid remains responsive across widths.
7. The panel grid uses one/two/three columns at reference breakpoints, with double-span Sales Trend and Recent Sales only on extra-wide screens.
8. Chart cards reserve a proper reference-sized display area with accessible **unavailable** status, without invented points, axis values, or financial totals.
9. The customization dialog preserves its existing interactive hooks, control identifiers and keyboard affordances for the next step.
10. All existing original dashboard IDs, mobile quick actions and the immutable `getDashboardStats` flow stay intact.
11. Tests fail first for the missing SVG icons, bilingual header and display geometry; only then do we implement the minimum markup/CSS change.
12. Step 1 is accepted only after source/build tests plus Playwright desktop/tablet/phone layout and screenshot checks pass against current head.

## Three-step delivery boundary
1. **Step 1 — Visual fidelity:** source-exact colors, fonts, icon scale, header, panels, responsive grids, actual screenshots and accessibility.
2. **Step 2 — Customization hardening:** drag and keyboard reorder, hide/show, reset, persistence for actor/tenant/session changes, dialog traps, failure paths.
3. **Step 3 — Navigation & final UI acceptance:** existing route click-through, authorized record drilldown where available, loading/denied states, screenshots and end-to-end final report. M03/M09 data contracts remain separately gated.

## Acceptance
- Render six source-identical metric headers/icons and four source panel headers with 12px gaps, 14px padding, rounded cards and header dividers.
- Welcome text and English/Bangla dates use safe text nodes, no unsafe HTML or fake amounts.
- Grid columns: 320–767 = 2; 768–1279 = 3; 1280+ = 6 for metric cards; panels 1/2/3 at 1024/1280.
- No horizontal viewport scroll at 320, 390, 768, 1440; screenshot names include widths for comparison.
- Reference chart panel body holds 220px display space with truthful unavailable state.
- No touch to `legacy/source/**`, `src/db/**`, `src/rpc/**`, shared posting infrastructure or Worker deployment.

## Evidence
RED CI: pending a failing test run for first test commit.
GREEN CI: pending implementation and current-head full checks.
Screenshot artifacts: `m01-browser-evidence` from required Playwright workflow.
Rollback: revert Step 1-only visual changes; template and data contract remain isolated.
