# M04 Login Availability Response While Authentication Is Unconfigured — Design (2026-11-15)

**Purpose:** Replace misleading internal `RPC method not migrated` text shown by the original login screen with a precise, human-readable server availability error, **without** enabling unsafe authentication.

## Verified state
- Worker `src/index.js` routes `/api/rpc` to `src/rpc/handler.js`.
- The `src/rpc/registry.js` allowlist is empty. No public `login`, `validateSession`, `logout` or user management handler exists.
- Production Cloudflare preview `wrangler.jsonc` has no D1 DB binding. Staging config alone has D1 binding but its two migrations contain neither USERS nor ROLES nor SESSIONS.
- Preserved `legacy/source/javascript.html` already displays the backend rejection message in `#loginError`, so no source/HTML modification or UI redesign is necessary.
- The existing login browser smoke test asserts the raw 501 string, so test contract must be updated intentionally.

## Options
1. **Chosen immediate correction:** Return HTTP **503** with a clear fixed message for validated `fnName:'login'` requests when the auth handler is unconfigured. Preserve source UI and leave all other RPCs fail-closed at 501. No credentials echoed, cookies or secrets issued, no DB reads. This is a **diagnostic UX correction**, NOT a working login.
2. Enable login against legacy GAS source credentials or embed demo credentials in preview: rejected as unsafe and contrary to source/D1 ownership rules.
3. Bind public preview to staging/production D1 just for login: rejected by `AGENTS.md` no-secret preview architecture.
4. Fully activate D1 auth: required **later**, after M03 auth schema + controlled staff import; token, session, throttle, role, disable/revoke, KDF upgrade and real Workerd/D1 tests are reviewed and merged.

## Contract
`src/rpc/handler.js` must first validate method, Origin, Content-Type, bounded JSON and RPC name/args using existing controls. For a structurally valid `login` request only, with no registered handler, respond:
- HTTP **503**, `{success:false,message:'Sign-in is unavailable because server authentication is not configured yet.'}`
- Cache-Control `no-store`; no Set-Cookie; no mobile number or password echoed, no DB access, no actor creation.
- If a future reviewed `rpcRegistry.login` exists, do **not** intercept it here: the registry authorization handler should take ownership (this branch must not obstruct future rollout). This requires check for registry entry first.
- Invalid origin/method/content type/input still produces existing 403/405/415/400/413 errors **before** the availability error.
- `validateSession`, `logout`, unsupported business RPCs and `createFirstAdmin_` stay HTTP 501 with their current error shapes.

## Ownership / scope
Edit `src/rpc/handler.js`, `tests/m04-auth-preflight.test.mjs`, `qa/m01-browser.spec.mjs`; add this spec and a plan. Do not modify other shared worker/registry paths, original HTML/JS, `src/db`, migrations, Cloudflare bindings or M04 auth helpers. Existing real browser tests must continue to prove no unauthorized shell is revealed.

## Release gate
Run RED→GREEN with an explicit new isolated test, existing auth preflight and Chromium login smoke, `npm test`, source verification, frontend build, syntax/diff checks and CI. Clearly state to owner that **login is still unavailable** and provisioning + real D1 authentication is the actual next step.
