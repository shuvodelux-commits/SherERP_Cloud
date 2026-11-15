# M06 sale-update POS loader read model — design (2026-11-15)

**Source authority:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `SalesManagement.gs::getSaleForUpdate`, `Bundles.gs::getSaleBundleSnapshot_`, `SalePayments.gs::readSalePaymentBreakdown_`, and `CashSession.gs::findSessionForTimestamp_`. Target authorities: `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, ADR-007, merged M06 PRs #82, #140 and #223.

## Target and boundaries

The original Sales screen reopens an existing invoice in POS Update Mode only after a `sales.edit` permission check, unique nondeleted invoice lookup, no active Sales Return and an Open Cash Session matching the invoice's original `Created At`. It returns source-shaped invoice customer details, original payment children and method, original sale items, bundle revision snapshots and active vendor source metadata. A frontend edit request can NEVER rely on this read-only eligibility check: actual `updateSale` must recheck permissions and invariants at commit time.

Implement **one pure, internal read adapter** `projectSaleForUpdate(invoiceId, snapshot, {canEditSales})`. Input snapshots are server-obtained, already tenant-filtered **legacy-column row arrays**: `sales,items,paymentRows,returnItems,sessions,bundleComponents,vendorSourcing`; `returnItems` is active return children (M07 is responsible for scoping). `canEditSales` is a trusted server-resolved M04 capability, not a browser-supplied field. Refuse incomplete source snapshots and ambiguous duplicate Sales IDs; do not infer identity from Customer name/phone or mutate any row.

## Rules

- Same public data shape as GAS `getSaleForUpdate`'s `ok_(data).data`; no new fields from profit/PII/private cost beyond source semantics.
- If missing, deleted, returned, or historical session is not Open, refuse. Invoice matching uses exact original `Invoice ID`. The most recent session opened no later than original sale Created At wins, matching native GAS; never assume any currently Open unrelated session authorizes editing a closed historical invoice.
- If `Payment Detail Version='1'`, use **existing source-exact** `readSalePaymentBreakdown_` and fail closed on invalid or duplicate children; legacy blank-version sales return `payments:[]` and their historical payment method fallback. Do not synthesize or post payment records.
- Historical Bundle snapshot values match native `getSaleBundleSnapshot_` semantics: by Bundle Product ID, revision/sets consistency, positive component quantities, and source-shaped item classification.
- Source vendor sourcing associates active rows by original Invoice ID + Product ID, with original last-row-wins behavior; no amount or stock movements are made. Preserve exact saved nonnegative line total when available, else fall back to source rounded quantity × unit price.
- For D1 canonical dates/times, format `YYYY-MM-DD` and `HH:mm:ss` only; invalid/untrusted timestamp input fails closed. No front-end handlers, SQL, migrations, RPC, Workers preview binding, remote D1, or original source edits.

## Verification / integration gate

Frozen original source is loaded in a **test-only** Node VM after verifying Git blob SHA. Compare exact returned data with original `getSaleForUpdate` for multiple fixtures; verify negative cases, no snapshot mutation, explicit permission authority, absent source file changes. GitHub PR must show observed RED, minimal GREEN, full Node/Workerd-D1/Chromium/source/preview CI. This read-only adapter is NOT a production `updateSale` or cashier authorization. Future M03/M04/M05/M08 atomic posting and cutover remain separately owner-gated.

**Recovery:** revert only these new spec/plan/test/fixture/module files; no SQL/data rollback.
