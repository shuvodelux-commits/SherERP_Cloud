# M04 — Recheck idle timeout at source-profile D1 read (2026-11-16)

> **For agentic workers:** Use Superpowers RED → GREEN TDD, verification-before-completion, and owner-reviewed GitHub PR. Do not activate public auth.

**Goal:** Refuse an internal legacy session profile when its persisted activity has crossed the 30-minute idle limit between the core session validation and profile read.

**Source/contract:** Frozen Mohim_ERP `Auth.gs` and project `AGENTS.md`, `docs/M04_AUTH_SOURCE_CONTRACT.md`; existing M04 `AUTH_POLICY.sessionIdleMs`. This is an internal-only consistency hardening, not a change to legacy `Never` session policy.

## Scoped implementation overview (13 sentences)

1. The original login interface retains `login`, `validateSession` and `logout` response shapes.
2. The internal M04 D1 core enforces a finite twelve-hour lifetime and thirty-minute idle limit at session validation.
3. The internal legacy bridge validates a session before reading a sanitized profile from D1.
4. The profile SELECT independently rechecks revocation, absolute expiry, active user and role authority versions.
5. It currently checks that last activity is no later than trusted now, without enforcing the idle lower bound.
6. A concurrent D1 activity change between validation and profile SELECT could cause the profile read to accept an idle-expired session.
7. We will reproduce that exact interleaving using an isolated real Workerd/D1 test and a trusted test-only D1 adapter.
8. The test inserts a synthetic authorized user and obtains a genuine D1 bearer through the internal bridge.
9. It establishes a valid intermediate heartbeat, then rewinds that one synthetic session's activity immediately before the profile SELECT.
10. The expected result is the existing generic session-expired envelope with no profile disclosure.
11. The minimal fix adds a parameterized idle lower bound to the profile SELECT using the existing `AUTH_POLICY.sessionIdleMs`, without changing core sessions or migrations.
12. We will verify that valid fresh profile reads remain permitted and that all affected real D1 and source contract checks pass.
13. Public Worker routing, RPC registry, Cloudflare preview, live credential import, remote D1 and financial data remain untouched.

## File / RPC / table impact

- **Plan** this file.
- **RED test** `tests/integration/m04-legacy-rpc-workerd.spec.mjs` (isolated local D1; creates synthetic staff and session; injects D1 activity drift between the two SELECT boundaries).
- **GREEN source** `src/auth/d1-legacy-rpc.js` (profile SELECT only; server-owned parameter `nowMs - AUTH_POLICY.sessionIdleMs`).
- **RPC:** internal `validateSession` profile response; public RPC still disabled.
- **D1:** `auth_sessions` activity field, `auth_users` and `auth_roles` reads; no migration or remote writes.
- **Acceptance:** observed RED is session accepted after stale activity; GREEN rejects stale activity but preserves valid session and existing envelopes.

## Test-first execution

- [x] Read latest merged M04 source and detect the missing profile idle predicate.
- [x] Branch from current main (isolated ownership).
- [ ] Commit the real-D1 regression before production code.
- [ ] Observe expected RED in GitHub M04 CI and record exact run/job.
- [ ] Commit the smallest parameterized SQL predicate fix.
- [ ] Confirm exact-head M04 and repository CI green.
- [ ] Open/review draft PR with risks, table/RPC inventory and rollback; never auto-merge.
