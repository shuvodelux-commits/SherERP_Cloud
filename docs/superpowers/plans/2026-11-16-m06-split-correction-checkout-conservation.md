# Superpowers TDD — M06 Split correction original checkout conservation

**Objective:** Never propose a replacement split-payment revision when the imported original sale header is internally unreconciled.

**References:** `docs/superpowers/specs/2026-11-16-m06-split-correction-checkout-conservation.md`; pinned `SalePayments.gs`, `src/modules/sale-payment-correction-plan.js`, `tests/m06-split-payment-correction-plan.test.mjs`, `AGENTS.md` and `docs/WORKSTREAMS.md`.

**Files to change:**
- `tests/m06-split-payment-correction-plan.test.mjs` (RED test first).
- `src/modules/sale-payment-correction-plan.js` (minimal GREEN read-only guard).
- The plan/spec documents only.

### Task 1 — Regression test (RED)
1. Reuse the actual test fixture of INV-001 with Grand=100, Paid=70, Due=30 and proper Cash/Bank children/book entries; create a new source-shaped fixture with Due=30.01 and currentSettlement.dueAmount=30.01.
2. Assert `planSaleSplitPaymentCorrection` throws `NEEDS_REVIEW: original split-payment checkout totals mismatch` and does not mutate any snapshots, even though all other checks would pass.
3. Assert that an unchanged valid case still projects exactly the frozen-source payment allocation and deltas; never conflate a later settlement with historical checkout.
4. Commit the test-only change and inspect actual GitHub RED logs for **missing expected exception**, not a parser/fixture failure.

### Task 2 — Minimal implementation (GREEN)
5. Parse original Grand via existing `salePaymentPaisa_` and compare it with safe integer sum of saved Paid and Due before checking later settlement or projecting account deltas.
6. Throw one deterministic `NEEDS_REVIEW` error on corrupted original header. Preserve valid output and all other existing guards.
7. Commit GREEN; run exact-head Foundation, full Node, local Workerd/D1, Cloudflare PR safety and Chromium smoke checks, and investigate all actual failures rather than declaring partial GREEN.

### Review/rollback
The changed function is a read-only intent preview and never authorizes or writes an edit. No new bank/Party/cash-session permissions, posting side effects, production data edits or live Cloudflare deployment. Revert the scoped PR if a documented valid original source form contradicts the conservation invariant, but never auto-correct historical invoices. Leave draft/unmerged until exact-head CI and owner review.
