# M05 Source Purchase Permission vs M03 Local SQL Proof — RED Handoff Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Follow Superpowers TDD. This is a cross-owner RED handoff; **M03 alone must make the underlying SQL permission change**. Do not falsely green the acceptance test in M05 or merge failing CI.

**Goal:** Prove that the current M03 first-purchase local Workerd/D1 fixture checks `pos.add` where the frozen original Purchase.gs requires `purchase:add`, then hand exact failing evidence to M03 for a separate source-faithful fix.

**Architecture:** Add one NEW M05-owned Workerd/D1 acceptance test that uses the existing exported M03 local test fixture unmodified. Seed two distinct custom staff roles in the real local M04 D1 auth schema: POS-only and Purchase-only. Assert that POS-only is refused for source createPurchase and Purchase-only is authorized, with no stock/ledger writes from unauthorized attempts. Keep this PR DRAFT and RED until M03 integration owner approves and fixes the shared synthetic SQL fixture in its own branch.

**Tech Stack:** Node.js native node:test, Wrangler local Workerd/D1, existing M03 first-purchase fixture and M04 auth migrations.

**Spec:** `legacy/source/Purchase.gs` line 110: `requirePermission_(token, 'purchase', 'add')`, then `requireActiveCashSession_()`. `tests/fixtures/m03-first-purchase-atomic-local.mjs` currently checks `$.pos.add` in CURRENT_AUTH and SQL header INSERT. M03 #22, M05 #314, coordination #456; M03 PR #758 merged. Read `docs/m05/INTEGRATION_HANDOFF.md`, `docs/M03_G1_INTEGRATION_HANDOFF.md`.

## Twelve-sentence implementation overview

1. The original Purchase.gs createPurchase requires staff permission group `purchase`, action `add`.
2. Its next action is a Cash Session precondition that also applies to bank and zero-paid purchases.
3. M03 merged #758 added an isolated local Workerd/D1 synthetic first purchase proof.
4. That fixture currently checks a POS permission key rather than the source purchase permission key.
5. A Cashier with permission only to create POS sales must not be authorized to create a purchase.
6. Conversely, a user granted purchase creation but not POS sales must not be denied on that basis.
7. This task probes both directions through the real M04 local session/role schema and SQL insert path.
8. It reuses M03's current synthetic D1 harness without modifying any M03-owned file.
9. An unauthorized purchase must leave the Purchase, lot, Supplier Ledger, Cash/Bank and stock snapshots unchanged.
10. The regression should initially fail for the wrong permission semantics, proving the original gap.
11. M03 alone must implement a source-faithful SQL-time fix and rerun concurrency, replay and rollback tests.
12. The present M05 deliverable is an isolated RED review handoff, not a new production writer or approval to deploy.

## Files and ownership

- **Create only:** `tests/integration/m05-source-purchase-permission-sql-parity.spec.mjs`, this plan.
- **DO NOT edit:** `tests/fixtures/m03-first-purchase-atomic-local.mjs`, shared M03 auth migrations/DDL, `src/db/**`, `src/rpc/**`, original source, `src/index.js`, `src/auth/**`, other workstreams, production D1, Worker configs.
- Base `main@e23c80a17d34bd9d1633ee28ba019ae0819f0911`. Branch `m05/source-purchase-authz-gap-repro-20261120`.
- Frozen source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; supplementary multi-unit unchanged.

## RED acceptance and independent review

- [ ] Write a two-case local Workerd/D1 test with distinct `POS_ONLY` and `PURCHASE_ONLY` active auth roles; use genuine `submitLocalFirstPurchase` into test-only local SQL.
- [ ] Prove frozen source literal purchase:add is present (but do not rely only on source-text matching; exercise the live SQL path).
- [ ] Expected `POS_ONLY` purchase: **deny + exact before/after snapshot identical**.
- [ ] Expected `PURCHASE_ONLY` purchase: **insert one 34-paisa obligation + stock +1, with no Cash/Bank payment**; Cash Session Open required. The synthetic auth fixture may temporarily use `pos.add` so this should fail.
- [ ] Run exact-head GitHub workflow to observe expected RED; distinguish new failing acceptance tests from unrelated failures.
- [ ] Post actionable M03 #22 and coordination #456 blocker with source line, SQL probe, exact two role JSON values, result and next owner.
- [ ] **Never modify M03 source to make a cross-owner test pass.** RED-only PR stays DRAFT; it is NOT safe to merge into main or to enable a purchase RPC.
- [ ] M03 follow-up should change the SQL-time grant to source `purchase.add`, verify user-supplied actor never overrides session, run genuine local D1 RED→GREEN and full CI, request independent review. Then M05 can rerun these tests from a refreshed branch.

## Review focus

1. POS-only role inadvertently authorizes purchase.
2. Purchase-only role is rejected despite the original source grant.
3. Source Cash Session policy remains Open for all payment methods and zero payment.
4. SQL denial leaves no purchase, original lot, Supplier or payment side effect.
5. No public or remote D1 permission change may be inferred from this synthetic local fixture.
