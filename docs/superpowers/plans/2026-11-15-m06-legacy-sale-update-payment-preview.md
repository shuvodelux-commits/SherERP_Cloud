# M06 Legacy Single-payment Sales Update Preview — Superpowers TDD

**Goal:** Source-faithful preview for historical no-split-version Cash, Due and Partial Sales edits.

**Architecture:** Compose merged `planSaleUpdateLineTotals` and one pure preview of the **original** SalesManagement single-payment branch; use source-pinned executable VM as independent reference.

**Constraints:** GitHub branch+PR only; KISS; preserve frozen original frontend and scripts; no D1, posting, M03 shared schema, M04 auth/RPC, M05 FIFO, M07 returns, M08 ledger, Cloudflare deployments. Legacy bank-account rules must not be replaced by split allocator's active-account filter.

**Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/SalesManagement.gs` and `Utils.gs`, target AGENTS.md/ADR-007/workstreams/readiness.

### Task 1 — design and RED

- [ ] Add spec and this plan before code.
- [ ] Add test-only `tests/fixtures/m06-legacy-sale-update-oracle.mjs`: source SHA verification and exact source payment-block extraction, original money/Bank resolver functions in Node vm.
- [ ] Add `tests/m06-legacy-sale-update-preview.test.mjs`: native source parity across Cash, Due, Partial, Bank/Mobile, inactive historical bank, original fractional line and discount, first historical product row, strict invalid/rejected inputs, authorization and immutability.
- [ ] Commit test before helper; observe GitHub Foundation test **RED** from absent `src/modules/legacy-sale-update-payment-preview.js`.

### Task 2 — minimal GREEN

- [ ] Add `src/modules/legacy-sale-update-payment-preview.js` with one exported `planLegacySaleUpdatePaymentPreview(snapshot,{canEditSales})`; reuse merged exact line totals; source legacy payment algorithm only; keep bank lookup simple, no writes.
- [ ] Inspect exact-head Foundation source/parity test log and original code pin; correct any source divergence; repeat GREEN until 0 failures.

### Task 3 — review and handoff

- [ ] Verify exact-head GitHub Foundation, Chromium, M03 local Workerd/D1, M04 auth and Cloudflare PR safety; log counts and pending checks accurately.
- [ ] Confirm change set exactly five additive files: docs/spec, docs/plan, source-oracle fixture, regression tests, pure module.
- [ ] Document no public activation, M03/M04/M05/M07/M08 shared SQL posting gates and rollback; leave PR unmerged pending owner review.
