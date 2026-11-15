# M04 D1 Session Authority Versions — implementation plan
> Superpowers: TDD RED→GREEN and verification-before-completion.

**Goal:** Complete internal D1 session invalidation semantics so old tokens cannot regain authorization across staff/role/password changes.

**Workstream:** M04 auth; stacked atop still-open #55; no shared M03 migrations or deployed RPC.

1. Create design and plan here; run untouched baseline tests on isolated stacked worktree.
2. Add test-only SQLite `auth_version` tests, role/status/password bump tests; run RED.
3. Extend real Workerd integration tests with fabricated additional users/role and confirm old tokens stop working after disable+re-enable, role permissions edit, credential reset, and no false revocation of unrelated administrator; run RED.
4. Update only proposed local SQL fixture with nonrecursive update triggers + immutable issuance snapshots; enforce version match during login insert and every session validation touch/read; fail closed on version mismatch. Never trust client role or version.
5. Run focused GREEN and full npm/source/frontend/local Workerd D1 checks; inspect changed file ownership and sensitive data.
6. Commit and push a new branch; open **draft PR targeting #55 branch**, not main, documenting dependency. No public login activation; no production D1 schema migration; no repository CI workflow changes.
