# M04 — authorize inside the D1 write, not an earlier preflight

**Scope:** Local test-only Workerd/D1 acceptance contract. No deployed login, public RPC, real session schema, inventory/finance posting or remote D1 writes.

## Why this exists

`docs/M04_D1_SESSION_PREFLIGHT.md` verifies that a revocable opaque token can be checked against a current active user and role. A **separate** session preflight is not sufficient for sensitive mutations: a role or user can be disabled after preflight and before the write. Original `legacy/source/Auth.gs` checks authenticated users and permissions on protected server functions; a Cloudflare D1 migration must preserve current authority at the mutation boundary.

## Concrete tested contract

`tests/fixtures/m04-atomic-authority.mjs` implements **only a synthetic** `createSyntheticAuthorizedD1Mutation(DB).decrement_({tokenHash,tenantId,itemId,quantity,now})`. Caller identity comes from a token **digest** resolved inside SQLite, never a client-provided user/role ID.

A single parameterized `UPDATE synthetic_auth_resources ... WHERE ... AND EXISTS(SELECT 1 FROM synthetic_auth_sessions JOIN synthetic_auth_users JOIN synthetic_auth_roles ...)` does all of the following **in the same SQL statement**:
- Limits the target resource and session to the same synthetic `tenant_id`.
- Requires a nonrevoked session with `expires_at > now`.
- Requires currently active User and Role and an explicit `can_edit=1` synthetic grant.
- Checks User role membership and both User/Role authority version snapshots.
- Refuses insufficient integer synthetic units or any unmet condition without changing either tenant.
- Uses `UPDATE ... RETURNING` to prove one atomic mutation. A zero-row result gives one generic denial (no user/role/stock existence leak).

**Authority invalidation:** The synthetic D1 schema also has test-only SQL triggers that increment `auth_version` when a User's status/role assignment or a Role's status/edit grant changes. These are necessary to prevent an old session from regaining authority if a caller disables and then re-enables access without updating the version manually. The regression tests were RED before the triggers and GREEN after them.

**Data handling:** Four strictly synthetic tables are created at test runtime: `synthetic_auth_roles`, `synthetic_auth_users`, `synthetic_auth_sessions`, and `synthetic_auth_resources`. A separate local Workerd D1 config uses fake UUID `00000000-0000-0000-0000-000000000006` with `workers_dev:false`, no public routes, and no cloud DB connection. The request object contains a trusted synthetic clock/tenant, not an approved client API contract.

## Verification

Thirteen real local Worker/D1 tests verify valid same-tenant writes, cross-tenant rejection, revocation/expiry, user disable/re-enable, role downgrade/disable/re-enable, role reassignment, insufficient units, competing last-unit writes, concurrent revocation/mutation serialization, invalid inputs before SQL, and absence of a public route. The suite is imported through existing `tests/integration/m03-workerd.spec.mjs`, run by PR-only local D1 CI.

## Still not covered

This is **not the real M04 authorization service**. The `can_edit` flag is a synthetic stand-in, not the source `Permissions` JSON. No real staff IDs, KDF, tenant assignment, session issuance/expiry policy, role migration, audit journal, FIFO lot, invoice, split tender, financial accounts or exact-once reversal exists here.

Critically, for any future **multi-statement** financial D1 batch, its authorization predicates and business preconditions must be reviewed to operate within that transaction; a JavaScript preflight or separate update to a dummy counter does not authorize a subsequent posting. Real M02/M03/M04 integrations and owner-reviewed public RPC gating remain prerequisites for M05–M08.
