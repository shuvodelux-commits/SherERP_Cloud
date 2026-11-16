# M06 reviewed split Sale Update conservation — Superpowers TDD plan

**Source:** frozen SalesManagement.gs / SalePayments.gs, M06 WORKSTREAMS.md, AGENTS.md and `docs/superpowers/specs/2026-11-17-m06-reviewed-split-update-checkout-integrity.md`.

**Ownership:** `src/modules/reviewed-split-sale-update-intent.js` and `tests/m06-reviewed-split-update-intent.test.mjs` exclusively, with new spec/plan documentation; do not touch PR #424's `sale-update-read-model.js`.

1. Inspect trusted `planReviewedSplitSaleUpdate` and its existing frozen-source oracle parity fixture: original Grand=100, Paid=70, Due=30; Cash 40, Bank 30; matching Customer settlement.
2. Add RED regression changing saved original Due to 30.01 while adjusting only the trusted current settlement Due to 30.01 (to pass the existing settlement equality guard) and a separate case changing saved Grand to 99.99. Keep real payment children and Cash/Bank evidence coherent with Paid 70.
3. For both cases assert `NEEDS_REVIEW: original reviewed Sale Update checkout totals mismatch`, and no mutation to supplied snapshots; demonstrate missing exception from exact GitHub code and a real GitHub Actions RED Node test job.
4. Preserve existing valid-source parity test, due-only version-1 empty-child scenario and later-settlement rejection; do not normalize original header money.
5. GREEN minimal implementation: parse saved Grand using existing `salePaymentPaisa_`, require a safe integer sum of saved Paid/Due equal to Grand, then retain the later-settlement guard and the rest of the original preview logic without any writes.
6. Verify the exact new GitHub branch head against all Node regression and real Workerd/D1 tests, plus browser and Cloudflare safety checks; investigate unrelated failures as separate workstreams.
7. Open/maintain draft PR with RED and GREEN commits, actual check results, risks, rollback and next production gates; leave unmerged until exact-head CI green and owner review.

**Scope:** No production D1/RPC/schema, GAS, UI, stock, Customer/Bank/Cash book or source-data modifications. This is a fail-closed read-only preview, not production-ready Sale Update support. Revert only this PR if a reviewed frozen valid case disproves the original totals invariant; never fabricate financial history.
