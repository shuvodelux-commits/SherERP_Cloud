# Superpowers — M04 restore revokes role-invalid internal bearer (2026-11-17)

**M04 owner:** issues #23/#252; M03 shared integrator #22; coordination issue #456.  
**Fresh base:** `main@40f6ae4b9cb6f17bbd6fed72a3455ba356ffed02`.  
**Frozen source:** `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `Auth.gs.validateSession(token)`, `RoleManagement.gs`, `UserManagement.gs`.  
**M04-owned paths only:** `src/auth/d1-legacy-rpc.js`, `tests/integration/m04-legacy-rpc-workerd.spec.mjs`, this plan. No shared D1 SQL/migration, `src/rpc/**`, `src/index.js`, test Worker config, public API, private staff export, or financial writer.

## Implementation overview (12 sentences)

1. The M04 internal bridge preserves the original `validateSession(token)` success/failure envelope.
2. The session validator first checks live D1 session, account status, credential version, role version, absolute expiry and idle expiry.
3. The bridge then rereads the source-shaped profile and validates role JSON, allowed modules and their consistency.
4. Current source-shaped login explicitly revokes any newly minted bearer when its role profile is unusable.
5. Current source-shaped restore fails closed to the browser if its profile is unusable but does not revoke that bearer.
6. This leaves a core-valid internal session token in D1 until expiry or another state change.
7. If a separate SQL claim trusts only current session and malformed role data, the token could still be considered an active bearer even though profile restoration denied it.
8. This task protects session hygiene in M04 but does not replace M03 atomic SQL authorization or its duplicate-key protection requirement.
9. An isolated real local Workerd/D1 test will mint a genuine internal bearer for a stored role with invalid permissions metadata.
10. The RED expectation is that a failed source-shaped restore also persists `revoked_at_ms` and prevents a second core validation.
11. The GREEN change is one conditional revocation call on the restore path only, leaving the public route disabled and original failure message unchanged.
12. Require full exact-head GitHub Actions, security review and safe merge; M03 trusted time/business/permission SQL and real-staff staging remain independent production blockers.

## Superpowers RED→GREEN checklist

- **RED:** add a real Workerd/D1 integration test to the already required M04 auth CI suite; seed no customer or real staff data, use existing synthetic corrupted role or a new isolated synthetic role, call `loginWithD1` to obtain the bearer, then call the original-shaped `validateSession` bridge and assert persistent revocation. Capture a real failed CI job and exact test-only SHA, not merely a local script.
- **GREEN:** in `createD1LegacyAuthRpc.validateSession`, if core validation succeeds but `sourceProfile` fails, call `revokeSessionWithD1` using the same trusted server timestamp, then return the existing expired-session failure envelope.
- **Negative invariants:** already revoked/expired/invalid token remains denied; valid Administrator and canonical role restore still work; no identity/profile secret leakage; no extra user/role updates, no remote DB writes.
- **CI/merge:** all currently required GitHub workflows (44 at planning), no bypass or skipped shard, limited diff to M04-owned files, no unresolved reviews. Merge only after all green and review, then verify code on actual `main`.
- **Rollback:** revert the M04 source and test change. A failed source-shaped restore may no longer keep a valid internal token; this intentional stricter revocation is the only behavior change.

## Release boundary

This security hardening changes only a **local/internal, nondeployable adapter**, not the production/public RPC registry or a shared SQL grant predicate. It does not fix the separate M03-owned canonical role JSON authorization inside a protected mutation, trusted server clock, tenant/business binding, actual source USERS/ROLES export or private staging. Keep production auth and shared posting gated.
