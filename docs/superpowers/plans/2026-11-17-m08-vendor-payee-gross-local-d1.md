# Superpowers RED → GREEN plan — M08 Vendor/Payee gross source parity

**Issue:** #580, parent #66, coordination #456. M08 sole owner. Starting main `76cca6a9b107603cc19a727a6907c7602cddd011`.

1. Reuse existing M08 local Workerd/D1 test runner and `wrangler.m08-positional-test.jsonc`; do not edit CI or shared paths.
2. **RED:** append 8+ acceptance tests to `tests/integration/m08-d1-positional-cash-workerd.spec.mjs` that import missing isolated Vendor/Payee schema and read-only adapter. Commit first. Capture actual expected missing-fixture RED run if CI executes before the GREEN push; never misrepresent a queued/cancelled run.
3. **GREEN:** add four STRICT disposable tables: Vendor masters, Vendor Ledger, Payee masters and Expenses. Store gross amounts in integer cents, legacy physical source row and tenant ID. No production migrations.
4. Build parameterized `D1.batch` read adapter, validate strict request and all source IDs, detect duplicates/orphans, reconstruct independent Vendor Payable and Receivable display balances in pinned GAS order, report stored vs recomputed drift; expose payee-linked expense history without liability.
5. Add `Vendors.gs` and `ExpenseSettings.gs` to the M08-only test VM allowlist for source-executed comparator functions. This is a test fixture change only.
6. Compare read models with pinned `getAllVendorsForUI_`, `getActiveExpensePayeesForUI_` and `recalculateLedgerBalancesForDisplay_` using synthetic source-shaped rows. Verify status/deletion, same literal cross-role ID, tenant isolation, missing/duplicate IDs, unsafe requests, negative positions, orphan references, no D1 mutation and public RPC 404.
7. Run targeted local Workerd suite through GitHub Actions, then **all latest-head workflows**; review diff, missing threads, mergeability and protected-branch checks. Leave PR in QA/Review; Super Build never merges.
8. Record real RED/GREEN commits and CI URLs on PR; if no observed RED, report test-first commit but unobserved failure. Handoff any production schema/posting needs solely to M03.
