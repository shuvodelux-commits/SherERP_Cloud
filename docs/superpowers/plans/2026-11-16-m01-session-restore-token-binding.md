# M01 — Bind restored session profile to saved bearer (compiled browser only)

> Superpowers GitHub-first TDD. Commit RED Node/Chromium tests before implementation, obtain exact-head RED failure, commit minimal GREEN, verify full CI, open owner-reviewed draft PR. No direct production deployment.

## Review and source authority

- Original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, frozen `legacy/source/javascript.html::bootstrapSession_`.
- M01 merged #384 RPC success parsing, #396 actual Chromium/M04 synthetic local D1 authentication lifecycle, #411 app-shell fail-closed lock, and #419 compiled profile validation.
- `AGENTS.md`, `docs/MIGRATION_PLAN.md` and `docs/WORKSTREAMS.md`. M04 private login-to-app-shell PR #421 is a separate upstream workstream and must not be touched.
- The original browser reads `hwerp.session.token`, passes it to `validateSession(saved)`, but accepts a successful response even when `payload.token` is *different* from `saved`. A buggy or compromised response could silently switch the browser to another session. The reviewed M04 D1 `validateSession` returns the same token, so a strict equality check is source-contract compatible.

## Scope and 13-sentence execution overview

1. The change targets the existing compiled original `bootstrapSession_` handler and nothing deployable.
2. A restored session must remain bound to exactly the token the browser submitted.
3. A `validateSession` result that returns another token must be rejected before `onAuthenticated_`.
4. Null, missing, or malformed responses also fail before browser authentication.
5. Rejection must follow the original `.catch` path that clears the stale stored token and restores the login overlay.
6. Do not log or display the raw token or persist a substituted bearer.
7. Valid `validateSession` results with identical bearer and source-shaped profile remain accepted.
8. A normal fresh login continues to use the reviewed #419 profile validation and remains unchanged.
9. First add a Node VM test extracting the real original `bootstrapSession_` from generated `legacy/source/javascript.html` and simulating validated matching/mismatched responses.
10. Add a real Chromium regression with a synthetic stored token and synthetic `validateSession` response returning another token; assert the original login overlay remains visible and navigation remains hidden.
11. Commit the tests and collect actual GitHub Actions RED evidence showing only the new missing token-binding regression.
12. Add a single exact-marker guard to `scripts/patch-rpc.mjs` only, preserving the original GAS and browser source files byte-identical.
13. Run exact-head Foundation, Chromium desktop/mobile/print, M04 local D1, Workerd and Cloudflare preview safety checks before review and merge.

## Strict exclusions

No `src/index.js`, public RPC registry, D1 auth adapter, M04 session SQL, bank, cash, Party, stock, sales, purchase, migrated data, staging/production Cloudflare bindings, secrets or deployment settings. The profile fixture is synthetic; this browser response check is defense in depth and does not substitute for server-side session/tenant authorization. Existing `bootstrapSession_` catch handles the failure, and no server-side logout is invented. A denied stale bearer is cleared locally. Keep the PR draft until all required checks pass.
