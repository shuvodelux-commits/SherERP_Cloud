# M04 — Persistent session authority versions in internal D1 login core
**Date:** 2026-11-15
**Base:** Unmerged PR #55 `m04/d1-auth-core-20261115`; this is a **stacked change**, not an independent release.
**Source:** `legacy/source/Auth.gs` authority/session invalidation and merged PR #57 `docs/M04_ATOMIC_AUTHORITY_BOUNDARY.md` synthetic D1 authority-version evidence.

## Problem
PR #55 checks current active account/role at session validation, but a session created before a password reset, status toggle, role assignment, or permission revision may regain access if its owner/role is later re-enabled. In the original GAS system, account/role change bumps `AUTH_CACHE_GEN`, revocation takes effect on subsequent requests. An old session must not regain privileged access merely because a role becomes active again.

## Chosen design
Add database-owned monotonic `auth_version` to staff users and custom roles; add immutable `user_auth_version`, `role_auth_version` (NULL only for Administrator) and `credential_version` snapshots to each new `auth_sessions` row. SQL AFTER UPDATE triggers bump auth version on actual user role/status/credential change and custom role status/permission change. Checks at both token issuing `INSERT...SELECT` and session-touch `UPDATE...EXISTS` require exact current versions. Unrelated role or user changes must not revoke a session. Changing role permission JSON invalidates active role sessions. Built-in Administrator uses only user/credential snapshots. Any password hash/salt/algorithm/iteration change invalidates old sessions even if application code forgets to increment `credential_version`.

TDD RED: session valid after disable/re-enable, role disable/re-enable, role permissions change, and password hash update; stale login after role permissions change. GREEN: schema constraints/triggers and D1 SQL version predicates.

## Boundaries
- **No public login/RPC or staging/production binding.** All SQL stays in PR #55's **test-only** fixture path `tests/fixtures/m04-auth-migrations/0001_auth_core.sql`, never `migrations/` until M03 owner review.
- No real credentials, no legacy source edits, no D1 production writes, no token echo, no Party identity link.
- This is only login/session authority; business-operation permissions still must be checked *inside each D1 write*. Merged PR #57 establishes synthetic workerd test pattern, not a user-facing authorization gateway.
- Do not change main's `src/index.js` or `src/rpc/registry.js` (public login remains HTTP 503).
- Independent M04 security review is required before #55 or this stacked PR is merged. Additive schema is part of the not-yet-approved future M03 migration proposal.

## Verification
Five new or expanded real Workerd/D1 tests, SQLite trigger contract tests, no old test regressions; `npm test`, `npm run verify:source`, `npm run build:frontend`, `node scripts/audit-m03-callers.mjs --check`, local real Workerd/D1, diff check, draft stacked PR. PR base must remain `m04/d1-auth-core-20261115` until merged into main; no workflow-file edits (GitHub credential lacks workflow scope).
