# M04 Staff Mutation Safety Guard — Implementation Plan

> **Superpowers:** Use test-driven-development (RED before implementation), executing-plans and verification-before-completion.

**Goal:** Source-shaped internal guard against unsafe staff-account mutations, especially losing the last active Administrator. This is a pure decision primitive, **not** an RPC handler or atomic DB enforcement.

**Architecture:** `src/auth/staff-mutation-guard.js` exports `evaluateStaffMutationGuard(context)` accepting trusted server-derived actor and target records, a confirmed active-administrator count, and one proposed operation. Returns fixed-code allow/deny without altering/returning data or granting permissions.

**Tech:** Node 22+ ESM, `node:test`, preserved `UserManagement.gs` source snapshot.

**Spec:** `docs/superpowers/specs/2026-11-15-m04-staff-mutation-guard-design.md`

## Task 1 — Fail-closed pure guard
- [ ] Create tests with synthetic identity strings for 1 vs 2 admins: no last-admin deletion/demotion/deactivation; no own-account deletion even with 2 admins; eligible operations with independent management RBAC still required.
- [ ] Test non-admin Administrator assignment/password reset denial, Active actor requirement, malformed/inherited/accessor inputs, invalid counts, no sensitive output, no public RPC registration.
- [ ] Assert source contract via immutable `legacy/source/UserManagement.gs` substrings.
- [ ] Run focused `node --test tests/m04-staff-mutation-guard.test.mjs` and observe missing module (RED).
- [ ] Implement minimal pure ESM code, no imports from pending PRs; run focused GREEN; verify full `npm test`, `npm run verify:source`, `npm run build:frontend`, M03 source inventory and syntax checks.
- [ ] Commit exactly 4 new files from an isolated fresh-main worktree, push and create draft PR with test counts and explicit real D1 CAS security blockers.

## Release constraints
- Never wire into live account endpoints without persistent D1 auth and atomic count/mutation enforcement.
- Do not change shared `src/db`, migrations, `src/index.js`, RPC, original frontend, Party financial account code, or other M04 PR-owned source.
- Login/session/role enforcement and last-admin concurrency remain M04 release blockers.
