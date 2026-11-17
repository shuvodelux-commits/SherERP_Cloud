# M09 Sales Return report lineage audit — read-only design

**Workstream:** M09. **Tracking issue:** #431; coordination board #456. **Main baseline:** `666dd0ca5e0632dbc5bb3fb75c4584e0433d36ec`. **Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `Utils.gs::activeReturnChildRows_`, `Reports.gs::getSalesReport`, `SalesReturn.gs`, `Config.gs`.

## Problem
The frozen `activeSalesReturnItems_` includes child rows by an active `SALES_RETURN` header's `Return ID` and excludes deleted children. But Sales/Profit reports attribute that child's economic return to the **child `Invoice ID`**, not the header's. A corrupt/stale imported line with the same Return ID and a different Invoice ID can shift revenue/refunds between invoices without a failed SQL read. Other hazards: active orphan child rows, duplicate Return IDs, missing/deleted sales invoice references, and headers with no active children. Import-row counts alone cannot certify these links.

## Design
Add one **pure, internal, read-only audit** `auditM09SalesReturnLineage({allSales,returnHeaders,returnItems})` with original source-shaped full arrays, including soft-deleted rows. Do not construct or modify a report snapshot. Validate plain own-data rows, dense arrays, original string IDs and explicit deleted markers without invoking getters. The audit checks only active header/child lineage, plus active sale identities. Deleted return headers/children are not included in active economics (exact source behavior); retain their historical records untouched for separate provenance auditing.

Return only `{ready:false,lineageComplete,status,issues}` with unique fixed issue codes; never return a source ID, row, customer name, amount, token or raw exception text. **Never return ready true** even for perfect synthetic input: this pure diagnostic cannot attest authenticated/tenant-scoped D1 source provenance, roles, finance or M10 reconciliation.

## Approaches considered
- **Selected:** isolated pure reference-integrity audit, independent of D1/RPC; KISS and testable now within M09 ownership.
- Defer all checks until M03 real D1 report reader: would leave silent wrong-invoice attribution uncharacterized and force unrelated schema work.
- Auto-rewrite return child Invoice IDs from header: forbidden; mutates history and hides original source conflicts.

## Non-goals and gate
No D1 queries/migrations, no src/db or src/rpc edit, no production financial report binding, no posting or ledger reconciliation, no UI redesign, no deletion/reparenting. Audit result is *not* a migration approval, not a replacement for M07 original-lot return semantics and not a production permission check. Requires owner review, full exact-head GitHub CI and M03 shared integrator signoff if a future adapter consumes the contract.
