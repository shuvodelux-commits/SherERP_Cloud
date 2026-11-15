# M04 — revocable D1 session authority preflight (synthetic, local-only)

**Status:** **Test-only security acceptance fixture. NOT a real sign-in implementation.** Original source: immutable `legacy/source/Auth.gs`, `legacy/source/Config.gs` USERS/ROLES/SESSIONS column names, and `docs/M04_AUTH_SOURCE_CONTRACT.md`.

Original Apps Script login uses opaque random tokens in SESSIONS, source User ID and Role, with `Expires At='Never'` for recent sessions and legacy dated expiry. The migration MUST preserve external `login`/`validateSession`/`logout` RPC shapes while hardening internet-facing session security. Non-expiring sessions remain **unapproved**, and this fixture **requires** a finite expiry supplied by trusted test context.

## Contract under real Workerd/D1

`tests/fixtures/m04-session-repository.mjs` exports a **synthetic** `createSyntheticD1SessionRepository(DB)` with three internal methods:

- `issue({tokenHash,userId,now,expiresAt})`: inserts only a **64-character lowercase SHA-256 token digest**, never a bearer token. A single SQL `INSERT ... SELECT ... RETURNING` checks the currently active User and Role, capturing both authority versions. Invalid or missing user/role, duplicate hash, malformed input and non-finite expiry refuse issuance.
- `resolve({tokenHash,now})`: performs a **fresh D1 join** against the current session, user and role; returns only `{userId,roleId}` when the token is not revoked or expired, user and role are active, user remains in the same role, and both original authority versions still match.
- `revoke({tokenHash,now})`: atomic `UPDATE ... WHERE revoked_at IS NULL RETURNING`, true once, false on replay. A revoked session never reactivates.

Three **synthetic** STRICT tables (`synthetic_users`, `synthetic_roles`, `synthetic_sessions`) are created only inside isolated local Workerd/D1 tests; no production D1 migration is involved. Tests use immutable synthetic identities and cryptographic digest fixtures, not uploaded credentials. The test harness uses synthetic UUID `00000000-0000-0000-0000-000000000005`, `workers_dev:false`, **no public routes**. A request to the test Worker returns 404. Live Worker and RPC registry remain untouched.

## Real D1 evidence

Nine integration tests verify issuance, no raw token storage, active role resolution, immediate revocation, repeat revocation, exact expiration boundary, disabled/re-enabled User and Role checks (old sessions stay revoked through version mismatch), role reassignment, missing users, duplicate token hash, competing same-hash issuance, malformed input denial before D1, and no deployed route.

The suite is included through the existing `tests/integration/m03-workerd.spec.mjs` PR-only local D1 integration entry. No workflow edits, remote D1 writes, cookies, grants or protected APIs.

## Critical remaining security work

This preflight **does not authenticate credentials**, hash passwords, issue tokens, set a real expiry policy, create real User/Role/Session migrations, enforce tenant boundaries, validate staff permissions or implement account status writes. Its input User ID and `now` are trusted synthetic server values; **never accept an untrusted browser User ID or clock as authorization**.

A separate session lookup can race user disable before business posting. Financial mutations must validate session/RBAC in an equivalent atomic authorization boundary or otherwise prove immediate revocation guarantees. The existing original source's `Expires At='Never'` is not permission to enable indefinite Worker sessions. M02 approved auth schemas, modern password KDF migration, durable login throttling, last-admin protection, real D1 login/validate/logout, RBAC and security review remain blockers.
