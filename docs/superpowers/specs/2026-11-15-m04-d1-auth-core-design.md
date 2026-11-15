# M04 — D1-backed authentication core, tested without public activation (2026-11-15)

## Owner request / observation
PR #50 is merged; public preview now returns 503 login unavailable rather than 501. Functional login remains blocked: no real auth schema, reviewed staff import, durable session storage, or public handler.

## Architecture selection
Implement a **real Workerd/D1-tested internal login, session validation and revocation core** plus a proposed auth schema in test-only `tests/fixtures/m04-auth-migrations/0001_auth_core.sql`. Do NOT add a migration under `migrations/` or modify shared `src/db`: M03 has exclusive D1/migration ownership, its existing remote staging gate requires exactly two applied migrations, and auth schema requires owner review before rollout. Do NOT register public auth RPC, modify `src/index.js`, or bind preview D1. Retain 503 on public login.

Alternatives rejected:
- “Demo” hardcoded admin credentials, client-side login or acceptance of legacy plaintext/SHA256 credentials in a public endpoint: insecure.
- Write directly to shared `migrations/`, D1 staging or production without coordinated owner: violates AGENTS.md, remote-count gates and backup policy.
- Return a fabricated token without DB validation: explicitly forbidden.

## Internal contract
`src/auth/d1-auth-core.js` exports:
- `createOfflinePasswordCredential(password)`: PBKDF2-SHA256 with >=210,000 iterations, fresh 24-byte random salt, fixed 32-byte derived digest, lowercase hex. **Offline provisioning/test helper only; never a public RPC**.
- `loginWithD1(db,{phoneKey,password,nowMs})`: requires server-normalized eleven-digit Bangladesh mobile phone key (source equivalence from PR #39 to be added by future RPC), nonempty secret, trusted nonnegative integer clock and D1 binding. Generic `{authenticated:false}` for invalid credentials, ambiguous/disabled users, inactive role or locked phone; authenticates only existing active users and built-in Administrator / active custom role. Persistently throttle failed guesses using one atomic D1 UPSERT per failure (5 failures -> 15-minute lock, reset after one-hour TTL). Lock-state rechecked within session insert to block stale check races. On success, create 32 CSPRNG bytes token, store **SHA256 digest only** in D1, 12-hour max session and 30-minute idle, then return `{authenticated:true,token,user:{id,name,role}}`. Never return hash/salt and never store raw token. No cache.
- `validateSessionWithD1(db,{token,nowMs})`: SHA256 token digest; atomically update last-activity only while unrevoked/unexpired/idle-valid and target user and role are still active, then select trusted source user; returns `{authenticated:false}` or `{authenticated:true,user:{id,name,role}}`. No stored raw token/role bypass.
- `revokeSessionWithD1(db,{token,nowMs})`: revokes digest record (idempotent, generic success) so future validation rejects.
- All D1 errors throw to their future host error boundary; **never** reinterpret storage failures as valid credentials/sessions.
- Incoming `nowMs` is trusted server time, not a client-supplied production value. Synthetic tests use injection solely for deterministic expired/idle/throttle cases.

## Proposed schema (test only)
`auth_users` (source IDs; unique canonical staff phone keys; PBKDF2 credential salt/hash/iterations, status, role); `auth_roles` (custom roles only, status), `auth_sessions` (token SHA256 digest, user foreign key, timestamps, revocation), `auth_login_throttle` (hashed phone key, count, lockout, reset). SQL triggers reject deleting/demoting/deactivating the **last active Administrator**. Case/constraint enforcement rejects malformed credentials/roles and duplicate canonical phone entries.

**Not release-ready:** no first-admin bootstrap, reviewed import, legacy verifier-to-PBKDF2 upgrade, permissions issuance, account mutations with actor RBAC, global IP-based rate limits, automated retention pruning, side-channel timing proof, production D1 provisioning, or public handler. Further auth RPC functionality depends on owner sign-off of shared M03 schema/migration. Passing local tests means **no auth endpoint is being activated**.

## Tests / owner constraints
- Red-green Node tests, SQL schema guard tests via `node:sqlite`, real local Cloudflare Workerd/D1 harness tests with fabricated accounts (no live data), replay/collision/lockout/expiry/disable/revocation and concurrency invariants.
- New standalone files only: `src/auth/d1-auth-core.js`, `tests/fixtures/m04-auth-migrations/0001_auth_core.sql`, `tests/fixtures/m04-auth-worker.mjs`, `wrangler.m04-auth-test.jsonc`, `tests/integration/m04-auth-workerd.spec.mjs`, `tests/m04-auth-schema.test.mjs`, design/plan.
- No modification to `migrations/`, `src/db/`, deployed Worker, RPC registry, legacy source/frontend, shared staging workflows, Cloudflare preview or remote D1.
- Run all Node/source/build/Workerd gates and draft PR. M03 owner must promote reviewed SQL to migration and update safe staging schema counts, never remotely apply until authorized.

The test fixture uses compatibility date 2026-10-13 for locally reused workerd 4.148.0; the real production Worker retains 2026-11-14 and is not modified. A dedicated Workerd CI check needs a separate owner-authorized workflow change: this GitHub credential cannot push `.github/workflows` updates. Existing GitHub checks exercise the Node schema contract; the Workerd integration was run locally against a reused Wrangler harness. This does not certify production deployment compatibility.
