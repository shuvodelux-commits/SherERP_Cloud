# M04 — Disallow same-token SQL REPLACE in isolated D1 authentication fixture

Date: 2026-11-15  
Owner: M04 security test lane  
Source: pinned `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (`Auth.gs`, `UserManagement.gs`)  
Parent: merged PR #196

## Scope and threat

PR #196 sealed `auth_sessions` against UPDATE of token ownership, authority snapshots, absolute expiry and revocation marker. SQLite `INSERT OR REPLACE` may delete/reinsert a conflicting token-hash row without invoking the UPDATE trigger, potentially resurrecting a revoked bearer. This is a **test-only schema** defect hypothesis. No production auth or preview/runtime bindings are in scope.

## Superpowers TDD acceptance

1. **RED:** Add a real local Workerd/D1 test that creates an opaque session through the internal login fixture, revokes it, then asserts a same-token-hash `INSERT OR REPLACE` with cleared revocation is rejected; preserve original row in test cleanup so RED does not cascade into other tests.
2. Record the failing run as evidence; do not claim GREEN until verified.
3. **GREEN:** Add one narrowly scoped `BEFORE INSERT` trigger to the isolated `tests/fixtures/m04-auth-migrations/0001_auth_core.sql` fixture that rejects an existing `token_hash` (regardless of revocation state). Normal first-time token issuance remains valid.
4. Run the M04 Workerd/D1 and full repository GitHub checks; verify the login/logout session lifecycle still works, and inspect CI on the current head.
5. Review the three-file diff before merge; no `src/**`, `migrations/**`, `wrangler.jsonc`, frontend, RPC registry or real staff data changes.

## Limitations and ownership

A privileged direct SQL actor can still explicitly delete then insert an existing hash; this guard addresses `INSERT OR REPLACE` only, **not** arbitrary direct SQL or a production threat model. Deletion/tombstone and real D1 migration ownership require separate M03 security design. This fixture must never be automatically promoted to production. Public login remains disabled.
