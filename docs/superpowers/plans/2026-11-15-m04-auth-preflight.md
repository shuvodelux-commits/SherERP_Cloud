# M04 Authentication source audit & fail-closed preflight plan

> **For agentic workers:** Use Superpowers executing-plans and verification-before-completion; this plan is **not** authorization to implement public login before the reviewed security/DB contract exists.

**Goal:** Record the original auth/user/role RPC, data and permission behavior and maintain an executable guard preventing accidental unauthenticated exposure during parallel M03 work.

**Architecture:** Read immutable `Auth.gs`, `UserManagement.gs`, `RoleManagement.gs`, `Config.gs`, `UI.gs` and original client, propose a D1 session/auth boundary without editing the DB; assert the current public Worker still replies 501 to protected RPC calls. Separate files from M03 to permit independent work.

**Tech stack:** Node 22+ ESM/Node test; Markdown docs.

**Spec:** `docs/WORKSTREAMS.md` M04 and `docs/MIGRATION_PLAN.md`; `docs/M03_PARALLEL_READINESS.md`; `AGENTS.md`.

## Task 1: Source and security contract

- [x] Map original external RPC names, input types, success/failure payloads.
- [x] Extract original USERS/ROLES/SESSIONS source columns, permission semantics, revocation, admin protection, throttle and session policy.
- [x] Record differences requiring explicit security approval: 'Never' expiry, salted SHA-256 credential upgrade, fail-open cache, atomic lock/last-admin enforcement.
- [x] Document protected data and forbidden Party role conflation.
- [ ] Review document against source before PR.

## Task 2: Auth RPC fail-closed baseline

- [x] Add `tests/m04-auth-preflight.test.mjs` asserting `login`, `logout`, `validateSession`, users/roles CRUD and internal first-admin remain unavailable before M04.
- [x] Check no user secret echo or accidental Settings exposure.
- [x] Run isolated tests and observe 4/4 passing; this preserves existing behavior rather than adding a new public feature.

## Task 3: Verification and review

- [ ] Run full `npm test`, `npm run verify:source`, `npm run build:frontend`, and `git diff --check`.
- [ ] Ensure only M04 docs/tests, no auth schema, runtime or preview configuration changes.
- [ ] Create small PR to main; wait for required CI.
- [ ] Keep M04 **not implemented** until reviewed D1 login/security design and actual real Worker/D1 tests pass.
