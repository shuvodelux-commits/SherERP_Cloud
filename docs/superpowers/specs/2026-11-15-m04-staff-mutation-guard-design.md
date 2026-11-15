# M04 Last Administrator and Sensitive Staff Mutation Guard — Design (2026-11-15)

**Status:** Internal-only, source-anchored policy preparation. This helper is a necessary authorization preflight, never an active access-control enforcement point by itself.

## Context and legacy source
Pinned Mohim_ERP main SHA `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/UserManagement.gs`. The original user-management functions forbid deleting the currently logged-in user; forbid deactivating, demoting or deleting the last Active Administrator; and protect Administrator role assignment and Administrator password reset from non-admin operators. `Auth.gs` requires server-side staff and role validation. Legacy uses GAS `LockService`; do **not** treat this pure JS check as an atomic transaction.

## Alternatives
- **Chosen:** a small deterministic internal decision helper for proposed mutations, exercised with source-proven rules and malformed-input tests. No identity lookup, passwords, SQL, session mutation or public RPC.
- Implement `src/db` staff tables and live `updateUser` now: rejected; M03 owns DB/schema/kernel, M04 D1 session/permission/throttle prerequisites still pending.
- Reimplement legacy client-side visibility: rejected; hiding buttons is not an access-control boundary.

## Interface
`evaluateStaffMutationGuard(context): {allowed:boolean,code:string}`, where `context` is a server-constructed **own-data** plain object:
- `operation`: one of `'delete'`, `'set-status'`, `'set-role'`, `'reset-password'`.
- `actor` and `target` are trusted D1-retrieved records with own data fields `'User ID'` (nonblank source string), `'Role'` (nonblank string) and `'Status'` (exact `Active`/`Inactive`). Actor must be Active. No role/status guesses or coercion.
- `activeAdministratorCount`: positive safe integer from a consistent, trusted DB snapshot, not from a browser or mutable cache. Zero/invalid/missing means deny.
- For `set-status`, require own `nextStatus` with exact `Active`/`Inactive`; for `set-role`, require own `nextRole` with nonblank string and no other update fields. For other operations omit next fields. For malformed context, missing own fields, accessor/proxy values or unexpected keys, return `{allowed:false,code:'INVALID_CONTEXT'}`; no thrown error details.
- Deny self-delete regardless of role/count. Deny last-active-admin deactivation, demotion or deletion using source-compatible conservative protection (including a corrupted snapshot where an Administrator row is inactive but count=1). Deny Administrator password reset by non-Administrator; deny any Administrator role assignment by non-Administrator (stronger than GAS's non-admin edit of an existing Administrator).
- No implicit permission grant: `allowed:true` only means the narrowly described invariants did not reject the mutation. Future handler must separately verify active user/role, actual RBAC for operation, supplied target row, uniqueness, credentials and all concurrent DB constraints. Return fixed issue code only; never return actor/target identifiers or raw fields.

## Atomicity and launch gate
A stale last-admin count cannot make concurrent demotion/delete safe. Future M04 D1 implementation **must** enforce at-least-one-active-admin with transactional/CAS SQL updates, adversarial race tests, session revocation and actor-bound server roles before activating public staff mutation RPCs. This branch does not touch D1 or implement any account-management write.

## Ownership
Create only: `src/auth/staff-mutation-guard.js`, `tests/m04-staff-mutation-guard.test.mjs`, this spec, `docs/superpowers/plans/2026-11-15-m04-staff-mutation-guard.md`. Do not edit `src/db`, migrations, `src/rpc`, `src/index.js`, original snapshot/frontend, Cloudflare config, or M04 open PR #30, #34, #35, #36, #39, #42 modules. ADR-007 Party/finance isolation remains untouched.

## Verification
TDD RED→GREEN, synthetic cases for last Administrator mutation, self-delete, concurrent snapshot caveat, admin assignment/reset, invalid context, no PII in output and public login RPC 501. Full `npm test`, source manifest, frontend build, caller inventory, JS syntax and diff checks; review-only draft PR. `PARALLEL-MODULE-READY` remains false.
