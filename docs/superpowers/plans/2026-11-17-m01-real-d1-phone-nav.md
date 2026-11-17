# M01 / issue #25 — Real isolated M04 D1 phone-session navigation parity

**Workstream:** M01 preserved UI/mobile QA  
**Coordination:** `AGENTS.md`, `docs/PARALLEL_EXECUTION.md`, issue #456  
**Base main SHA:** `ca04f103f798955920e788d52a856207c2932c3b`  
**Source of truth:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, unchanged  
**Depends on:** merged M01 #396 original Chromium M04 D1 auth, #433 restored token-binding, #457 synthetic phone/tablet nav. Consume existing M04 internal auth adapter without editing it.  
**Ownership / changed files:** `qa/m01-auth-browser-local-d1.spec.mjs`, new `qa/m01-mobile-d1-fixture.mjs`, this M01-only plan. No common file edits.

## Goal

Bridge two reviewed test surfaces with an actual **isolated local D1 M04 authentication session** and the preserved original browser's touch role-navigation. Existing M01 desktop Workerd auth proof does not test phone navigation; merged #457 mobile nav uses a synthetic intercepted `login` response. This test proves they work together without claiming production activation.

## Superpowers test-first execution

1. Use the reviewed `wrangler.m04-auth-http-test.jsonc` only inside a disposable local Workerd harness.
2. Create an offline credential, one active Clerk and `dashboard,reports` staff role in isolated D1.
3. Pass `createD1LegacyAuthRpc(DB)` into the existing test-only `serveCompiledUi({internalAuthAdapter})`; don't touch the public Worker.
4. Intercept only `getAppShellData` with fixed synthetic Dashboard, Reports and Bank metadata, never `login`, `validateSession` or `logout`.
5. In real Chromium at 375×812 with touch, sign in with synthetic credentials and assert the **real D1** role metadata.
6. Verify protected app only unlocks after the successful authenticating response and the password field clears.
7. Assert the original mobile nav hides unauthorized POS/Sales/Products and the Bank entry is absent from the desktop and More routes.
8. Tap More → Reports and verify page selection, active More state and sheet closure.
9. Reload and verify a real `validateSession` returns the same stored token and reopens a role-filtered shell.
10. Rotate to 812×375 coarse-pointer landscape and verify More-sheet Escape dismissal and preserved role restriction.
11. Log out through the original browser, require D1 `auth_sessions.revoked_at_ms` and a locked login overlay.
12. Commit RED browser assertions before the small missing M01-only Workerd setup fixture, capture expected GitHub RED, then implement the fixture and require full GREEN.
13. Run exact-head M01 Chromium (including local M04 D1), Foundation/source, Cloudflare PR safety and all shared full Workerd D1 CI before owner review/merge.

## Exact scope and safety

No production user, remote database, real password, customer data, financial write or original GAS/Sheets mutation; fixtures are disposable synthetic records. Only M01 QA test files/docs change. Test fixture may **write synthetic users and roles to an isolated local test DB**; this is not a D1 migration, production write or user import. No edits to `src/auth`, `src/rpc`, `src/index.js`, `src/db`, `migrations`, `wrangler*`, shared CI/workflows or frozen `legacy/source`. The real local server must still return 501 for business RPC. Navigation visibility is presentation-only; all protected permissions remain server-side. If the existing M04 contract needs changes, stop and coordinate with M03/M04 instead of editing protected shared files. Rollback: revert the M01-only QA PR; no data/schema rollback.
