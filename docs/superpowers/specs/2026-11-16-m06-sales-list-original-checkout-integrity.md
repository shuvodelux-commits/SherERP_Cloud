# M06 — original checkout amount integrity in Sales Management list

## Decision and source
Frozen Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` source `SalesManagement.gs`, SherERP `AGENTS.md`, `docs/WORKSTREAMS.md` M06, and the pure `src/modules/sales-management-list-read.js` are the references. This is a trusted tenant-filtered list projection, **not a public RPC, not a financial posting service**.

Original Sales Management rows currently use `Number(value)||0` for checkout money. A corrupted legacy D1 row with `Grand Total=90`, `Paid Amount=60`, `Due Amount=30.01`, or a missing/negative paid field can be displayed as a valid sale. This misrepresents historical debt and financial status. PR #373 independently guards **single-invoice reprint**, remains open as of task start, and must not be edited here.

## Behavior
1. For each nondeleted original Sale, require original `Grand Total`, `Paid Amount`, and `Due Amount` to be exact, nonnegative, safe integer paisa with at most 2 decimal places, and require `Paid + Due = Grand` exactly.
2. If an input header is impossible or missing, refuse the list with `NEEDS_REVIEW: Sales list original checkout totals mismatch` rather than silently treating malformed values as zero or fabricating balances.
3. Apply the check to **original checkout only**. Do not conflate later Customer settlement/credit or Sales Return into the immutable original header; these remain separate and can legitimately differ from the historical checkout.
4. Preserve exact original source-shaped outputs and profit privacy for valid rows. An anonymous Cash sale never becomes a Party. Historical return/editability and duplicate invoice ID protections remain unchanged.
5. Use the existing tested `salePaymentPaisa_` from `src/modules/sale-payments.js` to avoid introducing another currency parser. This remains pure read-only, with no API/RPC, no D1 access, and no source data modification.

## Acceptance
- First commit demonstrates genuine RED in GitHub: intentionally corrupted original totals are displayed instead of rejected; valid settlement and source fixture parity remain green.
- Minimal production change protects only Sales Management list original header amounts; no change to the sibling source fixture or Money helper.
- Exact-head Foundation + relevant local Workerd/D1 + Chromium UI + Cloudflare safety checks all pass before owner review and merge.
- Leave branch PR draft/unmerged. Open PRs #333 (synthetic posting replay), #313 (multi-unit), and #373 (invoice reprint) must not be touched.

## Explicit non-goals
No sales posting, invoice editing, migration of business data, live D1, Cloudflare production deployment, new public lookup, UI redesign, Party cross-role auto-settlement, or actual ledger reconciliation. This alone is not M06 production readiness.
