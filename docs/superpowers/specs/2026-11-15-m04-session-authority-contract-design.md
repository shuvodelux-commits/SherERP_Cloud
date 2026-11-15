# M04 — synthetic D1 session revocation and authority-snapshot contract

**Status:** Source-audited, **local-only acceptance fixture**, NOT a production auth backend, M02 migration, or public RPC. Original source: immutable `legacy/source/Auth.gs`, `Config.gs` USERS / ROLES / SESSIONS headers, and `docs/M04_AUTH_SOURCE_CONTRACT.md`.

**Problem:** Legacy GAS sessions are opaque bearer tokens stored in SESSIONS; restoring and validating them resolves a current active user/role but caching may retain stale rights. Cloudflare Workers/D1 must store **token digests, not plaintext bearer tokens** and cannot rely on per-instance cache for user disable/revocation.

**Design:** A synthetic local Workerd/D1 test fixture exercises exactly three test-created STRICT tables: `synthetic_roles(role_id,status,auth_version)`, `synthetic_users(user_id,role_id,status,auth_version)`, and `synthetic_sessions(token_hash,user_id,user_version,role_id,role_version,created_at,expires_at,revoked_at)`. Enforce FK relationships, unique digest and integer epoch fields. Token hash is 64 lowercase hex bytes returned by another trusted auth layer, not computed from a caller-supplied login request.

Expose only `createSyntheticD1SessionRepository(DB)` in `tests/fixtures/m04-session-repository.mjs`:
- `issue({tokenHash,userId,now,expiresAt})`: a single `INSERT ... SELECT ... RETURNING` storing current user/role versions only if both active; reject malformed data or zero/negative/indefinite expiration and duplicate digests. No public route.
- `resolve({tokenHash,now})`: fresh D1 lookup per request, joins current user and role; rejects revoked, expired, status-inactive or version-changed authority, even if re-enabled later. No cached permission assertions. Returns only `{userId,roleId}`, never token/hash/PII in responses.
- `revoke({tokenHash,now})`: parameterized `UPDATE ... WHERE revoked_at IS NULL RETURNING`; returns true for first revocation and false for repeat. Fail closed on D1/malformed results.

**Security/limitations:** No password handling, token issuance, login throttle, cookie policy, actual session lifetime policy, staff RBAC permission granularity, tenant partitioning, staff import, cross-tenant role scopes or public Worker. Values `now` and `userId` must originate from trusted server context in future integration; they are fixed test inputs here. Even a fresh session resolution query may race a subsequent business posting; future monetary writes need authorization inside the same transactional boundary or equivalent security guarantees. Do not enable live login.

**Acceptance:** Actual local Workerd+D1: issue/resolve, duplicate digest refusal, revoked replay, expiration at exact boundary, disabled/re-enabled user and role version revocation, missing identities, malformed digest/time, no SQL on invalid inputs, no private storage exposure in HTTP, no production schema/RPC/config changes. Included under existing M03 real-D1 test CI without editing GitHub workflows.
