# M06 inactive-account replay — Superpowers TDD implementation plan

> **For agentic workers:** Use Superpowers TDD and execute on a dedicated GitHub branch; watch RED before changing code. No deploy or automatic merge.

**Goal:** Return the exact immutable receipt for a legitimately posted Bank/Mobile sale after its payment account is deactivated, without weakening new-sale SQL safeguards.

**Architecture:** Read a prior sale operation by the existing `SQL_LOOKUP` with tenant+operation ID. Only when actor matches, allow existing now-inactive account rows into the pure payment normalization step; continue to compare canonical payload hash and verify exact persisted child records. New operations continue to use active-only normalizer behavior and SQL always enforces active bank account at commit.

**Tech stack:** ESM Node, GitHub Actions, isolated Cloudflare Workerd/D1 synthetic fixture.

**Spec:** `docs/superpowers/specs/2026-11-16-m06-inactive-account-replay.md`

## Global constraints
- Source/frozen legacy files, live production D1, `src/`, authentication/RPC and frontend are out of scope.
- No untrusted actor selection in production. `actorId` is synthetic trusted test context only.
- Keep original operation ID, tenant, actor and intent-hash conflict policy. Do not weaken M06 SQL CAS/stock/bank/session guards.
- No silent Party account netting. No test claims without exact-head CI evidence.

## Review focus
- Wrong actor or changed payload on existing operation: must never replay.
- Fresh operation using a now-inactive account: must never post.
- Original posted Bank/Mobile and Cash/Customer child receipt: must remain exactly unchanged after retries.
- Missing or extra posted child: must remain `NEEDS_REVIEW`, even if historical bank account is inactive.
- Concurrent new sale and account deactivation: SQL active guard still controls final commit.

### Task 1 — Replay after account deactivation

**Files:**
- Modify: `tests/integration/m06-sale-posting-workerd.spec.mjs`
- Modify: `tests/fixtures/m06-sale-posting-contract.mjs`

**Interfaces:**
- Consumes: `createSyntheticD1SalePostingContract(DB).post(input)`, existing `SQL_LOOKUP`, `normalizeSalePayments_`, `verifyReplayReceipt`.
- Produces: unchanged `post(input)` result shapes (`COMMITTED`, `DECLINED`, `CONFLICT`, `REPLAY`), no new public API.

- [ ] **Step 1 — RED test:** Create original Cash+Bank and Mobile Banking sales; deactivate bank accounts. Assert stable-operation replay returns `REPLAY` + original invoice and no changed rows; assert tampered intent/actor `CONFLICT`, fresh inactive tender rejects. Use existing `snapshot()`.
- [ ] **Step 2 — Verify RED:** Commit test only, wait for GitHub M03 real local Workerd/D1 run. Expected: exactly the new historical replay behavior fails with `Choose an active payment account` while baseline tests pass; report unrelated failures if any.
- [ ] **Step 3 — GREEN:** Adjust `post()` to read prior operation on tenant+operation ID, and treat currently inactive accounts as eligible only when the original actor matches. Preserve SQL bank active guard, canonical hash and immutable receipt verifier, and reject on different actor/payload.
- [ ] **Step 4 — Verify GREEN:** Commit minimal test-only fixture change and run exact-head GitHub checks. Expect RED regression now passing, fresh inactive post still refused, full local Workerd D1/other checks green.
- [ ] **Step 5 — Review:** Record RED/ GREEN job links and per-file inventory in a draft PR. Do not merge or claim production posting enabled.
