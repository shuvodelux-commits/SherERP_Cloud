# M04 Login Availability UX — Implementation Plan

> **Superpowers:** TDD (observe red), executing-plans, verification-before-completion.

**Goal:** Replace misleading `RPC method not migrated` on the login form with a deliberate service-unavailable error, without pretending login works or allowing authentication in database-free Cloudflare previews.

**Architecture:** In `src/rpc/handler.js`, after existing strict request validation and the explicit handler allowlist check, special-case unregistered `login` to HTTP 503 with a static message. The unchanged frontend error path displays that response. All other RPCs remain 501. No DB, tokens or new endpoints.

**Spec:** `docs/superpowers/specs/2026-11-15-m04-login-availability-design.md`

## Tasks
1. Add `tests/m04-login-availability.test.mjs` for 503 static message, no secret echo/cookies, no user auth, existing invalid-request guards and 501 on other methods. Execute and observe RED 501 vs 503.
2. Update `src/rpc/handler.js` with narrow login availability response only after input validation, noninterference with eventual allowlist registration. Execute test GREEN.
3. Update `tests/m04-auth-preflight.test.mjs` and `qa/m01-browser.spec.mjs` to reflect new 503 login contract while preserving 501 on other methods; run full Node and Playwright suite.
4. Verify source 84 files, 36 includes frontend build, M03 caller inventory, JS syntax, safe preview and CI. Commit only identified files and this design/plan; open draft PR.
5. Do not claim login is functional. Raise explicit follow-on M04 D1 authentication integration dependency: auth DDL, legacy staff import/provision, slow KDF upgrade, durable sessions, atomic throttle, revocation/RBAC, local and staging Workerd+D1 tests. No preview D1 binding changes.
