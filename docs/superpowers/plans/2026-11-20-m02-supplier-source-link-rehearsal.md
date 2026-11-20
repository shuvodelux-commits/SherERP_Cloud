# M02 Run 7 — Supplier source-identity and obligation-link rehearsal (test-only)

**Status:** Independent source-mapping rehearsal; NOT M02 provenance approval or M03 posting permission.  
**Base:** `SherERP_Cloud main@309daa703824a5d7531756686859d1ec20b5432b` after merged #724/#725.  
**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.  
**Issues:** M02 #24, M08 #66, M03 #22, coordination #456, clean shops #690.  
**Concurrent draft:** M03 Control Center [#722](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/722), with exclusive provisioning Worker, D1 migration and UI ownership.

## Superpowers overview (12 sentences)

1. The first new-shop purchase is still blocked by exact Supplier identity, approved M08 money parameters, and M03 SQL-time actor and transaction gates.
2. M08 source tests #723 and the separate money proposals #724/#725 are merged; they do not sign off historical Supplier provenance or production SQL.
3. The existing M02 Party planner correctly forbids name/phone-only identity merges but does not itself prove purchase and return reference closure.
4. This independent M02 slice adds an offline, synthetic, test-only Supplier reference rehearsal covering Supplier, Purchase, Purchase Return and attributable Supplier Ledger records.
5. Every source reference is compared as an exact literal Source ID within one explicitly selected shop context, never a normalized name or phone.
6. Duplicate or missing IDs, orphan Purchases, mismatched Returns and ambiguous Ledger references become fixed, redacted blockers.
7. Historical source rows that were subsequently soft-deleted or marked inactive must retain original identity lineage and cannot be silently discarded.
8. For a NEW_SHOP candidate only, a new Purchase must not target a currently inactive or deleted Supplier.
9. Unknown Ledger source types must remain an explicit review blocker instead of being fabricated as a payment or purchase allocation.
10. A successful synthetic test does not certify the 49-group historical snapshot, actual archive amounts or D1 reconciliation.
11. We will add a test first, verify a meaningful RED, then add the smallest test-only reference implementation and run full GitHub CI.
12. The only output allowed into the PR is synthetic evidence and non-identifying counts; the M03 integrator still owns migrations, financial SQL, Worker bindings and public RPC.

## Single-owner file scope

- NEW `tests/m02-supplier-source-link-rehearsal.test.mjs` — isolated M02 acceptance.
- NEW `tests/fixtures/m02-supplier-source-link-rehearsal.mjs` — pure, test-only provenance readback contract.
- NEW this plan `docs/superpowers/plans/2026-11-20-m02-supplier-source-link-rehearsal.md`.

No edits to M03 #722 files, `src/db/**`, `migrations/**`, `staging-migrations/**`, `src/rpc/**`, `frontend/**`, `legacy/source/**`, `wrangler*`, finance kernel, or any shared CI.

## Source contract and negative cases

- `Suppliers.gs` keys operations by literal `Supplier ID`; `Purchase.gs` joins the active Supplier by exact ID.
- `PurchaseReturn.gs` carries the original `Purchase ID` and `Supplier ID`, and source `SUPPLIER_LEDGER` rows use references to a Purchase, Return or payment.
- Scope is intentionally limited to ledger types `Purchase`, `Purchase Return Credit`, `Payment`, and `Opening Balance`; an unfamiliar type fails closed pending original-source review.
- The standalone reference does not interpret debit/credit amounts or perform transaction posting.
- Missing/deleted historical rows are not rewritten. Historical archive and new empty-shop approvals are distinct, and published issue/PR reports must remain redacted.

## RED → GREEN → review

1. Commit the standalone regression tests before the test-only fixture; expected RED is `ERR_MODULE_NOT_FOUND`, **not** a production bug.
2. Add the minimal fixture and run the focused tests with the frozen-source verification and all exact-head GitHub CI.
3. Verify the actual PR changed-file set against #722; record file reservation in #456.
4. Request independent /super qa and /super review. Leave unmerged until reviewer and owner accept.
5. Never use this proof alone to sign M02 #24, authorize live purchases, run remote SQL, or release M10/M11.
