# M04 Run — synthetic Cash Session SQL-time authority proof

**Status:** Local test-only proposal, not a deployable cash/payment writer or M04/M03 readiness approval.
**Workstream/issues:** M04 #23/#252, coordination #456, M03 #22, M08 #66.
**Base:** `main@309daa703824a5d7531756686859d1ec20b5432b`; original pinned Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Owner:** M04; separate branch, no overlap with active #722 (M03), #726 (M02), #727/#728 (M08).
**Exclusive file list:** this plan, existing M04 isolated `tests/integration/m04-atomic-authority-workerd.spec.mjs`, and NEW `tests/fixtures/m04-cash-session-authority-probe.mjs`.
**Protected files untouched:** `src/db/**`, `migrations/**`, `src/rpc/**`, `src/index.js`, Worker/Cloudflare config, Control Center UI, M03 provisioning/auth helpers, shared posting kernel.

## 12-sentence overview

1. M04 already has internal staff session/RBAC and a nondeployable synthetic D1 resource-authority proof.
2. This small independent slice extends local security evidence to current cash writes when Cash Session enforcement is enabled.
3. It is **not** an operational cash, bank, invoice, customer-ledger or purchase transaction implementation.
4. The synthetic SQL operation must derive the actor from the current trusted session inside the same SQL INSERT that writes the test-only receipt.
5. It must deny a missing or closed Cash Session when the tenant's synthetic policy requires an open session.
6. When the synthetic Cash Session feature is explicitly disabled, a request without a Cash Session may proceed only with current staff authorization.
7. Wrong tenant, revoked/expired session, disabled user/role, downgraded grant and stale role-epoch access must fail closed.
8. Every successful operation must append exactly one immutable synthetic cash-book record inside a trigger-bound atomic statement.
9. Duplicate replay from the same current actor and identical intent returns the same result without another receipt or book entry.
10. Changed intent or unauthorized replay must never leak the first actor or committed amount.
11. Injected late failure must roll back both the operation and the synthetic book row in disposable local Workerd/D1.
12. Superpowers RED will first import a nonexistent M04-only helper; GREEN will add the smallest helper and complete exact-head CI plus independent QA/review.

## Acceptance / risks
- Use existing local-only M04 Workerd harness; no GitHub workflow edit or new dependency.
- Do **not** infer operational source Cash Session semantics from this synthetic proof: historic opening amounts are not current cash, and real M03/M08 accounts, Cash Session policy, SQL-time trusted clock, idempotency and original source lineage require separate contract review.
- No production/live D1 schema, private source data, remote action or public RPC.
- If needed source schema/SQL changes extend beyond this test-only fixture, stop and hand off to M03 owner.
- Record RED and GREEN evidence truthfully; require all current-head CI checks and human approval before merge.
