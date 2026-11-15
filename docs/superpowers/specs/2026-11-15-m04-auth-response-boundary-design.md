# M04 — Strict trusted-auth HTTP response boundary

**Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` Auth.gs login/validateSession/logout envelopes; audited internal `src/auth/d1-legacy-rpc.js` and `docs/M04_AUTH_HTTP_TRANSPORT_GATE.md`.

## Issue
The opt-in M04 HTTP handler checks only `{success,data}` / `{success,message}` outer keys. If an internal auth adapter accidentally returns credentials or stale fields nested inside `data` (or returns an arbitrary untrusted error message), `Response.json` forwards them to the browser. Even trusted server adapters should have a strict final response boundary.

## Scoped change
Only strengthen `src/rpc/handler.js`'s opt-in `validAuthEnvelope(result,method)` before JSON serialization, with a small local validation helper. Check own enumerable data properties rather than invoking accessors. Require:
- `login` and `validateSession` success: exactly `data:{token,user,allowedModules,permissions}`; lowercase 64-hex token; exact user `{id,name,mobile,role}`, canonical 11-digit BD phone. No hash/salt, status, raw D1 rows, arbitrary nested keys, or `toJSON` accessors.
- Administrator metadata exactly `allowedModules:null,permissions:null`. Non-admin modules are bounded unique strings; per-module permissions contain only source `view/add/edit` booleans and source `delete` window strings. Null-prototype maps permitted; limits fail closed.
- `logout` success `data:'logged out'` exactly; never returns token or user.
- Authentication failures only preserve current internal bridge's three source-shaped strings: invalid mobile/password, expired session, and unavailable role. Unexpected/reflected errors fail with generic HTTP 503, no leaks.
- Reject malformed success/error envelopes, non-plain objects, accessors and symbol/extra properties. Preserve original no-store/nosniff headers and safe 503 handling.
- **No public activation**: `src/index.js` still invokes handler with no adapter, `src/rpc/registry.js` stays empty. No Worker routing, deployed D1 bindings, schema, authentication policy or staff importer changes. One source file + one Node test + scope docs.

## Tests (RED first)
Standalone Node tests call `handleRpc(request,{authAdapter})` with synthetic auth responses. Assert valid admin/cashier envelope parity; reject nested passwordHash/salt, invalid token, unexpected user/property/permissions, accessor and `toJSON` attacks, arbitrary error message and unsafe logout data. Original disabled public Worker login must remain HTTP 503. Observe failing tests in GitHub CI before implementation; after fix require full Node, real Workerd/D1 auth, preserved Chromium, local D1 and Cloudflare Preview checks. No remote PC needed.
