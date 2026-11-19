# Owner-authenticated ERP frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show the preserved ERP frontend on the Owner origin only after validating its D1-backed Owner session.

**Architecture:** Build an Owner-specific copy of the existing compiled frontend. The Owner Worker serves the app only after session validation and uses one scoped read-only app-shell response; unsupported module RPCs remain unavailable.

**Tech Stack:** Existing Hono Worker, Cloudflare D1, Wrangler Static Assets, Node test runner, Workerd integration harness, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-19-owner-authenticated-erp-frontend-design.md`

## Global Constraints

- Preserve the original legacy UI and public `hisabiq` Worker.
- Use same-origin host-only Owner sessions; never expose a session token to JavaScript.
- No business data import, schema migration, public RPC, or business write endpoint.
- Preserve fail-closed behavior and show an honest unavailable state.

## Review Focus

- Missing or revoked Owner session: app HTML must not be served; test unauthenticated access and direct D1 session revocation.
- Wrong shop binding: reject the app shell; test a session/binding mismatch.
- Arbitrary RPC names: reject locally without network requests; test unsupported method routing.
- Login and logout boundaries: restore enters the app; logout revokes the session; cover in Workerd and browser tests.
- Asset deployment mismatch: candidate assets include both Owner login and ERP shell; test Wrangler asset routes and the isolated build.

---

### Task 1: Owner frontend build and client bridge

**Files:**
- Create `scripts/build-owner-frontend.mjs`.
- Modify `frontend/owner-auth/owner-auth.js`.
- Test `tests/integration/m03-owner-erp-frontend-workerd.spec.mjs` and `qa/m03-owner-erp-browser.spec.mjs`.

**Interfaces:**
- Builder writes the compiled ERP to `dist-owner/owner-erp.html` and keeps the Owner sign-in page at `dist-owner/index.html`.
- Owner bootstrap calls only `/api/owner/auth/session`, `/api/owner/app-shell`, and `/api/owner/auth/logout`.

- [x] Write tests for module visibility, no legacy password form, Owner bootstrap, and local-only allowlisted calls.
- [x] RED: the build test failed because the builder did not exist; the browser test failed because session restore stayed on the Owner card rather than entering `/app`.
- [x] Implement the separate Owner build, same-origin session bootstrap, fail-closed local RPC bridge, and dashboard-gated redirect.
- [x] Run focused tests and both frontend builds.

### Task 2: Session-protected app route and app-shell read

**Files:**
- Modify `src/m03-owner-redemption-worker.js` and `wrangler.m03-owner-auth-staging.jsonc`.
- Test `tests/integration/m03-owner-erp-frontend-workerd.spec.mjs`.

**Interfaces:**
- `GET /app` serves the compiled HTML only after `validateOwnerSession` succeeds for the current bound shop.
- `GET /api/owner/app-shell` returns `buildSourceAppShellData({shopName, currencySymbol:''})` using the validated Owner session's shop display name.
- No `/api/rpc` business-method dispatcher is added.

- [x] Write Workerd/D1 tests for unsigned denial, active session asset delivery, module asset allowlisting, app-shell provenance, and D1 session revocation; existing M04 integration coverage verifies wrong-shop binding rejection.
- [x] RED: the first Workerd test failed because `/app` returned 404.
- [x] Add protected app, shell, and module routes plus Worker-first `dist-owner` configuration. Direct `/index.html` is blocked without an Owner session.
- [x] Run focused Workerd tests.

### Task 3: Browser flow, review, and PR

**Files:**
- Create `qa/m03-owner-erp-browser.spec.mjs` with Chromium sign-in restore, navigation, and logout checks.
- Update `docs/runbooks/M03_PLATFORM_AUTH_STAGING.md` with build and release boundaries.

- [x] Prove browser session restore opens the existing ERP shell, unsupported operations make no RPC request, and logout uses the Owner endpoint; Workerd/D1 tests prove server session validation and revocation.
- [ ] Run all affected tests, full Node CI, source verification, and frontend builds.
- [ ] Request independent M03/M04 security review.
- [ ] Open one scoped PR documenting RED/GREEN evidence, file/RPC/table inventory, risks, and the remaining data/backend gates.
- [ ] Do not merge or deploy without current-head CI, required review, and a separate staging release decision.
