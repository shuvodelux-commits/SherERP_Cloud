# M01 — Preserve locked browser shell when app-shell metadata fails

> GitHub-first Superpowers TDD: plan → committed failing test → minimal generated-output fix → exact-head GitHub Actions → owner review/merge.

**Authority:** Frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, and merged M01 #384/#396. The source `javascript.html::loadAppShell_` currently shows a toast after a failed `getAppShellData` promise, but does not restore its login overlay after `onAuthenticated_` already called `hideLogin_`. This leaves a partially opened, empty app.

**Goal:** Fail closed visually on an unavailable/invalid original app-shell response after a source-shaped login/validated session, while retaining the server-issued valid browser token for a later reload retry. No data, financial write, login policy or backend behavior changes.

## Test-first RED

1. Add a Node generated-source regression in `tests/rpc-patch.test.mjs` using source-shaped `loadAppShell_` catch marker. Require `showLogin_()` in that catch, after RPC/login patching, to keep the protected shell hidden on an error.
2. Add original Chromium acceptance test in `qa/m01-browser.spec.mjs`. Use the actual compiled frozen frontend with test-only interception of exactly `login` (synthetic valid source-shaped profile), `getAppShellData` (controlled 503), and optionally `validateSession` (controlled expired) on reload. Do not stub other business RPCs.
3. Ensure initial prelogin metadata failure settles before synthetic login; mark the original `showToast` invocation to observe the asynchronous failing load rather than racing with a still-visible login page.
4. Assert the test login response was accepted, metadata failure reached the original toast/error path, login overlay was restored, `#app` visibility is hidden, no protected sidebar built, and a valid synthetic token remains available for a reload retry. Reload with denied validation; assert stored token is cleared and app remains locked.
5. Commit tests first and inspect GitHub RED Foundation and/or M01 Chromium logs; the old generated source leaves the overlay hidden.

## Minimal GREEN

1. Modify **only** the existing `scripts/patch-rpc.mjs` generated-HTML patcher. When original `loadAppShell_` function is present, identify its unique source catch marker exactly and insert `showLogin_();` immediately before the existing `showToast`. Fail closed if source marker drifts or duplicates, and leave tiny isolated RPC fixtures without `loadAppShell_` untouched.
2. Preserve existing `serverCall` semantics, Boolean success guard, keyboard login single-flight, on-auth session persistence, original UI layout, POS, mobile navigation, invoice and printing.
3. Verify exact-head Foundation, Chromium print/mobile and all PR safety/Workerd checks. Inspect PR diff: plan, Node test, Chromium test, generated patcher only. Keep public Worker login 503, D1 binding off, no database migration or production deploy change.
4. Owner reviews and merges only after CI. No automatic merge.

## Explicit boundaries

This is a **frontend readiness lock**, not full authorization or revocation: the backend must always enforce M04 permissions. The synthetic browser login is only a shape-faithful regression; separate merged M01 #396 covers authenticated local Workerd D1 login/restore/logout. Valid session bearer is deliberately **retained** on transient metadata error, avoiding a fake server-side logout or orphaning a non-expiring session by clearing its browser credential. On reload the reviewed M04 adapter will validate the token again; if the token is revoked it fails closed. No original GAS/Sheets edits, no real customer/business data, no M09 transaction source work, no public app-shell endpoint, no financial writes or deployed auth route.
