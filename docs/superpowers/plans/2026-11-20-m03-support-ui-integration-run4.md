# M03 Private Control Center Support Mode — Local-Gated UI Integration Run 4

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans, superpowers:test-driven-development, and independent /super qa → /super review. Check off tests before implementation.

**Goal:** Connect the existing merged #775/#778/#781 read-only support grants, diagnostics and local HTTP contract to the actual private Admin Hono Worker and the compact tenant directory UI, without enabling any hosted support route or changing remote D1.

**Architecture:** A distinct *in-process, function-bearing local fixture gate* injected only by the test harness enables the existing support HTTP contract through the private Hono route `/api/platform/support/{start,diagnostics,end}`. It must never be enabled by Wrangler JSON strings or hosted environment flags, and uses trusted exact Shop D1 bindings from local inventory. The signed-in session advertises `supportDiagnosticsEnabled` only when the same server gate passes; the existing recent-business directory then offers a per-ready-Shop "Inspect setup" action. A compact Support Mode panel requires a reason; Start creates a 5-minute read-only grant and immediately requests audited catalog counts; End revokes it. Client bearer lives only in a JavaScript closure, not URL/storage/logs, and resets on sign-out or session change.

**Tech:** existing Hono private Worker + vanilla JS/HTML/CSS + Playwright Chromium + disposable real Workerd/D1 through pinned Wrangler.

**Spec:** issue #765, merged #759, #775, #778, #781. Frozen original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Constraints and file ownership

- Base `main@87d2c942f3a94af8eddf10480c21d186dc27182b`; branch `m03/private-support-ui-gated-integration-run4-20261120`.
- Exact files reserved in issue #456: `src/m03-private-platform-auth-worker.js`, `frontend/platform-auth/index.html`, `frontend/platform-auth/platform-auth.js`, `frontend/platform-auth/platform-auth.css`, NEW `qa/m03-control-center-support-mode.spec.mjs`, NEW `.github/workflows/m03-control-center-support-mode-browser.yml`, this plan.
- Open #782 PORT-P3 and #783 M04 auth/Owner have disjoint files. Keep unrelated M03 source/routing, existing Worker entry, public `src/index.js`, `src/rpc/**`, SQL migrations, Wrangler and all financial/stock code untouched.
- No remote Cloudflare actions, D1 writes or real tenant data. No new paid service, RBAC architecture, generic support ticket system or Owner impersonation.
- Only local-test function object `PLATFORM_SUPPORT_LOCAL_GATE` with `testOnly:true`, a `resolveShops(env)` function and validated `supportOrigin` can enable the route. `resolveShops` must return exact immutable inventory with `env[item.binding]` physical D1 references, no request-supplied DB/binding/ID. Merely setting `PLATFORM_SUPPORT_ENABLED='true'` does nothing. The route does NOT support deployed hosted activation; M04/M11 and owner approval required later.
- Existing Cloudflare Access outer wrapper remains unchanged. Actual production Support Access needs separate review of Access audience, host, proper shop grants persisted in Control D1, Owner-visible audit, and cross-D1 revocation race.
- No operational ERP access or financial correction is enabled by this "Inspect setup" MVP subset.

## Task 1: RED local browser and HTTP contract

**File:** `qa/m03-control-center-support-mode.spec.mjs`

- [ ] Seed real disposable Workerd Control D1 + two physically distinct Shop D1s, provisioned setup-ready for same Super Admin, current MFA session, catalog counts deliberately different, and reviewed local support DDL.
- [ ] Test default private Worker without the function gate responds 404 to all support actions and session omits support capability; client hides Support section/buttons.
- [ ] Inject valid in-process local-only gate with real D1 inventory and local exact origin; assert authenticated session advertises support capability, only ready Shop row offers "Inspect setup".
- [ ] Use real Chromium to select ready Shop, enter reason and open Support, verify read-only label, exact Shop name and two counts, and START/READ audit.
- [ ] Verify switching / closing ends grant and audits END, cannot use old bearer; tampered/missing origin, wrong Shop, revoked session are denied without financial records; sign-out clears UI without credentials in storage.
- [ ] Commit browser RED first, add PR-only Chromium Workerd workflow, verify hosted expected RED for missing controls/routes before GREEN.

## Task 2: GREEN private Hono adapter

**File:** `src/m03-private-platform-auth-worker.js`

- [ ] Add tight `localSupportGate(env)` factory checking function object, exact origin, `CONTROL_DB` and typed physical Shop bindings; no flag/env string alone may activate.
- [ ] Add `supportDiagnosticsEnabled:true` in `signedIn` only under same gate, and only when `localProvisioningEnabled`.
- [ ] Add fixed Hono POST `/api/platform/support/:action` gated first; reject unsupported actions/queries, use existing ingress limit and body limits, call `handleLocalSupportHttpRequest` with rewritten local-only URL and trusted gate-derived scope.
- [ ] Do not add public/Owner Worker imports, no runtime remote D1 migrations or production config. Missing gate yields 404.

## Task 3: GREEN compact Admin UI

**Files:** `frontend/platform-auth/index.html`, `platform-auth.css`, `platform-auth.js`

- [ ] Add one hidden Support Mode dialog-like section within `#signed-in` with reason form, status, read-only counts and End button; no external navigation.
- [ ] Add "Inspect setup" next to ready rows **only when signed-in server session advertises capability**; preserve original Resume for pending.
- [ ] When switching Shops or signing out, revoke first where feasible, clear in-memory token, hide panel, never persist token; avoid pagehide network dependencies.
- [ ] Reuse existing card tokens, max 44px min controls and keyboard focus; phone viewport overflow unchanged; never imply full ERP operational readiness.

## Task 4: Review and QA

- [ ] Run focused Chromium test and existing M03 provisioning/auth/browser, #775/#778/#781 Workerd suites, full exact-head GitHub CI.
- [ ] Independently /super qa then /super review with M04/M11 security owner; no human-approved merge before checks.
- [ ] Document specifically that hosted `admin-hisabiq` still has neither active grant tables nor provider bindings, so this PR does not make live Support Access usable; deployment and financial access remain NO-GO.
