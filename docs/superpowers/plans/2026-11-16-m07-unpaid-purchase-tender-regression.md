# M07 regression fix — Unpaid purchase Supplier Credit synthetic test tender (2026-11-16)

**Source:** failed M03 Worker-runtime D1 integration run [#43873822734](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/43873822734) on M11 draft PR #375. **Original source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Base:** `SherERP_Cloud/main@5fb3e6e5a473ec097421817c9ebc36fda1efbfe3`.

## Twelve-sentence diagnosis and plan

1. The M03 Worker-runtime/D1 integration workflow failed one newly included M07 purchase-credit correction test while 485 other tests passed.
2. The failing case was `unpaid original purchase Supplier Credit correction never creates Cash entry`.
3. Its local test `seed('UNPAID',{paidAmount:'0'})` generated `paymentMethod:''` before calling the synthetic M05 purchase poster.
4. The existing `createSyntheticPurchasePoster` validation contract permits the input `paymentMethod` to be either `Cash` or `Bank`, irrespective of the paid amount.
5. The poster already derives an empty **stored** tender method for zero paid amount, and creates no cash entry.
6. Therefore the source of the failure is an invalid synthetic fixture input, not a production finance or Supplier Credit calculation.
7. The RED proof is the exact CI failure with `TypeError: Invalid synthetic purchase identity, date or payment method` from `m05-purchase-d1-contract.mjs`.
8. The minimal GREEN change will use `paymentMethod:'Cash'` for this synthetic source purchase without changing `paidAmount:'0'`.
9. Regression assertions will verify that zero monetary payment remains zero, with an empty persisted tender method and no cash or bank journal rows.
10. No validator, posting kernel, SQL schema, Worker RPC, Cloudflare configuration, D1 data or original GAS/Sheets code will be changed.
11. The fix will be isolated in a dedicated M07 GitHub PR because PR #375 does not own the unrelated M07 test and is behind concurrent main changes.
12. After M07 PR CI is green and owner-merges it, PR #375 must be rechecked against the latest main and all exact-head checks before its own merge.

## Impact

- Only update `tests/integration/m07-purchase-credit-delete-workerd.spec.mjs` and add this plan.
- Existing Workerd local D1 test still exercises the real fixture, reviewed Party linking, Supplier Credit reversal, no Cash/Bank creation and double-post protection.
- No live deployment, business-data migration, production D1 binding, external source access or credential handling.
