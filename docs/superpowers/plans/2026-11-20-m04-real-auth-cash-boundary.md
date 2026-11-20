# M04 Run 2 — real-auth-table Cash Session SQL authority probe

**Lane:** M04 #23/#252. **Coordination:** M03 #22, M08 #66, M11 #306, board #456.
**Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Base:** `main@13425a5bef54418e2a09b3a942ca3c60ce9ccff4` after verified merged M04 #729.
**Other open PRs at start:** M01 #734, M05 #731, M08 #732. No overlapping files.
**File owner:** M04. Exclusive proposed files: this plan; existing `tests/integration/m04-auth-workerd.spec.mjs`; NEW `tests/fixtures/m04-real-auth-cash-probe.mjs`.
**No other paths:** In particular, no changes to `src/db/**`, `migrations/**`, `src/rpc/**`, public/private Worker, `src/index.js`, Cloudflare configuration, `.github/workflows/**`, control-center UI, financial writer or source data. The existing M04 auth Workerd PR-only workflow already runs this test file.

## Twelve-sentence implementation overview

1. The merged #729 established only a synthetic D1 Cash Session authorization model.
2. Existing M04 auth tests already provide the actual internal D1 session, credential, user and role schema with versioned authority.
3. This follow-up exercises a **test-only Cash Session operation** against those exact internal M04 auth tables.
4. The caller may pass only a bearer and immutable operation intent; it cannot nominate actor, business or server time.
5. The test-only gate must compute the bearer fingerprint from decoded 32-byte token bytes and receive the trusted clock from server-owned fixture wiring.
6. The same SQLite insert that records the synthetic intent must check the live session, expiration, idle limit, credential epoch, user/role epoch, active identity and proposed test-only cash grant.
7. The Cash Session policy is ON by default and requires an Open synthetic session, while explicit OFF still requires current staff authorization.
8. The actor is stamped from the SQL-authenticated user and never copied from request data or Party role identity.
9. Replaying the same immutable operation by the same current actor returns one result without adding synthetic cash-book rows.
10. Different-actor replay, changed amount, revoked/expired/idle sessions, role revocation, credential rotation and invalid input must deny without exposing private records.
11. A triggered late SQL failure must roll back the synthetic operation and its append-only test journal atomically.
12. The PR stays nondeployable until actual RED, GREEN, real local Workerd/D1, full CI and independent M04/M03/M11 review are documented and owner authorizes a merge.

## Safety / test protocol

Superpowers TDD: first commit a RED regression importing a missing M04-only fixture, verify its failure in GitHub's existing PR-only `M04 authentication real Workerd D1` workflow, then add only the fixture, verify GREEN and run exact-head full CI. RED from a missing fixture is an expected test-first dependency failure, **not** an existing production security flaw. Do not claim RED observed unless the test job actually executes.

The proof uses one-business-per-D1 local isolation; it does **not** prove a multi-tenant production database, the actual source Cash Session operation, source-specific cashier permissions or deployed posting. M03 alone owns shared SQL/posting/auth transport integration, M08 approves business accounting policies, M02 source identities and M10/M11 deployment. Client-supplied clock must never reach an operational writer. No remote private DB, real staff import, public RPC, Cloudflare bindings, financial posting or original UI change.
