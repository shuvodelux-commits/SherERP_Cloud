# M06 Reviewed Split Sale Update Intent — Superpowers TDD plan

> Follow superpowers:test-driven-development, writing-plans and verification-before-completion. This is **preflight-only**; never turn into a posting API.

**Goal:** Combine existing M06 source-proven Update Mode, tender integrity and proposed split checkout into one fail-closed read-only intent.

**Architecture:** No new payment calculation. Compose:
- `projectSaleForUpdate` — original unique invoice, open historical Cash Session, return and Bundle gate.
- Original exported `salePaymentPaisa_`, `assertSalePaymentBookEvidence_`, `salePaymentNextRevision_`, `salePaymentAccountDeltas_`.
- `planSplitSaleUpdatePreview` — native source line-total and tender allocation.

**Tech Stack:** ESM JavaScript, Node `node:test`, source-pinned test-only VM oracle, GitHub Actions.

**Scope:** New docs, one new `tests/m06-reviewed-split-update-intent.test.mjs`, one new `src/modules/reviewed-split-sale-update-intent.js`. Do not touch shared M03/M04/M05/M07/M08 files, original source/UI, schema, RPC or Cloudflare setup.

### Task 1 — Baseline and RED tests
- [ ] Read current target AGENTS, M03 readiness, original GAS and existing M06 modules; freeze expected source contract.
- [ ] Build fixture from original real source-shaped Sales, SALE_ITEMS, SALE_PAYMENTS, Cash Session, CASH_BOOK, BANK_BOOK and trusted M08 current settlement.
- [ ] Independent source reference = `createNativeSaleUpdateOracle`, `createNativeSplitUpdateOracle`, `createNativeSalePaymentOracle` (all pinned GAS VM sources), without importing target new module.
- [ ] Cover source exact output, no mutations, account deltas/old revision, Cash change not income, delayed settlement, returned/deleted/duplicate header, changed/closed original Session, book mismatch, payment corruption, missing/unsafe versions, malformed inputs.
- [ ] Commit the test before production code; open draft PR and verify GitHub Foundation **RED**, expected target `ERR_MODULE_NOT_FOUND`.

### Task 2 — Minimal GREEN implementation
- [ ] Add one pure module `planReviewedSplitSaleUpdate(snapshot,{canEditSales})` with complete trusted row/data checks.
- [ ] Call source update-read, original payment book and current settlement gates, existing split preview, revision and delta helpers. Do not duplicate money math or write a transaction.
- [ ] Run exact-head Foundation and verify all new tests + frozen source integrity pass.

### Task 3 — Integration and review
- [ ] Check exact-head Foundation, M01 Chromium, M02/M03/M04/M09 real local Workerd/D1 and Cloudflare preview safety.
- [ ] Confirm PR contains only four additive files, no D1 migrations/SQL/auth/RPC/financial writes.
- [ ] Record RED/GREEN run URLs, changed files, gating dependencies and rollback. Keep PR draft/unmerged until owner approves and all required checks succeed.
