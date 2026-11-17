# M04 three-run completion program — Run 1 pending-credential session denial

**Workstream:** M04 Authentication / issue #23, authority handoff issue #252; coordination #456.
**Main base:** `7c81dca09f975fbda37586eb50c2763c7f8506df`.
**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Owner:** M04. Paths: `src/auth/d1-auth-core.js`, `tests/integration/m04-auth-workerd.spec.mjs`, this M04-owned plan. No M03-owned `src/db/**`, `src/rpc/**`, migrations, Worker bindings, source ERP, public routes, release decisions or real staff data are changed.
**Pending M04 dependency:** PR #502 guards two-pass protected staff freeze; this independent core session test touches different paths.

## Three-run program (production activation is separately gated)

- **Run 1 — core hardening:** Complete the PR #502 review/CI gate; establish negative real-D1 session, credential, role and revocation evidence; close reproducible auth-core gaps in module-owned files. This PR is one isolated Run 1 objective.
- **Run 2 — staff and authority handoff:** Finish private offline USERS/ROLES provenance and freeze validation, source IDs and roles parity, and a versioned M03-reviewed SQL-current authority interface. Do not import live records or implement shared SQL in M04.
- **Run 3 — integration acceptance:** Execute approved private login/restore/logout, unauthorized-action, browser and role coverage, review rollback and staged cutover evidence, and publish GO/NO-GO decision records. Public login, shared posting and remote D1 remain blocked until M02/M03/M04/M10/M11 and owner authorization.

## Run 1 implementation overview (12 sentences)

1. A source-imported staff account with `LegacyPending` credentials must never authenticate using an existing session.
2. The current trusted login path already denies a pending account until one-time legacy verifier conversion.
3. Session validation should independently require the modern credential state in its D1 query.
4. That rule is important even if a malformed import or future internal caller creates an auth_sessions row for a pending identity.
5. Existing schema triggers protect modern-to-legacy downgrades, but verification should fail closed without relying on that separate guarantee.
6. The existing session validator first heartbeats the session row and then reads the current user.
7. Both statements must include the `credential_state='Modern'` predicate.
8. A new test will create a synthetic pending user and deliberately seed a matching session fingerprint using real local Workerd/D1.
9. The RED expectation is that session validation denies and cannot advance the heartbeat.
10. The smallest GREEN implementation adds the same modern-state requirement to both SQL predicates.
11. Existing login, revocation, throttling, role-authority epochs and source response shapes must continue to pass.
12. This internal defense-in-depth fix does not activate a public route, deploy a migration, import protected people or authorize production transactions.

## RED → GREEN acceptance and release gate

- **RED:** `tests/integration/m04-auth-workerd.spec.mjs` adds a synthetic `LegacyPending` forged-session case, expecting `{authenticated:false}` and no heartbeat. The current source should fail the expectation.
- **GREEN:** Amend only `validateSessionWithD1` UPDATE/SELECT authority predicates to require current `auth_users.credential_state='Modern'`.
- **Verification:** M04 local Workerd+D1 CI, affected Node tests and all required full exact-head GitHub checks. Review failure logs, not just the badge count.
- **Merge:** current-head checks green, clean merge state, M04 security/owner review, then exact-main verification. Never treat this as authorization of public login.
- **Rollback:** revert the M04-owned PR; no schema/data rollback required.
