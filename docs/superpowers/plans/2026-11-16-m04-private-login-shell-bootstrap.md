# M04 Private Login/Shell Bootstrap — Superpowers TDD Plan

**Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` · **Design:** `docs/superpowers/specs/2026-11-16-m04-private-login-shell-bootstrap.md`.

**Goal:** Make M04 real D1 login and the original app shell interoperable in one isolated, nondeployable Workerd test, without activating public login or authenticating nonexistent staff.

## 14-sentence overview

1. The current public preview returns 503 on login by design.
2. Its runtime passes no trusted M04 authentication adapter and has no D1 binding.
3. M04 already has locally tested D1 login, sessions and role validation.
4. The original UI requires `getAppShellData` to open the ERP after a successful login.
5. The preview currently has no such RPC method either.
6. The original frontend invokes the shell request without a token.
7. The internal shell reader unnecessarily requires `settings.view` for ordinary staff.
8. We will add an opt-in restricted source-shaped shell transport with an explicit bearer.
9. We will use a single D1 statement that validates the current session and reads only public branding fields.
10. The Cashier will receive presentation navigation but not any data or write authority.
11. The compiled frontend will send the token after authentication and show default branding before login.
12. Node and real local Workerd tests will exercise login, shell, restore, logout, revocation and denial.
13. The public preview, original source code, production D1 and all financial postings will remain unchanged.
14. Real login activation will still require an owner-reviewed staff-data migration and private deployment.

## 1 — RED tests before implementation

Files:
- `tests/m04-authenticated-shell-rpc.test.mjs`: handler only accepts opt-in one-token `getAppShellData`; no bridge 501, wrong arity, bad token, extra data, origin, malformed response, invalid nested nav and sanitized D1 failure; using test-only trusted fake bridge.
- `tests/m01-auth-shell-patch.test.mjs`: original compiled source shell request is only allowed with an existing `authToken`; branding call before auth never sends public D1 request; other login/print functions preserved; idempotence/errors.
- `tests/integration/m04-login-shell-workerd.spec.mjs`: actual isolated D1 M04 login→shell→restore→logout proof with two synthetic staff, immutable source NAV, role validity, private Settings omission and no public routes. Use isolated fixture and existing M04 local schema.
- Commit tests **before** implementation and open draft PR. Verify GitHub Foundation RED (expected missing exports/modules) rather than assuming.

## 2 — Minimal GREEN

Files:
- `src/rpc/handler.js`: add `appShellBridge` server-side opt-in for `getAppShellData(token)`, response and nested nav schema validation and safe failure envelope.
- `src/modules/m04-login-shell-reader.js`: fixed parameterized current-D1 session join plus only safe Settings keys, exact source NAV builder, no `settings.view` prerequisite for navigation.
- `src/rpc/internal-m04-shell-bridge.js`: trusted closure providing server `now()`, never reading client clock/role/SQL.
- `scripts/patch-auth-shell.mjs`: narrowly patch built HTML after `scripts/patch-rpc.mjs`; do not edit original `legacy/source/javascript.html`.
- `package.json`: invoke compiled UI patch after existing `build:frontend`.
- `tests/fixtures/m04-login-shell-worker.mjs`, `wrangler.m04-login-shell-test.jsonc`: nondeployable local-only D1 runtime and fixed test clock.

Tests must pass before claiming success. Do not remove or weaken any failing auth/security assertion.

## 3 — Local Workerd verification and owner review

- New PR-only `.github/workflows/m04-login-shell-workerd.yml` uses Node22/npm ci/Wrangler pinned and runs the isolated local real D1 suite. No secrets or remote calls.
- Verify full Foundation (including original 37-screen UI, patcher and RPC tests), targeted Workerd suite, public preview denial, latest main conflict. Put exact commit/hash CI evidence in PR body.
- Document actual production blockers: complete auth schema remote migration and safe staff provision, no fake admin, private single-business D1 Worker+domain, session/role/tenant review, stable authenticated app shell, owner acceptance. Leave M04/ERP readiness incomplete.
