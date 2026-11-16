# Superpowers TDD — M03/M04 actor-bound atomic Product master creation (Issue #252)

**Date:** 2026-11-15. **Source:** pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (`ProductSettings.gs`, `Auth.gs`). **Depends on:** merged #248 (synthetic local D1 atomic PCAT/PUNT), merged #250 (exact-write policy). **Owners:** shared M03 SQL owner and M04 session/RBAC reviewer.

## Contract and bounded change

1. Preserve the original PCAT/PUNT source-ID, duplicate handling, inactive cleanup/compaction and idempotent rollback from #248; do not expose any Worker RPC.
2. Add a separate local-only authorized execution path with a **single SQLite INSERT...SELECT** that derives `actor_id` from `auth_sessions JOIN auth_users LEFT JOIN auth_roles` and repeats **current** `products.add` checks as part of that same statement that fires the catalog/ID/receipt triggers. Preflight may protect read/duplicate information but never grant a write.
3. Hash the valid 32-byte opaque token as raw decoded bytes (M04 `tokenFingerprint`), and obtain time from a **trusted server function**, not browser arguments. Require nonrevoked session, valid absolute and 30-minute idle windows, current user/credential epochs, `Modern` active user and either Administrator + null role epoch or active custom role with equal epoch and literal JSON boolean `products.add=true`.
4. In **isolated test-only schema**, add actor identity to the immutable synthetic operation record. No numbered D1 migration, no remote apply and no modification to legacy GAS/Sheets.
5. On every retry/readback, revalidate present M04 D1 authority and require the same actor and matching intent. Never return another actor's receipt. Fail closed for zero-row INSERT/CAS, expired/revoked bearer and malformed JSON permission.
6. Keep existing #248 local-only unauthenticated proof unchanged and separate from the actor-gated local proof. Nothing in this PR authorizes production staff operations or full parallel module activation.

## RED → GREEN steps

- [ ] **RED 1:** add source/SQL contract Node tests and a dedicated **real local Workerd/D1** integration suite before implementing the module. Confirm GitHub CI fails for the expected missing target or unmet deny/write behavior; do not call infrastructure errors a valid RED.
- [ ] **GREEN 1:** add smallest internal module and additive test-only schema overlay. Claim through one parameterized `INSERT...SELECT`; never a JS authorization-then-unconditional INSERT.
- [ ] **GREEN 2:** real D1 test Administrator and literal-true nonadmin success, false/string/missing/malformed permission, disabled users/roles, session expiration/idle/revocation, password and role epoch invalidation, cross-actor operationId collision, concurrent retries, lost reply, late rollback and preserved high-water source ID.
- [ ] Verify exact-head Foundation/84 source manifest/36 HTML includes, dedicated local Workerd/D1, existing aggregate M03/M04, M02 Party D1, M01 Chromium, Cloudflare no-secret PR policy and latest-main merge conflicts.
- [ ] Open scoped draft PR with exact RED/GREEN workflow links and owner review gate; no auto-merge or public RPC.

**Impact and rollback:** Test-only fixture schema/worker + isolated tests and internal module only; read/revert code to roll back. No new source authority, no D1 production/backfill, no Cash/Bank/Party/Stock posting, no UI change. `PARALLEL-MODULE-READY=false` until all prerequisites are satisfied.
