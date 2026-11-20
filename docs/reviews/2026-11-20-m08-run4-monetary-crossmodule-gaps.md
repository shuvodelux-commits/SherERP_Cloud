# M08 Run 4 — cross-module monetary rounding / parity gate

**Date:** 2026-11-20 (Asia/Dhaka)
**Status:** Source-verified **review evidence**, not owner numeric policy sign-off and not an operational writer.
**Base:** SherERP_Cloud `main@309daa703824a5d7531756686859d1ec20b5432b` (merged #724 then #725).
**Pinned source:** Mohim ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Owner business policy:** [M08 #66](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/66#issuecomment-7030515664). **Technical limits/tie/rounding boundary not signed** under [#66 decision request](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/66#issuecomment-7030856376).
**Cross-lane:** M03 Control Center PR #722 owns its own files. This document authorizes no edits to M05/M06/M07/M03 production modules.

## Implementation overview (12 sentences)

1. This Run 4 is a **test-only compatibility audit** between previously merged M08 exact-decimal reference arithmetic and existing M05/M06/M07 source-faithful helpers.
2. New-shop arithmetic may eventually round the invoice grand total once and distribute resulting paisa by deterministic immutable line identity.
3. The original Sale Update helper instead rounds each new line to paisa before building its subtotal.
4. Under sub-paisa prices, those two boundaries produce different amounts even when each local calculation is internally correct.
5. The witness imports the actual existing `planSaleUpdateLineTotals` implementation to expose that source behavior rather than rewriting it as a new finance engine.
6. It calls the merged `allocateInvoicePaisa` reference separately, classifies its difference and does not post or correct either value.
7. M05 Tiles Pcs/Box/Sqft per-line pricing agrees with the M08 rational quote for each immutable measured unit snapshot.
8. However, two separately rounded Tile lines may differ from a single exactly rounded header, and displayed two-decimal Sqft must not replace exact area.
9. M06 split tender accepts whole-paisa input and can conserve an approved invoice header, but its existing source parser refuses sub-paisa tender text.
10. M05 historical purchase reconciliation permits source numeric drift within 0.004 BDT; a newly authored ledger should instead conserve exact integer paisa, without changing historical records.
11. Frozen Sales Return Cash on an unpaid invoice deliberately differs from the owner-approved net-collected-money ceiling for **new shops only**.
12. Integrating these differences needs joint M05/M06/M07/M08/M03/M04 acceptance, not a hidden runtime switch, public RPC activation or duplicate money posting engine.

## Exact observed differences (synthetic, source-code executed)

| Case | Existing source/module boundary | Proposed M08 new-shop invoice quote (HALF_UP selected for test, not approved globally) | Result / decision |
|---|---|---|---|
| Two ordinary items 1 × ৳0.335 | M06 original Sale Update rounds each to ৳0.34 → **68 paisa** | Exact grand ৳0.67 → **67 paisa**, line allocation `34,33` | **+1 paisa source relative to proposal**; require shared posting boundary decision |
| Three ordinary items 1 × ৳0.335 | Three rounded items = **102 paisa** | Exact grand ৳1.005 → **101 paisa**, line allocation by immutable ID | **+1 paisa** |
| Two very small items 1 × ৳0.004 | Two source Sale Update lines round down to **0 paisa** | Exact invoice ৳0.008 → **1 paisa** | **−1 paisa source relative to proposal** |
| Twenty-five items 1 × ৳0.335 | Per-line 34 × 25 = **850 paisa** | Exact grand ৳8.375 → **838 paisa** | **+12 paisa**; a blanket 1-paisa reconciliation tolerance is unsafe |
| Two separate Tiles 1 Pcs × ৳0.005 each | M05 Tiles per-line half-up: **1 + 1 = 2 paisa** | M08 exact basket header ৳0.01 → **1 paisa** | **+1 paisa**; even independently correct Tile lines may disagree with header |
| Single Tile with valid ratio/coverage | M05 per-line exact Pcs, Box or Sqft pricing uses full fraction | M08 rational per-line HALF_UP quote | **Exact match** for nominal/manufacturer examples |
| Split Bank ৳0.25 + Cash ৳0.50, grand ৳0.67 | M06 applies **25 + 42**, returns **8** change | M08 invoice header **67 paisa** | Consistent after fixed header, provided Money authority and Cash Session validated at SQL time |
| Original purchase fractional cost | M05 historical line `0.5 × 10.005 = 5.0025`; source audit permits 0.004 tolerance | Exact amount retained then new proposed quote 500 paisa | **History must not be rewritten** to proposed new-shop money rounding |
| Unpaid Customer sale return, gross value ৳75 | Frozen source posts Cash out **7500 paisa**, Customer AR stays 20000 paisa | Approved **new shop** denies Cash without verified collection; 7500 paisa remains eligible noncash | Expected **product policy difference**; history stays intact |
| Cart size | M06 original unified POS V2 preview allows **100** lines | M08 candidate invoice quote allows **200** | **Unresolved product/technical limit**; do not blindly raise POS cap |
| Input fields | M06 split-payment amounts at most **2 decimals**, no sub-paisa tender | M08 preserves sub-paisa raw product cost and price until money boundary | Keep pricing and tender input contracts distinct |

**Severity:** The 25-line example proves a monetary divergence greater than one paisa without a defect in either individual helper. The requirement of 100% business-calculation integrity is incompatible with silently mixing these invoice formats. The correct fix must be an approved unified receipt/allocations contract for **new** transactions, not a source rewrite.

## Recommended future single-kernel contract — NOT yet approved

1. **Authority boundary:** M03/M04 verify the same Shop, actor, owner permission, active Cash Session, product revision, original Supplier/Customer account, stock/lot/source IDs and immutable operation ID **at SQL time**. Discard any stale UI preview money.
2. **Precision:** for new purchases and sales, preserve raw prices/costs/quantities as exact text and verified unit snapshots. Final rounding ties, decimal limits and maximum invoice size require a distinct M08 #66 owner technical sign-off.
3. **Choose one rounding boundary:** if approving M08's header-once candidate, persist **both** header total and allocated per-line net values with a balancing one-paisa distribution. Never sum a second, separately rounded M05/M06 line set for Cash, Supplier/Customer Ledger, stock/lot valuation or return entitlement.
4. **Invoice evidence:** append-only receipt ties each `(shop_id, invoice_id, line_id)` to exact original quantity/price/factor and its allocated whole-paisa amount; replay, edit, split payment, discount and returns refer to **that immutable allocation**, not to freshly recomputed historical prices.
5. **M05 Tiles:** keep exact Box/Pcs/Sqft and manufacturer coverage fractions; use the same allocation boundary for whole-invoice payment and each eligible return; preserve original lot provenance and FIFO price.
6. **M06:** split tender accepts the final approved integer-paisa grand, distributes Cash/Bank/Mobile applied/returned change without double posting, and links to cash book and bank account receipts exactly once.
7. **M07:** distinguish noncash supplier credit, money-backed supplier advance, Customer Store Credit and actual Cash out; final return residual correction max is still only a *candidate* one-paisa review rule, not permission to rewrite older source returns.
8. **M08:** enforce invoice-wide `sum(allocated_line_paisa)=header_grand_paisa` in SQL, not a floating-tolerance comparison; whole-paisa debit/credit legs balance, with overflow and late-statement rollback.
9. **Historical cutover:** preserve every original sub-paisa sheet row and historical source totals; reconcile separately with M02; do not pretend existing M06 source money and M08 candidate new-shop money are interchangeable.
10. **Unapproved changes:** no new operational SQL, D1 migration, public RPC, private Cloudflare write, access token, live Owner invitation or financial posting based on this document alone.

## Superpowers evidence / merge gates

- **RED:** the new M08 source-compatibility test imports a missing isolated audit probe; explicit `ERR_MODULE_NOT_FOUND`, while existing business modules stay untouched.
- **GREEN:** add only a test fixture calling the real M05 Tile, M06 Sale Update and SalePayments, M05 historical invoice audit, pinned original Sales Return and M08 proposal (no copy of a production calculator).
- **QA:** 16 tests cover parity, both signs of differential rounding, a 12-paisa multi-line drift, stable ID ordering, deterministic basket samples, split payment, historical immutability and a source-vs-new refund gap. Execute full source integrity plus prior M08/M05/M06 relevant suites on latest main.
- **Review:** accept the finding that a **single chosen monetary boundary** must replace separate per-line vs header rounding for NEW writes. Numeric policy review in M08 #66 is still open; independent M05/M06/M07 owners must sign usage before the M03 posting schema/writer.
- **Safe files:** `tests/m08-rounding-crossmodule-run4.test.mjs` (new), `tests/fixtures/m08-rounding-crossmodule-probes.mjs` (new), this document (new). No shared operational code, no live DB, no RPC, no Cloudflare config or Control Center files. `npm test` discovers the new suite in established Foundation CI; no new workflow permissions needed.
- **Rollback:** revert these 3 files only. Merge does **not** approve ROUND_HALF_UP, 12-digit limits, 200 cart lines, cumulative final return threshold, posting SQL, or release readiness.
