# M04 — Align shared opaque-token digest with real D1 session login (2026-11-16)

**Authority:** `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/M04_AUTH_SOURCE_CONTRACT.md`, frozen source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (`Auth.gs`, `UserManagement.gs`). **Previous release:** #292 merged to `main` with 14/14 checks. **Scope:** internal token digest primitive and synthetic real-Workerd integration only.

## Overview (15 sentences)
1. The frozen legacy GAS source mints 64-character opaque session-token strings but the new Cloudflare D1 schema stores only one-way token digests.
2. The reviewed internal M04 login code mints 32 cryptographically secure random bytes and encodes them as lowercase hexadecimal bearer tokens.
3. That login code stores the SHA-256 digest of the original 32 **decoded bytes** in `auth_sessions.token_hash`.
4. The existing internal validation and logout code decode the same bearer token before looking up the corresponding D1 digest.
5. The separate shared `hashOpaqueSessionToken` primitive currently hashes the UTF-8 bytes of all **64 hex characters** instead.
6. These are distinct SHA-256 inputs and therefore yield different lookup keys for the same valid bearer token.
7. The shared helper is presently internal and unconnected to the public Worker, but this inconsistency makes future integration easy to get wrong.
8. This change aligns the shared helper with the already-tested D1 login and session lookup representation rather than changing persisted session semantics.
9. Input remains exactly 64 lowercase hexadecimal characters, with malformed and uppercase values rejected before cryptography.
10. The helper must decode the 32 token bytes using standard Worker-compatible JavaScript without relying on Node Buffer, filesystem or network APIs.
11. Test-first coverage will explicitly compare the two distinct digest representations and require agreement with the D1 core byte representation.
12. A synthetic local-Workerd D1 integration test will verify that a token issued by the existing login resolves to the same stored digest through the shared helper.
13. The existing random-token generation, token entropy, legacy session time limits, RBAC, revocation and credential-upgrade code remain unchanged.
14. No public login or arbitrary RPC handler is enabled, and no remote/staging/production D1 database or genuine staff credential is touched.
15. The change must pass all GitHub CI checks on its exact PR head before review/merge, preserving the Superpowers RED→GREEN sequence.

## Test-first work plan
- RED: append a unit test to `tests/m04-session-token.test.mjs` requiring decoded-byte digest parity and explicit difference from UTF-8-hex hashing; append a small real D1 assertion to existing `tests/integration/m04-auth-workerd.spec.mjs`.
- Check CI failure caused by the **old** helper representation, not unrelated failures.
- GREEN: modify `src/auth/session-token.js` digest input only; update the old UTF-8-specific unit expectation to decoded-byte semantics; keep malformed-input, entropy and public isolation tests untouched.
- Run exact-head GitHub Actions 14/14, including local Workerd and regression; no new dependency, D1 schema or Worker route.
- This is not authorization to enable the original `login`, `validateSession` or `logout` on public `/api/rpc`, or to adopt a new legacy `Never`-expiry policy.

## Files, RPC and tables
- Planned files: `src/auth/session-token.js`, `tests/m04-session-token.test.mjs`, `tests/integration/m04-auth-workerd.spec.mjs`, this plan.
- Real local synthetic Workerd table: existing `auth_sessions` readback only; no DDL or new writes beyond existing fixture login test.
- Public `src/rpc/registry.js`, `src/index.js`, Wrangler preview, migrations, source GAS and remote D1 staging workflow: **unchanged**.
