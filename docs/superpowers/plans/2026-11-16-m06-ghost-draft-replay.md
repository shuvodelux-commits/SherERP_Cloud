# Superpowers TDD plan — M06 consumed-draft replay proof

1. Inspect current AGENTS.md, M06 source-pinned design, synthetic posting schema and prior merged PR #287.
2. Use a new GitHub branch from latest main. Keep shared schema, production RPC and source code untouched.
3. RED: add one real local Workerd/D1 integration test that posts and consumes a draft, reconstructs a draft with the same tenant/ID, and demands `NEEDS_REVIEW` on exact-operation replay without mutation. Commit test before production change; verify it fails for observed `REPLAY`, not setup failure.
4. GREEN: extend existing read-only `verifyReplayReceipt` with a tenant/draft-scoped absence query inside the same D1 snapshot batch, expected empty for posted drafts. Keep existing seven evidence checks and all posting logic untouched.
5. Verify the new test and entire GitHub CI including M03/M06 Workerd/D1, M07 shared fixture resets and browser checks. Record precise GREEN evidence or blockers in the PR.
6. Leave reviewable PR open. Production M06 gates (multi-line FIFO, real auth, real Workers+D1 cutover, reconciled accounting and M10/M11 approvals) remain blocked.
