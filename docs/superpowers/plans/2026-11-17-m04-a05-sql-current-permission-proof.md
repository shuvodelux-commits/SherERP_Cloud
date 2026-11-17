# Superpowers — M04 A05 SQL-current duplicate-key authorization proof (2026-11-17)

**Owner:** M04 #23/#252, handoff to M03 #22; board #456.  
**Base:** `main@e387a5c483ffd7a180616c0a80b09eb7ac4ffe00`; **frozen original:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.  
**File ownership:** `tests/integration/m04-legacy-rpc-workerd.spec.mjs`, `tests/fixtures/m04-sql-current-role-permission-proof.mjs`, and this M04 plan only. No `src/db/**`, `src/rpc/**`, `src/index.js`, `migrations/**`, Worker binding, shared M03 SQL, public auth, source data, or production/staging D1.

## Implementation overview (12 sentences)

1. M04 #536 prevents duplicate-key ROLES JSON from yielding a source-shaped login profile.
2. M03's current synthetic G1 SQL claim uses `json_valid` and `json_type` but not a duplicate-key check.
3. SQLite JSON1 may return a first duplicated module/action key while JavaScript `JSON.parse` retains the last occurrence.
4. This creates an authority mismatch if a protected posting checks only JSON1's first occurrence.
5. The next M04 task is an isolated proof of the missing predicate, not implementation of M03's transaction writer.
6. The RED test will execute against a real local Workerd/D1 instance, not a mocked SQL interpreter.
7. It will demonstrate that malformed, non-object, false, string-boolean and duplicate permission keys cannot qualify for `sales.add` or `products.add`.
8. It will include nested duplicates and Unicode-escaped-equivalent duplicate property names.
9. A canonical frozen-source role JSON with the literal boolean grant must continue to qualify.
10. The GREEN implementation will be a single test-only SQL predicate fixture with bound data and a strict fixed action allowlist.
11. The SQL predicate will use `json_tree` to detect duplicated decoded keys scoped to the same JSON parent, not a lossy `json()` normalization.
12. M03 must separately review and enforce a production-equivalent rule **inside** any atomic SQL mutation, alongside trusted actor, time, tenant, receipt and journal safeguards, before AUTH-G1 approval.

## Test-first execution

1. **RED:** append one M04 real Workerd/D1 test to the existing mandated M04 CI suite. Import the not-yet-present test fixture dynamically and prove one expected failure on the branch's exact test-only SHA. Do not call the old JavaScript preflight or claim that login parser checks protect SQL writes.
2. **GREEN:** add only `tests/fixtures/m04-sql-current-role-permission-proof.mjs`. Its internal `inspectSyntheticRoleGrantWithD1(db,{permissionsJson,operation})` must use a static two-operation mapping (`sales.add`, `products.add`), parameterized JSON and field paths, bounded length and SQL `CASE` to short circuit malformed text. It returns a boolean for *role-text inspection only*, not transaction authorization.
3. Run full GitHub Actions (44 workflows at plan time) with real local Workerd/D1 auth and shared integrations. Require all current-head checks before merging; no disabled or omitted tests.
4. Send M03 #22 the verified result and an explicit implementation request, without editing its exclusively owned G1 SQL or declaring an approved writer contract.

## Constraints and rollback

The future production SQL check must bind a server-approved action, use current session/user/role/credential/tenant identity inside the same mutation, use trusted time, reject duplicated property keys, then apply source-shaped stock/ledger/Cash Session/receipt CAS. This test-only predicate by itself grants **no** authenticated business action. This PR does not alter M04 original login results or upgrade/import logic; it cannot authorize private data access or a staging deployment. Rollback is reverting these two M04 test/fixture files and this plan. Keep PUBLIC AUTH DISABLED, PARALLEL TRANSACTION WRITES BLOCKED and PRODUCTION NO-GO until the reviewed release gate is satisfied.
