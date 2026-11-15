# M04 internal source-faithful login RPC adapter

Date: 2026-11-15. Base: merged #55 and #60. Source: frozen legacy Auth.gs, Utils.gs and javascript.html and docs/M04_AUTH_SOURCE_CONTRACT.md.

## Need and scope
Merged D1 login core authenticates securely but does not return the native GAS login payload, nor handle the native validateSession/logout envelopes. Implement src/auth/d1-legacy-rpc.js with internal, trusted D1-backed login/validateSession/logout methods returning GAS-style {success,data} or {success:false,message}. Do not register a public Worker route. No real user data, production/staging schema migration or Cloudflare binding.

## Proposed adapter
createD1LegacyAuthRpc(db,{now,normalizeMobile}) accepts a server D1 binding and server-supplied clock and normalizer; no browser can set these. Require an explicit normalizer, never guess Party identity. Login calls loginWithD1 for credential check/throttle and session issuance, then resolves an authoritative profile from D1 using session hash + active user/role/authority version constraints. Admin payload allowedModules:null,permissions:null. Custom role payload uses source-style Allowed Modules CSV plus Permissions JSON from the corresponding active D1 role row. Unknown module keys, duplicate keys, invalid JSON/permission object or unreviewed role metadata fail closed, revoking newly issued token. ValidateSession rechecks the token and profile; logout revokes D1 session and returns {success:true,data:"logged out"}. No secrets, hashes, salts, raw error messages, token logs, user enumeration, or client-supplied actor/role. Even a successful UI payload is NOT proof of business RPC permissions: every write must authorize against current D1 within its SQL boundary.

## Proposed test-only role metadata
Add allowed_modules TEXT NOT NULL DEFAULT '' to tests/fixtures/m04-auth-migrations/0001_auth_core.sql. This is a local-only proposed source mapping and remains subject to M03 approval. Native UI.gs PERMISSION_MODULES is the allowlist; preserve original role module order. Empty allowed modules is allowed. Do not authorize user/role management just because keys appear in UI metadata.

## Test-only Worker
Add __m04_test__/rpc handler for login,validateSession,logout in tests/fixtures/m04-auth-worker.mjs only; require synthetic request clocks and trusted fixture phone canonicalization. No update to deployed src/index.js or src/rpc/registry.js. Original public login stays HTTP 503 and protected sales RPCs remain HTTP 501.

## Security boundaries
No actual staff import, no legacy SHA256 migration, no first admin bootstrap, no real staging D1 schema or public RPC. Source response contract is protected by tests; live activation needs M03 owner-reviewed schema, staff phone resolver from PR39, full role/permission migration, KDF upgrade, protected staging session/RPC authorization, and rollback/backup approval.
