# M01 source-preserved mobile landscape / touch regression

## Context

Previous M01 PR #247 merged with 11/11 CI checks. Its original canvas/JPG, A4, thermal and login smoke coverage does not rotate the original interface between portrait and wide-but-short phone viewports. The frozen original `javascript.html` explicitly defines `isPhoneViewport_` as width <=540px **or** landscape height <=540px with coarse pointer. The same conditions style the mobile chrome in `style.html`. `wireMobileViewportMetrics_` updates `--app-viewport-height` and `--mobile-nav-clearance` on resize/visual viewport changes.

Source of truth: `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. This test must use the preserved original source compiled in `qa/serve-compiled-ui.mjs`, with its real inert Worker router.

## Acceptance

1. A true mobile Chromium context (touch, coarse pointer) rotates from 375x812 portrait to 812x375 landscape and back. Original `isPhoneViewport_` continues to be true at the wide landscape width, mobile sidebar is hidden in both orientations, and root viewport height CSS variable follows current `visualViewport.height`. A desktop fine-pointer 812x375 viewport must not be mistaken for mobile.
2. At landscape 812x375 and 568x320, original login controls remain horizontally contained and can be targeted via touch/scroll. The password Show/Hide button continues to toggle without submitting credentials, and a deliberate invalid sign-in returns the actual inert Worker 503 and leaves `#app` hidden.
3. No fake successful RPC, signed-in shell, or CSS redesign. Preserve mobile screenshot as evidence and distinguish browser simulation from real device testing.

## Boundaries

New independent `qa/m01-landscape.spec.mjs`, `package.json` browser-test command update only, and plan/design docs. No change to original UI, `qa/m01-browser.spec.mjs`, Worker routes, D1, Party/ledger data, auth, Cloudflare configs or dependencies. If any original source issue produces genuine RED, report it; do not silently change frozen `legacy/source`. If tests pass on first run, describe only coverage. Revert the PR to roll back.
