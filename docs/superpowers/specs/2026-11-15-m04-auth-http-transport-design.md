# M04 — gated HTTP transport for the existing D1 authentication bridge

**Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` frozen `Auth.gs`; SherERP `src/rpc/handler.js`, `src/auth/d1-legacy-rpc.js`, `AGENTS.md`.

**Scope:** Add a narrowly scoped, **server-supplied only** `authAdapter` option to `handleRpc(request, {authAdapter}={})`, which allows the three original methods `login(mobile,password)`, `validateSession(token)`, `logout(token)` to be invoked through the existing same-origin JSON `{fnName,args}` transport. The option is **never provided by a browser**; the current production `src/index.js` continues calling `handleRpc(request)` without it. Do not change `src/rpc/registry.js` (remains empty).

In the opt-in path:
- only three literal names are recognized; extra methods, staff/role mutations, arbitrary exports and `getAppShellData` remain disabled (501).
- exact argument arity, string type and bounded lengths enforced before a D1 call; existing origin/method/content-type/size/name checks run first.
- await the already audited D1 `createD1LegacyAuthRpc`; retain source envelope `{success:true,data}` and `{success:false,message}`, `no-store` and `nosniff` headers.
- fail closed with generic 503 on unavailable adapter, database errors, or malformed backend result; never reflect raw password, token, SQL or exception message. No additional session cache, client-supplied clock, or client-supplied role.
- run a nondeployable Worker fixture with fixed **server-owned** synthetic clock and test phone normalizer against the existing **test-only** M04 auth migration. Require real local Workerd+D1 tests for sign-in/validate/logout and revocation on account status change.
- preserve the existing no-adapter public 503 login and 501 remaining RPC behavior unchanged; test no production D1 bindings or added routes.

**Not approved:** publishing live auth, promoting test-only auth migrations, importing legacy password materials or staff records, modifying public Worker config, setting up a new production auth DB, exposing any financial writer. These remain separate, owner-reviewed M04/M02/M10 security/cutover gates.

**Design:** reuse the existing parser and legacy bridge; no duplicate HTTP parser, no new external dependency, no framework.
