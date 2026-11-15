# M04 — Authentication and Authorization Source Contract & Security Design (review proposal)

**Status:** source-audited design proposal / no authentication deployment. Approval of this document does not enable RPC handlers, import live users, or write remote D1.

**Sources:** immutable `legacy/source/Auth.gs`, `UserManagement.gs`, `RoleManagement.gs`, `Config.gs`, `UI.gs`, `javascript.html`. Enforce `AGENTS.md`, `docs/WORKSTREAMS.md` M04 and `docs/MIGRATION_PLAN.md`. Source verification currently covers 84 original files.

## 1. Preserve external RPC contract

| Public function from GAS | Original inputs | Result shape / security boundary |
| --- | --- | --- |
| `login` | `(mobile, password)` | `ok_({token,user:{id,name,mobile,role},allowedModules,permissions})`; do not enumerate users/passwords; failure `fail_(message)` yields `{success:false,message:string}` |
| `validateSession` | `(token)` | same auth payload only for a server-validated active session/user/role; restores persisted client session |
| `logout` | `(token)` | `ok_('logged out')` and server-side revocation; must not treat client-side token deletion as sufficient |
| `getUsersBootstrap`, `createUser`, `updateUser`, `resetPassword`, `setUserStatus`, `deleteUser` | `(token,...)` | staff `users` RBAC; never return password hash or salt |
| `getRolesBootstrap`, `addRole`, `updateRole`, `setRoleStatus`, `deleteRole` | `(token,...)` | staff `roles` RBAC and reviewed permission map; role deletion forbidden while assigned |
| `getAppShellData` | `()` | original unauthenticated display-only shop name/currency/nav metadata; explicitly review/sanitize before allowlisting |

The original client uses `serverCall(fnName, ...args)`, preserves `authToken` via local storage key `hwerp.session.token`, and has a `login` → `validateSession` restore → `logout` flow. Keep its external payloads and phone normalization while changing the trusted storage and implementation beneath them. No arbitrary RPC invocation by client-provided names. Do not expose `createFirstAdmin_`, `hashPassword_`, `requirePermission_` or other internal helpers through the web API.

Original `USERS` column mapping: User ID, Full Name, Mobile Number, Password Hash, Password Salt, Role, Status, Created By, Created At, Last Login. `ROLES`: Role ID, Role Name, Allowed Modules, Permissions, Status, Created At. `SESSIONS`: Token, User ID, Mobile Number, Created At, Expires At, Last Activity. Preserve original IDs and mobile leading zeros in import; migrate secrets only via owner-authorized protected export, never GitHub fixtures.

## 2. Source behavior to preserve and security gaps to close

- **Legacy password:** `SHA256(password + random UUID salt)` with constant-time hex comparison. D1 must verify old hashes for migration; on successful login replace with versioned, calibrated modern slow password KDF, and clear legacy verifier fields only after the replacement succeeds. Never log passwords, hashes or salts. The source's minimum password length for new users/reset is eight characters.
- **Legacy sessions:** new GAS sessions store `Expires At = 'Never'`; older dated sessions are checked and upgraded only on successful validation. This is a deliberate source behavior but **not automatic approval for internet-facing non-expiring Workers sessions**. Owner must sign off an explicit expiry/idle-trust policy before live login activation, including handling existing 'Never' sessions.
- **Legacy throttle:** five failures trigger a fifteen-minute lockout using CacheService per normalized mobile under LockService. D1 cannot use the volatile Worker process as an equivalent lock or cache; implement durable, server-enforced rate-limit state and atomic concurrency safeguards. Decide privacy-conscious account/IP rate limits with review. Never fail open if rate-limit storage is unavailable.
- **Session trust:** legacy caches resolved user/permission snapshots for up to five minutes; cache-generation bump failures could retain stale authority. New requests must validate server-side current session, active user, active role and permission version on each protected action, or use a provably safe invalidation scheme; account disable/revocation must be immediately effective.
- **User/role management:** last active Administrator cannot be deleted, deactivated or demoted; cannot delete self while signed in; non-admins cannot assign or reset the Administrator role; reset password, user deactivation/deletion, and role deactivation revoke affected sessions; forbidden role deletion while assigned. Enforce last-admin and competing edits with SQL boundary constraints/CAS, not read-then-write races.
- **RBAC:** `Permissions` JSON is per staff module/action; unauthorized/unknown modules default deny. Add/edit/view, date-window delete and backdate policies are distinct, and management deletes are boolean/unlimited. Source backdate defaults to `unlimited` — preserve source semantics in tests but require explicit security review. Unified Party Customer/Supplier/Vendor/Owner/Lender/Borrower/Payee roles **are NOT staff authorization roles**.

## 3. Proposed D1 boundaries — implementation gated

Design `users`, `roles`, `sessions`, and `login_throttle` as distinct typed schema contracts with immutable legacy ID/source provenance. Sessions store **hashes of high-entropy opaque tokens**, not raw bearer tokens; bind to an authenticated user ID and revoke/disable/version fields. Do not use JWT as an alternate authority or browser-supplied actor identity. Session and auth event writes, last-admin protection, and throttle attempts must be enforceable through SQLite constraints/transaction-safe SQL; failing multi-statement operations must roll back. Password upgrade must not create a usable session before the user/role/auth checks have committed.

The browser contract continues with same-origin `POST /api/rpc`, JSON `{fnName,args}`; the registry must explicitly allowlist each method and apply authentication and per-action permission/argument validation. `getAppShellData` may eventually be permitted pre-login only after demonstrating that its response is an allowlisted safe projection with no credentials, full Settings rows or private users.

No new auth schema, migration, hash upgrade or public routing belongs in this design-only PR. All real D1 work follows M02 approval and the one-owner database/kernel coordination gate.

## 4. Acceptance / negative tests for M04 coding

1. Existing/current/new passwords, invalid mobile, inactive account/role, throttled login, duplicate mobile and concurrent login attempts. Legacy verification upgrades only a proven correct credential.
2. Session creates/revokes/restores safely; malformed, revoked, expired, inactive or changed-role tokens are rejected **immediately**; forbidden long-lived stale cache.
3. Permission table for view/add/edit, delete/backdate windows, role downgrade, disabled module, last-admin restriction, self-delete and privilege escalation attempts; actor is resolved from session only.
4. Repeat/replay, simultaneous login failures, simultaneous last-admin edits and injected SQL names are tested against actual local Wrangler/workerd + D1, not only SQLite mocks.
5. Login/account-changing RPCs do not emit hashes, salts, tokens in errors/logs, do not permit public helper calls, and cannot access D1 in a publicly deployed Preview.
6. Document authorized import/rollback, masked audit logs and deterministic legacy-to-D1 staff identity reconciliation before staging writes.

**Current gate:** `src/rpc/registry.js` has no authenticated handlers and all above auth/user/role RPC calls remain 501. `tests/m04-auth-preflight.test.mjs` freezes that safe state; it must be intentionally replaced by authenticated real-D1 tests as M04 progresses.

**Parallel work:** M04 contract review and test preparation are safe beside M03 core and M01 UI QA. Do **not** begin concurrent business financial writers until M02/M03/M04 and the shared posting kernel are accepted. See `docs/M03_PARALLEL_READINESS.md`.
