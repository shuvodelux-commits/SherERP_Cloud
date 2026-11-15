# M01 browser regression — login retry and stale browser session rejection

## Why

PR #193 confirmed original Enter, password-toggle, and narrow touch behavior. The actual unauthenticated login lifecycle still lacks browser checks for retry after Worker rejection and for an existing browser token that must not restore an unavailable session. Both can expose a protected shell if transport/session state is inadvertently changed.

## Source and scope

- Frozen original: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` mirrored byte-identically into `legacy/source/javascript.html`, `login.html`, `style.html`.
- Original functions: `doLogin_`, `setLoginPending_`, `bootstrapSession_`, `readStoredToken_` and `clearStoredToken_`.
- The browser fixture uses compiled original HTML with the existing reviewed `patchServerCall` transport into the **real inert Worker router**, no credentials, D1, sessions, users, or financial data.
- This is acceptance-test coverage, not an implementation or authentication activation.

## Acceptance criteria

1. After a synthetic invalid login returns HTTP 503, original UI displays its controlled message and restores enabled/busy=false submit state. An intentional retry with corrected synthetic password sends exactly one new login RPC, gets another 503, stays unauthenticated and does not retain `hwerp.session.token`.
2. A stale synthetic `hwerp.session.token` placed into origin-scoped localStorage triggers the source `validateSession` call on reload. The inert Worker returns 501 rather than success. The original source clears the token, renders the login overlay, and keeps protected `#app` hidden. A subsequent reload must not make a second `validateSession` request because the token has been cleared.

## Boundaries and evidence

Only `qa/m01-browser.spec.mjs` and M01 spec/plan docs may change. Real Chromium requests and visible browser DOM assertions must be checked on exact-head GitHub Actions. Do not bypass auth, create a fake success RPC, alter `legacy/source/**`, or add D1/Worker secrets. If an assertion fails for a genuine source defect, preserve that RED evidence and seek separate explicit source-compatibility review; don't invent TDD RED when the regression tests pass on first run.

No claim of production-ready authentication or authenticated POS/UI flow. Rollback: revert test-only PR.
