# M01 preserved login keyboard/touch browser regression

## Purpose and source

After merged M01 PR #185, the real-browser coverage is still limited to visible login, click failure, 375px layout and synthetic invoice print. Pin all assertions to the unmodified `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` login and `javascript.html::wireLoginForm_` / `doLogin_` / `setLoginPending_` flow.

## Acceptance behavior

1. Blank submission using Enter in the mobile field shows the original validation message **without** sending a login RPC, authenticating, or revealing the application.
2. Filling synthetic phone/password and pressing Enter from password dispatches the original `login` RPC to the *actual inert Worker* exactly once with unchanged argument ordering, receives controlled HTTP 503, re-enables the button and keeps the shell hidden.
3. Show/Hide password is keyboard activatable, keeps input text unchanged, restores masking and does not authenticate or post an RPC.
4. On an approximately 320px touch viewport, the card, mobile field, password field, toggle and submit button remain reachable without horizontal clipping; record a synthetic screenshot. Any discovered original-layout regression should remain visible as RED, not be silently relaxed.

## Test/runtime isolation

Only `qa/m01-browser.spec.mjs` and two new design/plan files change. Reuse existing compiled original page and loopback fixture delegating requests to the real **inert** Worker API; do not add working backend credentials, D1 binding, role/session shortcuts or synthetic successful login. The source HTML, CSS and JS, Worker RPC, schemas, builds, Cloudflare deployment and original Mohim ERP stay unchanged.

## Evidence and limitations

Run GitHub PR-only Chromium on a test-first commit; distinguish observed pass from expected failure. If a test fails because source behavior is genuinely noncompliant, retain it for owner review; do not fabricate TDD RED or change protected original source. Compare exact-head Foundation, pinned original-source audit, M01 Chromium and other relevant CI checks. No claim of real authenticated navigation, POS workflow, device-specific Android font rendering, or production-ready migration.
