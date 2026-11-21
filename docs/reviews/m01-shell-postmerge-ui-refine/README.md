# M01 post-merge HisabIQ Shell UI refinement — before/after

**Pinned base:** `SherERP_Cloud@9670c5e2` (merged PR #860). Source design: `hisabiq_ui@e42a00a`. **This is synthetic authorized browser fixture evidence, not authenticated live D1/financial proof.** Captured with actual Chromium/Playwright on 21 Nov 2026.

| Width / state | Before | After | Finding |
| --- | --- | --- | --- |
| 1024px desktop split | [Before](before-1024-desktop.webp) | [After](after-1024-desktop.webp) | Header title previously truncated; adjusted compact-desktop spacing while keeping search and existing actions |
| 390px drawer open | [Before](before-390-drawer.webp) | [After](after-390-drawer.webp) | Visual geometry retained; added focus containment, modal `inert`, auth-loss dismissal |
| 320px bilingual long name | RED: drawer scrollWidth 452 vs clientWidth 274 | [After](after-320-long-business.webp) | Footer wraps a long mixed-script business label without horizontal overflow |

The M01 Chromium QA workflow retains all **after** states under `m01-browser-evidence/hisabiq-shell` (from `test-results/m01-browser/hisabiq-shell/`), including 320/390/768 drawer, reduced motion, 1024 split and 1440 desktop. QA checks source-role filtering, modal Escape/Tab behavior, auth fail-closed, 1024 visible module search, 320 long text and no overflow.

The exact `/ui-refine-skill` / `/ui-refine-loop` executable was not available in the installed skill registry or local device. The applicable source-locked screenshot inspection, refinement and real Playwright checks were performed instead; the existing M01 `ui-refine-loop` *test* separately captures baseline login/More in light and dark emulation. Do not assert the unavailable named skill ran.
