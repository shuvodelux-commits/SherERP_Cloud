# M08 Run 4 — Source-vs-candidate rounding drift: isolated evidence

**Status:** Review-only, non-posting. **Main base:** `309daa703824a5d7531756686859d1ec20b5432b` (merged #724 and #725).  
**Pinned Mohim_ERP:** `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.  
**Workstream:** M08 #66; M03 shared financial integrator #22, M02 identity #24; coordination #456.  
**Concurrent ownership:** M03 Control Center draft #722; no shared paths.  
**Previous proofs:** merged #723 (source oracle), #724 (pure conservation probes), #725 (technical exact-money quote + local Workerd/D1).  
**Owner status:** business principles approved for NEW empty shops, **technical HALF_UP/HALF_EVEN choice and posting boundary still unsigned**.

## Twelve-sentence implementation overview

1. Run 3 proposed exact rationals, an invoice-header paisa boundary and immutable-ID largest-remainder allocation, but those choices are not an owner-approved operational contract.
2. The frozen original `Purchase.gs` stores raw `qty * price` line and header values rather than an integer-paisa line allocation.
3. Frozen `Utils.gs` supplies `roundMoney_` and `effectiveTransactionUnitPrice_`, which are executable source functions used in native transaction/return projections.
4. Rounding each tiny economic line individually can differ by a paisa from rounding the invoice header once.
5. The Run 4 suite will execute the actual frozen source helper functions in the existing synthetic source oracle and compare their illustrative per-line rounded projections with PR #725's candidate totals.
6. It will separately label the original raw-purchase accumulation from the illustrative source-helper rounded return projection, without inventing historical money-book rows.
7. It will pin a three-line fractional price with no discount, a two-line half-paisa case, and a discounted three-line case that exhibits a per-line-versus-header residual.
8. It will characterize the negative half-paisa tie without deciding that source JavaScript rounding is a permissible new correction-posting rule.
9. Every comparison must conserve and report only synthetic paisa counts; no personal data, source IDs, remote account or private rows are involved.
10. The comparisons are executable evidence of policy tension, not authority to change existing receipt, lot, refund, customer or supplier balances.
11. No operational M08 module, shared M03 SQL kernel, migration, public RPC, original frontend, legacy source or deployment configuration will be edited.
12. After RED/GREEN and exact-head GitHub CI, the draft PR will request independent Super QA and Super Review before any human-approved merge or later technical sign-off.

## Exclusive file ownership

- NEW `tests/m08-run4-source-header-rounding-drift.test.mjs` — M08 source/candidate parity acceptance
- NEW `tests/fixtures/m08-run4-rounding-drift-observer.mjs` — nonposting test oracle; imports only frozen GAS helpers and M08 proposal
- NEW `docs/superpowers/plans/2026-11-20-m08-run4-rounding-drift-handoff.md` — this review plan

## TDD, acceptance and limits

1. Commit RED test importing the deliberately absent test-only observer. Observe the expected `ERR_MODULE_NOT_FOUND` in GitHub CI and **do not** describe it as a production defect.
2. Implement minimal GREEN observer, then run focused Node suite and all exact-head GitHub checks; inspect actual CI logs.
3. Compare observed source-helper per-line **illustrative** rounded totals against candidate rounded header/allocated lines, report the exact drift, and preserve original source lexemes and original helper behavior.
4. Distinguish original `Purchase.gs` raw subtotal, its JavaScript zero-floor, and the source `roundMoney_` helper: these are different steps, and `Purchase.gs` did not actually post independently rounded line payments.
5. Do not hardcode a production mode, choose new invoice rounding/discount allocation, amend historical rows, or approve source/Cash Session/Party/account contracts from this report.
6. If an existing approved API lacks sufficient provenance for comparison, record that limitation; do not silently replace source functions.
7. **Merge gate:** independent `/super qa`, `/super review`, exact-head checks and human decision. No M03 production SQL activation.

## Next acceptance decision, not part of this PR

Owner and M08 must explicitly choose a numeric maximum scale, rounding tie, invoice/line posting boundary and residual allocation compatible with purchase, POS, returns and original source-history compatibility. M03 then owns the only approved SQL-time writer with Shop/actor/session/permission checks, immutable receipts, exact rollback/replay and balanced cash/ledger/lot changes. M02 source identity and M10/M11 release gates remain separate.
