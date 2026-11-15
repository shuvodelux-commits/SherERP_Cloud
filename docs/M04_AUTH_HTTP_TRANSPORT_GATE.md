# M04 — Opt-in original HTTP RPC transport for internal D1 authentication

**Status:** Internal/test-only transport gate implemented. **Public login remains unavailable.**

## Source and contract
Frozen original `legacy/source/Auth.gs` exports `login(mobile,password)`, `validateSession(token)` and `logout(token)`. The browser posts `{fnName,args}` to same-origin `POST /api/rpc`. Successful legacy calls resolve to `{success:true,data}`; failures resolve to `{success:false,message}`.

The existing internal `src/auth/d1-legacy-rpc.js` already implements these result shapes over the proposed M04 test-only D1 schema, enforcing PBKDF2 credentials, hashed opaque session tokens, current user/role authority, lockout, 12-hour absolute and 30-minute idle session expiry.

## Minimal implementation
`src/rpc/handler.js` now accepts an **optional server-owned second argument** `{authAdapter}`. When and only when that trusted object is supplied by a server Worker, `handleRpc` dispatches **exactly** `login`, `validateSession`, `logout` after the existing same-origin method/content-type/size/JSON checks plus exact-arity and bounded-string checks. It calls only own descriptors of those three literal names and returns source envelopes with `Cache-Control:no-store` and `X-Content-Type-Options:nosniff`. Malformed replies, backend errors and missing methods fail closed with generic HTTP 503; no exception/password/token is reflected.

**No other method can become callable through the opt-in adapter.** No dynamic dispatch to arbitrary names and no reliance on caller-supplied actor, role or clock.

`src/index.js` still calls `handleRpc(request)` with **no adapter**. `src/rpc/registry.js` remains empty. Thus deployed and public Preview requests retain the established 503 login and 501 other-RPC responses; this PR does **not** activate authentication or give Preview a D1 binding.

## Real D1 evidence (test-only)
The nondeployable `wrangler.m04-auth-http-test.jsonc` uses fake local database UUID `00000000-0000-0000-0000-000000000019`, `workers_dev:false`, no routes, and the existing `tests/fixtures/m04-auth-migrations` **test-only** auth DDL. Its local Worker fixture supplies a **server-owned** fixed clock and synthetic normalizer. Real Workerd/D1 integration tests verify:
- Same-origin `login` → `validateSession` → `logout` → revoked validation, with exactly original payload shape.
- Actual D1 session stores SHA-256 **hash** of token, never bearer token; request-body `nowMs` cannot override trusted server time.
- Cashier module metadata does not authorize any privileged RPC. Disabled user immediately loses session authority.
- Wrong password gets generic failure; unregistered methods, cross-origin requests, invalid content type, method or arity fail closed.
- Test Worker routes are inert outside its isolated test path; no public/production auth import or D1 binding.

Tests use the existing `tests/integration/m03-workerd.spec.mjs` PR-only local-D1 workflow and ordinary Node test suite, preserving original 84 source files and frontend unchanged.

## RED → GREEN discipline
New Node test cases were pushed before any production handler change. GitHub Actions on RED commit `b174b3742d3399094b0c3938a0b25262ca206e8f` recorded two expected failures: login expected HTTP 200 but received disabled HTTP 503; malformed auth args expected HTTP 400 but received HTTP 503. Remaining public safeguards passed. The smallest optional transport change was then committed to `src/rpc/handler.js`, and actual Workerd/D1 tests were added.

## Owner-review gates not lifted
**Do not** enable this adapter in `src/index.js` until approved production M04 schema and private D1 binding, trusted staff import/provisioning and legacy password upgrade, phone normalization, security rate limiting, role/tenant isolation policy, session policy, public endpoint abuse/security review, and owner-approved D1 staging/cutover and rollback exist. The current business model is one business per private D1 binding; there is no approved shared-tenant M04 auth. Account/user/role mutations, Settings RPC, POS and financial writes remain 501/inert until their own audited authorization and transactional gates pass.

### Change inventory
- Production source: **only** `src/rpc/handler.js` optional internal adapter; no public behavior change.
- Tests: `tests/m04-auth-http-transport.test.mjs`, `tests/integration/m04-auth-http-workerd.spec.mjs`, local-only `tests/fixtures/m04-auth-http-worker.mjs`, `wrangler.m04-auth-http-test.jsonc`, import in local-D1 test entry.
- Documents: Superpowers design, TDD plan, this security gate.
- Database migrations, GAS files, production Wrangler configs, public UI, RPC registry, public Worker and financial writers: **unchanged**.
