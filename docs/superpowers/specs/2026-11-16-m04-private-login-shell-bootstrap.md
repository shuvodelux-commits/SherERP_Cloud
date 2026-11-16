# M04 — Login → Authenticated App Shell (Internal Staging Contract)

**Date:** 2026-11-16 · **Owner:** M04 authorization with M03 read-only shell coordination · **Source:** pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Observed login failure and underlying causes

`src/index.js` calls `handleRpc(request)` without `authAdapter`; `src/rpc/registry.js` is empty. Therefore the deployed public preview returns **HTTP 503** for `login`: `Sign-in is unavailable because server authentication is not configured yet.` The preview Wrangler config has **no D1 binding** by design; it must stay an inert, public, automatically deployed shell. Existing M04 `src/auth/d1-legacy-rpc.js` and local-D1-tested `src/auth/d1-auth-core.js` already implement real login, validateSession, logout, credential upgrade, throttle and server-checked user/role profile; they are intentionally **not** public. M02 migration schema creates **no real users**; no source-staff import, approved remote migration or private auth deployment is yet verified.

A second blocker exists after token issue: the original preserved `javascript.html::getAppShellDataOnce_` invokes `serverCall('getAppShellData')` with **zero arguments**, including for pre-login branding. `src/modules/m04-authorized-app-shell-reader.js` has a D1 reader but it requires `settings.view`, which ordinary active Cashier/Sales staff may lack even though original `UI.gs::getAppShellData()` is ungated and returns navigation metadata. Thus merely enabling login would leave the shell blocked, or make non-Settings staff appear unable to log in.

## Options

1. Bind production D1/auth adapter directly to `src/index.js` and auto-deploy `main`: **rejected**, violates public DB-free preview, live source-staff import and financial readiness gates.
2. Remove login requirement or mint fake test Administrator: **rejected**, bypasses identity, causes private data exposure, and fabricates real users.
3. **Chosen:** implement a *server-only opt-in* `appShellBridge` in reviewed `handleRpc`, an M04 session-authorized **two-public-key** shell reader with original immutable NAV_ITEMS (not a permission grant), and a separately configured **nondeployable, isolated Workerd/D1 fixture** proving complete `login → getAppShellData(token) → validateSession → logout → shell denied`. A distinct compiled-frontend patch should pass the session token after login and skip prelogin remote shell branding; original GAS/HTML stays untouched. No public environment or remote D1 changes.

## Interface and security contract

- `handleRpc(request,{authAdapter,appShellBridge})` accepts only frozen `getAppShellData` with exactly one lowercase 64-hex token argument and no payload extras. The trusted bridge owns `now()` and D1; client `nowMs`, `userId`, `role`, `sql`, `tenant`, `authAdapter` and `appShellBridge` cannot activate backend authority.
- If no `appShellBridge` is explicitly supplied, `getAppShellData` remains **501** on preview (and `login` remains **503**). Incorrect syntax fails 400, invalid current session or D1 failure fails 503 with generic message, no SQL/bearer/account or private Settings fields in errors.
- A successful opt-in response has frozen source envelope `{success:true,data:{shopName,currencySymbol,navItems}}`; all values and nested objects are validated before HTTP. `shopName` and `currencySymbol` are strings, navItems exactly the known original source navigation shape, no dynamic grants, no private Settings keys. Unknown methods always 501.
- The M04 app-shell D1 reader checks the **same live session/identity/role epoch** as M04 auth in one parameterized SQL SELECT, requiring active user, valid session and active role (or Administrator). It reads only `Shop Name` and `Currency Symbol`, not generic Settings. Ordinary active Cashier need not have `settings.view` merely to load presentation navigation. Every module data/action remains separate M04-authorized RPC.
- Source comparison returns `_rowIndex` and historical audit not applicable here. No data writes by shell read. Missing Settings keys fallback to original `CONFIG.APP_NAME` and blank currency. No application-level auth state/cache. Confidential Settings keys, credentials and bearer never exposed.
- Original UI compilation should change only generated `getAppShellDataOnce_` to require an existing `authToken` and send `serverCall('getAppShellData', authToken)`. The pre-login branding path falls back to its existing default rather than issuing unauthenticated shell requests; after login the source code's `onAuthenticated_` sets `authToken` first. Do not mutate original source `legacy/source/javascript.html`.
- Real local D1 proof includes seeded **synthetic only** Administrator and Cashier. Prove login/password, authenticated shell, non-Settings user shell, invalid/expired/revoked session, malformed envelope, same-origin, no secret output, no public route, DB-free preview unchanged. PR-only isolated CI, no deployment.
- To actually enable real login: separate owner-authorized protected staff export/two-pass freeze, reconciliation of users/roles/credentials into private isolated D1, staging DB migration backup, explicit private Worker binding, rate-limit review, production/session/tenant isolation gate and full frontend functional parity. This PR alone cannot make the public preview sign-in usable.

## Scope and merge

Only internal auth/app-shell bridge, handler opt-in, compiled UI patch and its invocation/tests, fixture and PR-only tests, spec/plan. No source GAS change, no `src/index.js` public auth wiring, no `wrangler.preview.jsonc` D1 binding, no remote migration/cutover, no financial posts. Do not auto-merge or claim login operational without private deployment and complete CI.
