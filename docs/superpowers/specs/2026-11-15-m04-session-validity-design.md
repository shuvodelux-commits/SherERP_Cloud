# M04 Session Validity Predicate — internal design (2026-11-15)

**Status:** isolated authentication preparation; not wired into any RPC, D1 query or public Worker route.

## Context
The pinned `legacy/source/Auth.gs` stores `SESSIONS.Token, User ID, Created At, Expires At, Last Activity`. Current GAS `isSessionExpiryValid_` accepts `Expires At='Never'` and dated expiry; `validateSession` upgrades dated sessions to 'Never' after restoration. This historical behavior is **not** approved for public Cloudflare sessions. The M04 contract requires explicit server-controlled absolute/idle expiry, D1 revocation and fresh user/role authorization. The database/session schema and expiry duration are not yet approved; this design must not choose or ship them.

Immutable source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; `legacy/source/Auth.gs` blob `f1c0895e33eb89430337b752692d0023797b7d21`.

## Approaches
1. **Chosen:** pure, fail-closed session timestamp and revocation eligibility predicate consuming an explicit proposed record/policy. It has no DB writes, can be tested now and does not select a production TTL.
2. Add actual D1 sessions and signed-in RPC handlers. Rejected: M03 single owner, pending M04 session policy, throttle, user/role and Workerd tests.
3. Keep original `Never` and 5-minute cache on Workers. Rejected: stale/revoked sessions and unbounded lifetime are not acceptable for public auth.

## Internal API
`isSessionWithinPolicy(session, policy, nowMs): boolean` (new `src/auth/session-validity.js`) is only a **necessary** preliminary check. It must never be used alone to authorize a request.

- `session` is a proposed server-loaded object with own data properties `createdAtMs`, `lastActivityAtMs`, `expiresAtMs`, `revokedAtMs`.
- `policy` is a server-owned explicit object with required `maxLifetimeMs` and `maxIdleMs`. This helper **chooses no defaults**; if either is missing, invalid or non-positive, deny. The future owner must approve values separately before deployment.
- `nowMs` is trusted server time supplied explicitly to make tests deterministic. It must be a nonnegative safe integer; never pass a browser-supplied timestamp.
- Accept only nonnegative safe-integer Unix-millisecond timestamps; strings, ISO dates, `'Never'`, undefined, infinities, fractional values, missing revocation state and inherited/accessor fields fail closed. Only `revokedAtMs === null` represents not revoked.
- Require `createdAtMs <= lastActivityAtMs <= nowMs < expiresAtMs`; `createdAtMs < expiresAtMs`; `expiresAtMs - createdAtMs <= maxLifetimeMs`, `nowMs - createdAtMs < maxLifetimeMs`, and `nowMs - lastActivityAtMs < maxIdleMs`. Exactly at either boundary is expired. No arbitrary grace period or client override.
- Return only boolean to avoid leaking session/account data. Do not cache or update Last Activity; later D1 session implementation must perform atomic trust checks and writes.

## Files and ownership
- Create `src/auth/session-validity.js`, `tests/m04-session-validity.test.mjs`, this spec and Superpowers plan.
- Do not touch shared `src/db`, SQL migrations, frontend, `src/index.js`, `src/rpc`, `src/auth/legacy-password.js` (merged PR #31), `src/auth/session-token.js` (open PR #34), or pending permission-policy PR #30.
- No Party, stock, cash, bank, ledger, finance, staging D1 or production effects.

## Verification and limits
Use RED→GREEN TDD on valid/expired/boundary/clock/revocation/missing-policy tests; run the full source, Node and frontend gates. Public login and sessions stay 501. Real Worker/D1 tests, database-enforced revocation, account disable, last admin and issuer/role binding remain later M04 gates. Open a draft PR; no merge/deploy in this preparation slice.
