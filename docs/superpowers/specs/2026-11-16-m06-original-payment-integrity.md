# M06 — Original invoice payment arithmetic integrity

## Intent and context
The original SherERP posted-invoice flow renders immutable checkout tender alongside a *separate* later-settlement snapshot. The pure D1-compatible `projectPostedSaleInvoice` faithfully reads the frozen Mohim_ERP `Invoice.gs` shape, but an imported original sale whose `Paid Amount + Due Amount` does not equal `Grand Total` can still be rendered as if reconciled.

**Source:** `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `Invoice.gs` / `SalePayments.gs`; target `src/modules/sale-invoice-read-model.js`, `src/modules/sale-payments.js`, `tests/m06-posted-invoice-read-model.test.mjs`. M06 must preserve the original invoice, not silently re-post money, invent a Party or rewrite historical balances.

## Required behavior
1. Before emitting any printed receipt, verify the **original** `Grand Total`, `Paid Amount`, and `Due Amount` are all nonnegative exact decimal-paisa amounts and obey `Paid + Due === Grand`.
2. If an original amount is missing, negative, has more than two decimal places, or fails conservation, throw a deterministic `NEEDS_REVIEW: posted invoice original checkout totals mismatch`. Do **not** recompute or overwrite the historical fields.
3. Later settlement `paidAmount`, `dueAmount`, `customerCreditUsed` are intentionally **not** compared to original checkout fields: they reflect later ledger events, and checking them against the original grand total may break legitimate returns/collections.
4. Preserve valid source snapshot parity (including split tender, Cash change, entirely due, legacy and walk-in sales, zero grand total) and exact previous print payload for valid data. Existing line-item, Customer, product unit and time behaviors remain untouched.

## Alternatives
- **Chosen:** one read-only preflight in M06 pure posted-invoice model, reusing the exact paisa parser from `sale-payments.js`. This fails closed without any storage write, schema or permissions change.
- Validate only in a future M02 importer: insufficient defense against manual corrections, stale data, malformed internal reads.
- Auto-correct the invoice before printing: unsafe, invents financial history, contrary to migration preservation.

## Scope and release gates
One regression file and one pure read model only, plus Superpowers spec/plan. No source GAS/HTML, receipt redesign, production D1, RPC, ledger writes, authentication, stock or Cash Session. Separate from open M06 posting/replay PR #333 and M05/M06 multi-unit PR #313.

Definition of done: real GitHub Node RED proves original invalid balance accepted; the minimal GREEN rejects it; all exact-head Node, Workerd/D1, Chromium and Cloudflare CI checks pass; draft PR remains for owner review. Not a production-ready sales writer.
