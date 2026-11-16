# M04 — Recheck session-idle bound at core D1 user read (2026-11-16)

**Contract:** `AGENTS.md`, `docs/M04_AUTH_SOURCE_CONTRACT.md`, frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (`Auth.gs`), and existing M04 `AUTH_POLICY.sessionIdleMs`. Internal only, no Worker deployment. **Branch:** `m04/core-session-second-read-idle-20261116`.

## Implementation overview (13 sentences)

1. M04's internal D1 session validator is responsible for current actor identity rather than trusting browser claims.
2. It first performs a conditional SQL heartbeat that checks the bearer digest, active account and role authority, revocation, absolute expiry and thirty-minute inactivity.
3. A second separate SELECT retrieves only the sanitized actor's name, ID and role.
4. That SELECT already rechecks account and role authority versions, revocation and absolute expiry.
5. The second SELECT does not recheck last activity or whether the session was created before the trusted clock.
6. A concurrent D1 write between the conditional heartbeat and actor SELECT can leave a stale activity time without changing those other fields.
7. Such a session can still yield an authenticated actor from the second read despite being outside the inactivity limit.
8. We will reproduce this interleaving against a real disposable local Workerd/D1 database with a synthetic authenticated bearer.
9. The test will first create a valid session and demonstrate a valid intermediate heartbeat.
10. A test-only D1 adapter will then rewind the stored last activity before the actor SELECT at the later trusted clock.
11. Before the production change, the test must fail because the core wrongly returns an authenticated actor.
12. The smallest implementation will add an idle-time lower bound, current-time upper bound and creation-time bound to that second SELECT using the existing constant.
13. The fix must leave public RPC disabled, preserve successful fresh session lookups, pass the real-D1 and full repo CI suites, and not access remote business records.

## File / RPC / table inventory

- **Production:** `src/auth/d1-auth-core.js` — `validateSessionWithD1` second SELECT only. No new configuration or policy.
- **RED regression:** `tests/integration/m04-auth-workerd.spec.mjs` — real local D1, synthetic actor, controlled interleaving through a test-only DB adapter.
- **Plan:** this Markdown file.
- **D1:** `auth_sessions.last_activity_at_ms` for the one synthetic test session; `auth_users` and `auth_roles` authority reads; no migrations.
- **RPC:** internal core API only. No public route or changes to `src/index.js`, `src/rpc/registry.js`, Wrangler or Cloudflare bindings.
- **Risk:** two-stage session read cannot substitute for truly atomic future financial-write authorization; this remains a read-time defense-in-depth guard, not a write grant.
- **RED acceptance:** one expected regression failure on authenticated stale actor response.
- **GREEN acceptance:** fresh session accepted, injected idle-expired session denied, no unrelated tests regressed.

## Execution checklist
- [ ] Commit the test alone; observe expected failure in GitHub real-D1 M04 CI.
- [ ] Commit minimal parameterized SQL predicate; observe GREEN M04.
- [ ] Run exact-head full GitHub Actions checks; rebase or merge latest main after verifying changed-file overlap.
- [ ] Document evidence in draft PR and hand off for owner review; do not merge automatically.
