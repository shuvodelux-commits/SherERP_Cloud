# M04 — Business-scoped staff session boundary (21 Nov 2026)

**Issue:** #867 (approved Settings → Users & Roles + specific-business staff sign-in). **Workstream:** M04 internal Shop staff auth. **M03 owns:** Control D1 business directory, actual selected-Shop D1 resolution, numbered migrations, private routes and hosted activation. **Preexisting M04 reused:** `src/auth/d1-auth-core.js` and `src/auth/staff-phone-identity.js`; no duplicate credential/session stack.

## What is implemented

A deliberately **internal-only** `m04-shop-staff-session-scope.js` adapter wraps the reviewed M04 D1 login, session validation and logout operations, requiring a server-trusted `{shopDb,shopId,databaseId,databaseMarker}` tuple. The browser-selected Shop ID is *only* an equality constraint against that trusted Shop, **never a database locator**. Before touching credentials, the adapter reads the immutable `shop_identity` row from the bound physical Shop D1 and compares all three fields exactly. A mismatched or missing Shop, malformed phone, role/actor claim or accessor-bearing request is denied without a credential query. Successful logins use the existing PBKDF2-SHA256 verifier, D1 throttling, versioned user/role authority, 30-minute idle and 12-hour maximum session, never the Owner Google cookie.

Staff phone spellings `017...`, `171...`, `+88017...`, `88017...` and Bengali digits are normalized server-side using the existing frozen source helper. Malformed or injected strings are refused. The same phone can legitimately represent two separate staff accounts in distinct Shop D1s; it does not create or infer a cross-Shop membership, Party relationship or shared password. A user gets only `{shopId,user,token}` for the one authenticated Shop. Role or user revocation in Shop A does not alter Shop B's records.

## RED → GREEN evidence

- TDD first RED: `ERR_MODULE_NOT_FOUND` for missing internal Shop staff boundary.
- Unit tests **2/2**: source phone normalization; forged actor, role, wrong Shop and accessor input denied before touching D1.
- **Real local Workerd with two physically separate Shop D1s**: migrated pinned `staging-migrations/shop-identity/0001_shop_identity.sql` and approved **test-only** `migrations/0003_auth_core.sql`, two independent role records and PBKDF2 staff accounts sharing a phone. Verified correct Shop A/B passwords, wrong password, cross-Shop token denial, mismatched physical D1 identity, changed role epoch, disable/re-enable of user, explicit logout and no public endpoint. **1/1** real Workerd test green.
- No external Clerk, third-party identity provider, SMS, email, new database, token-in-URL, password disclosure, production/staging D1 write or migration.
- Existing Admin MFA/recovery PR #861 owns `src/auth/platform-admin-recovery.js`; this branch does not edit it or the generic M04 core.

## Critical production blockers (not claimed complete)

The present Shop D1 migration plan does **not** provision live M04 `auth_users`, `auth_roles` and `auth_sessions` as ready user-account tables; M04's versioned auth SQL remains a local candidate. The private Owner Worker accepts first-Owner Google identity but still has **no staff sign-in endpoint, staff cookie, Owner-approved invitation/activation flow, business-code directory, Role Manager writes, or staff module authorization on POS/Finance**. This module alone cannot allow staff to sign in to the hosted ERP.

For MVP, M03 should approve a **Shop-scoped** staff migration after data/source reconciliation, implement a trustworthy human business-code → verified Shop D1 mapping in the Control D1, provision staff via short-lived single-use activation with staff setting their own password, and mount a separate private staff session cookie. M04 must enforce source-defined role permissions on every module mutation, no role escalation, last-active-Administrator protection, invalidation on revoke and two-business isolation. Owner Google access remains independent; Staff does not inherit the Owner session. M09 can then activate the already preserved Users/Roles pages under #867 with Playwright at 320/390/768/1024/1440.

**Release boundary:** No hosted route, workflow binding, D1 schema migration, production tenant, password, invite or staff user was created by this PR. The internal adapter must remain unused in production until the above prerequisites are reviewed and proven in real Shop D1 and hosted acceptance. Its return value must not be treated as a POS or ledger permission.
