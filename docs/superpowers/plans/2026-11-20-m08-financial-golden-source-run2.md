# M08 Run 2 — direct frozen-source financial golden regressions

**Status:** Test-only, review required; no production schema or business-rule approval.  
**Branch:** `m08/financial-golden-source-run2-20261120`; base `main@466e980d191f5007cbf333000e17d0e2b46d4c2e` (merged #721).  
**Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.  
**Issues:** M08 #66, M02 #24, single M03 integrator #22, coordination #456.  
**Adjacent Codex work:** Tenant Control Center GREEN implementation; no shared files touched.

## Implementation overview (12 sentences)

1. This workstream adds missing executable settlement and return golden tests to the M08 preparation lane.
2. Existing purchase source tests run the genuine `paySupplier` function but supply a simplified `validateSettlementDiscount_` stub.
3. The new contract must load the pinned `SettlementDiscount.gs` function so source permission and over-due rejection are observable.
4. A paid supplier settlement with a discount must credit the native Supplier Ledger by the total but debit Cash or Bank by the actual payment only.
5. A discount cannot exceed available due and must require the `settlementDiscount:edit` permission.
6. A payment without a discount may cross zero into a money-backed supplier advance.
7. An inactive Cash Session must prevent even a Bank supplier settlement, preserving the unconditional original entry guard.
8. Legacy blank Payment Amount and explicit Discount Amount must follow the source's separate accounting interpretation.
9. `SupplierSettlement.gs` must allocate a return credit to the referenced original purchase first, then remaining oldest obligations.
10. Excess noncash store credit must not be mislabeled as refundable cash-backed supplier advance.
11. The original Sales Return commit path intentionally leaves Customer AR intact for a Cash refund, while Store Credit reduces Customer AR without cash.
12. This test-only evidence does not resolve the owner-dependent rounding residual, fractional-paisa posting scale, M02 historic reconciliation or M03 live D1 release gates.

## File ownership and test strategy

- **New M08-only suite:** `tests/m08-financial-golden-source-run2.test.mjs`.
- **Existing M08-only loader:** `tests/fixtures/m08-legacy-source-runner.mjs` adds only four known original GAS modules to its fixed allowlist; AST extraction, duplicate checks, disabled dynamic code-generation and synthetic VM stubs remain unchanged.
- **No edits:** `src/db/**`, `migrations/**`, `staging-migrations/**`, `src/rpc/**`, Worker routes/configs, `src/auth/**`, original source, UI or any Control Center paths.

Test-first **RED** observed locally: the new suite correctly reported `Invalid M08 source test module` because the selected original settlement/return source modules were not yet allowed by the M08-only oracle loader. **GREEN** changed the allowlist, not financial business behavior, and made all 11 new source tests pass. An initial test path typo (`../fixtures`) and a Store Credit stub missing the `CUSTOMER_LEDGER` append were separately corrected in the test harness; neither was a production defect. Run 2 tests execute exact parsed frozen GAS functions, not reimplemented accounting algorithms.

## Required acceptance

| Source cases | New assertion |
|---|---|
| G09 | Bank supplier payment without discount may create signed supplier advance; Cash is unaffected |
| G10 | Actual original supplier settlement permission + discount produces ledger credit = payment + discount, money debit = payment |
| G11 | Over-due discounts and unauthorized discount edits fail without any supplier, ledger or money mutation |
| G12 | Source return credit settles its original purchase first, then oldest; noncash remainder cannot become a money-backed advance |
| G16 | Original *prepared* Cash sale-return commit books cash out but leaves Customer AR unchanged |
| G17 | Store Credit sale return lowers Customer AR and creates customer ledger credit, without Cash |
| Additional | Cash Session gate on Bank supplier payment; legacy payment field fallback; store credit allocation ahead of cash advance |

**Previously covered, intentionally not duplicated:** G01–G08 purchase/precision, G14 split-return `৳0.33 × 3 = ৳0.99` versus `৳1.00`, and existing isolated M05/M07/M08 Workerd/D1 replay/rollback and tenant-isolation tests. All unresolved source-vs-proposed policies remain **unapproved** under merged #721.

### Reproduce

```sh
npm run verify:source
node --test tests/m08-financial-golden-source-run2.test.mjs
node --test --test-concurrency=2 \
  tests/m08-financial-golden-source-run2.test.mjs \
  tests/contract/m08-purchase-source-financial.test.mjs \
  tests/contract/m03-run3-purchase-precision-source.test.mjs \
  tests/integration/m05-purchase-posting-workerd.spec.mjs \
  tests/integration/m07-purchase-supplier-credit-workerd.spec.mjs \
  tests/integration/m08-reconciliation-atomic-workerd.spec.mjs
```

The Workerd/D1 tests listed are *existing isolated synthetic fixtures*, not the approved integrated operational purchase/return schema. `npm test` includes the new `tests/*.test.mjs` suite and runs on the established Foundation and M03 CI workflows. Preserve public RPC fail-closed, require independent Super QA/Review, full current-head checks and human PR merge before proceeding to the next lane.
