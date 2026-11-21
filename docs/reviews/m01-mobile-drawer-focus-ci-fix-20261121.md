# M01 — Chromium mobile modal focus containment fix (21 Nov 2026)

**Trigger:** PR #874 (M03 Owner Invoice Studio API) reported 82 successful checks and one failure in the shared **M01 Chromium desktop/mobile/synthetic A4 print smoke QA**. The failing job was `44871468818/job/136746725866`; 168/169 browser checks passed, but `qa/m01-hisabiq-shell-browser.spec.mjs` at line 177 reported `false !== true` after a Tab key while the mobile ERP drawer was open at 320/390/768px. This test is independent of Invoice Studio and reproduces the same user concern about intermittently failing M01 PR checks.

## Cause and minimal correction

The drawer is correctly outside the inert `#app`, but its existing `onDrawerKeydown` handler only prevented native Tab navigation when focus was at the first or last focusable control. Inside the panel it otherwise relied on browser-native tab order; Chromium could escape into the backdrop/another region during responsive reflow. The fix keeps the original dialog, navigation and animation intact, while explicitly calling `preventDefault` and `stopPropagation` for **every** Tab when the drawer's key handler is installed. The currently visible focusable controls are enumerated on each keypress; Tab and Shift+Tab move to the next/previous control with wraparound, and detached/outside focus returns to the correct first/last control. Escape, click, swipe, mobile/desktop transitions and permission filtering remain unchanged. The app is still inert during the modal and restored afterward.

## Test-first evidence

1. **RED:** new Playwright test `mobile drawer explicitly owns every Tab/Shift+Tab key while modal is open` focuses the Close button and dispatches a cancellable Tab; old handler did **not** prevent default (0/1).
2. **GREEN:** after updating `src/ui/hisabiq-shell.js`, both the formerly failing 320/390/768 assertion and the new test pass (2/2).
3. **GREEN:** complete local `qa/m01-hisabiq-shell-browser.spec.mjs` suite 12/12 across desktop/tablet/mobile, keyboard, auth-loss, resize, user menu, overflow and reduced-motion.
4. The full M01 GitHub smoke job (including invoice print and 100+ other checks), original source verification, docs check and exact-head CI remain merge gates. Do not claim production print parity or mark an unrelated PR green until its own checks pass.

**Ownership:** M01-only `src/ui/hisabiq-shell.js`, `qa/m01-hisabiq-shell-browser.spec.mjs` and this review. No changes to Worker, authentication, migrations, finance, POS, invoice preview, other M01 Product/POS PRs or original `legacy/source` files. Merge this small accessibility hardening first; then refresh/retest blocked PR #874 against current main. Source UI rules and scoped Playwright visual verification preserved.
