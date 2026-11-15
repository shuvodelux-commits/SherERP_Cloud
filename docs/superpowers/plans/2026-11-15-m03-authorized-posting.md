# M03 Authorized Atomic Posting — Implementation Steps

**Goal:** Make D1's receipt claim and stock/journal effect indivisible **and** contingent on current session grant inside the same SQL statement, in synthetic local tests only.
**Spec:** `docs/superpowers/specs/2026-11-15-m03-authorized-posting-design.md`

1. Baseline current `main`, read `AGENTS.md` and existing M03/M04 local D1 contracts. Create isolated branch; do not modify production schema/auth.
2. Author `tests/fixtures/m03-authorized-post-schema.mjs` with disposable roles/users/sessions/stock/receipts/movements, SQL trigger for atomic stock+journal and version invalidation. Include unique tenant/operation constraints and immutable receipt/movement.
3. RED Node tests in `tests/m03-authorized-post.test.mjs` for exact replay, duplicate conflicting operation, revoked/expired/changed authority, actor/scope isolation, stock refusal, journal rollback and concurrency. Implement `tests/fixtures/m03-authorized-post-contract.mjs`, GREEN.
4. RED real Workerd tests against stub route, then implement test-only worker `tests/fixtures/m03-authorized-post-worker.mjs`, fake-UUID `wrangler.m03-authorized-post-test.jsonc`, Workerd tests, GREEN. Use hardcoded fixed synthetic routes, ignore user HTTP body.
5. Add one import to `tests/integration/m03-workerd.spec.mjs` and `docs/M03_AUTHORIZED_ATOMIC_POSTING.md`. Run `npm test`, full Workerd/D1, 84-file source checksum, frontend build, M03 caller and static async audit, diff and syntax checks.
6. Rebase if main advances, retain concurrent imports, rerun tests. Push and open PR for review, do not merge, no remote D1 migrations or deployments. `PARALLEL-MODULE-READY=false`.
