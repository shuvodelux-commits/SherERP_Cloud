# M01 — Original Chromium M04 authentication lifecycle on isolated local D1

> Superpowers TDD: GitHub plan → RED-only browser regression → minimal fixture GREEN → exact-head checks → owner-reviewed draft PR.

**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Read `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md` M01 and merged M04 internal auth HTTP contract. Never modify original GAS/Sheets or the frozen HTML/CSS/JS.

**Goal:** Verify the actual original browser's `serverCall('login')`, stored session reload `validateSession`, and `logout` against reviewed M04 adapter with real **isolated synthetic** Workerd/D1 auth sessions; preserve public Worker 501/503 and avoid production/staging bindings.

**Architecture:** Extend existing **test-only** `qa/serve-compiled-ui.mjs` with optional trusted `internalAuthAdapter` forwarded into the **existing** `handleRpc(request,{authAdapter,...})` only when supplied explicitly. The original browser page uses the compiled source UI with untouched original login handler. Existing `getAppShellData` is not public or M04-backed, so this browser test intercepts **only this nonfinancial UI metadata read** with a synthetic source-shaped `{shopName,currencySymbol,navItems}` response. All actual `login/validateSession/logout` calls go to M04 adapter and actual local D1. The only new opt-in lives in QA fixture and cannot reach deployed `src/index.js`.

## 14-sentence execution overview
1. Verify the exact merged source and M04 internal login/validate/logout response contract.
2. Use the existing nondeployable `wrangler.m04-auth-http-test.jsonc` worker and its local D1 binding.
3. Apply approved auth migrations in a fresh test harness.
4. Seed exactly one synthetic staff role and user with a reviewed password hash.
5. Inject M04's existing `createD1LegacyAuthRpc` adapter through the QA loopback test server only.
6. Intercept the original public `getAppShellData` **only in Chromium** with deterministic synthetic metadata.
7. Assert invalid credentials do not unlock the protected shell.
8. Assert a valid login returns a source-shaped profile and records a hashed D1 session.
9. Assert original compiled UI hides login, displays the synthetic shop/nav, and keeps original password-clearing behavior.
10. Reload the browser and assert real local D1 session validation reopens the same role-filtered shell.
11. Revoke the session or sign out and assert the original browser clears its stored token and returns to login.
12. Confirm the default QA server without opt-in still routes public login to inert Worker 503.
13. Commit the failing regression before modifying the QA fixture and capture actual GitHub Actions RED evidence.
14. Commit minimal GREEN fixture support and verify full M01 Chromium, Foundation, original source-byte audit and all exact-head workflow results.

## RED first
- **Create:** `qa/m01-auth-browser-local-d1.spec.mjs`: real Chromium, synthetic M04 local Workerd D1 seeded user, negative login, successful login, cached shop metadata, role-filtered nav, browser reload session restore and logout revocation. All secrets are deterministic synthetic fixtures only.
- **Modify:** `.github/workflows/m01-browser-qa.yml`: invoke new local-only spec after existing browser and Day Book local D1 tests. Reuse pinned Wrangler dependency.
- Commit the test and workflow only; expected failure: real browser login returns public 503 as current QA server does not accept `internalAuthAdapter`.
- Prove RED on exact commit and **do not** use a pre-stubbed browser login route to fabricate D1 auth.

## Minimal GREEN
- **Modify:** `qa/serve-compiled-ui.mjs`: optional `internalAuthAdapter` argument, forwarded exclusively for requests to loopback `/api/rpc` via reviewed `handleRpc`, alongside unchanged optional internal Day Book bridge. All default requests remain actual inert Worker and there is no public opt-in mechanism in request JSON.
- No backend adapter modifications, no new RPC parser, no M04 policy bypass, no production Worker code or D1 config changes.
- Verify all existing original browser mobile/print, Day Book read and failed public auth coverage.
- Update draft PR with exact RED/GREEN Actions URLs and source/data impact. Owner reviews and merges only.

## Security and data boundaries
The only D1 writes are synthetic authentication fixture user/role/session rows in isolated Workerd local D1. No production/staging schema/data access, no real users/passwords, no stock, POS, Party/ledger/cash/bank posting, no GAS/Sheets migration, no public login activation, no domain/deploy secrets and no original UI refactor. The shell metadata is explicitly **test-stubbed**, not proof of a source-faithful D1 shell endpoint or complete ERP navigation. Cross-tenant isolation, role permissions on all business methods and full Day Book remain upstream gating work.
