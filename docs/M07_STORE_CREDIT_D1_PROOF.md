# M07-A2 — Store Credit signed Customer balance Workerd/D1 proof

**Status: TEST ONLY.** This branch is no approval to enable `completeReturn`, to migrate financial schemas, or to deploy a functioning ERP. Original source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` remains byte-identical. This proof builds on merged M07 Cash test PR #79; `PARALLEL-MODULE-READY=false`.

## Original source truth

`legacy/source/SalesReturn.gs`'s `commitPreparedSalesReturn_` treats `refundMethod='Store Credit'` as `newDue=roundMoney_(Current Due - Total Return Amount)`, updating the **original Customer ID** and appending a `CUSTOMER_LEDGER` `Type='Sales Return Credit'` row with **Credit** and post-credit signed **Balance**. Negative balance is an **advance** and must not be clamped at 0. It posts **no** current Cash Book or Bank Book entry. Cash returns instead post a Cash Book debit and do not change Customer due.

## Exact test-only schema, entrypoint and accounting boundary

`tests/fixtures/m07-store-credit-contract.mjs`: `createSyntheticD1StoreCreditContract(DB).post(input)`. Internal harness-only trusted actor/tenant, exact identifiers (`returnId`, `operationId`, `invoiceId`, `sku`, `lotId`, `originalHash`, `customerId`), exact paisa integer credit, units and reason. Canonical SHA-256 `sales.return.store-credit` operation fingerprint. Results `COMMITTED`, `REPLAY`, `CONFLICT`, `DECLINED`, or `NEEDS_REVIEW` on ambiguous outcome. No external RPC, HTTP return route, or release schema.

Disposable local D1 tables added to the **existing** M07 Cash proof fixture: `m07_customer_signed_accounts` (source-specific `signed_due_paisa`), `m07_credit_returns` (immutable header/operation receipt), `m07_credit_ledger` (original Customer and Party attribution, exact credit, post-credit signed balance). The preceding M07 returned-lot quantities, lot stock and shop stock are shared by both Cash and Store Credit; a per-method SQLite INSERT + AFTER INSERT trigger **atomically** guards and reserves original sold quantity, restores original synthetic lot/stock, records inverse stock movement, decrements exactly one signed Customer balance, and appends one source-linked Customer ledger row. The original M06 invoice/customer/source hash, actual posted sale item and movement, Cash Session, reviewed exact Customer → Party legacy link, signed-account Party match, and price ceiling are checked inside the SQL claim. Zero-row claims do not post children. SQL trigger checks affected-row counts and rollback.

**Cross-method identity:** Cash and Store Credit test writers both guard against the other's `return_id`/`operation_id` in SQL and read a unified receipt lookup. Reusing a committed Cash return ID/operation ID as Store Credit—or the reverse—returns `CONFLICT`, not double physical return or double tender.

**Signed-account boundary:** M06's disposable nonnegative due `m06_customer_accounts.due_paisa` has no advance semantics. This proof seeds a separate *test-only signed oracle* from the original M06 due and changes it for Store Credit, leaving M06 due unchanged. This is **not** a second production ledger: no live writer and no general accounting path. The production source-linked Customer receivable/advance schema and single posting authority are explicitly owned by M02-P/M08 integration; there must be one reconciled account truth at cutover. Supplier AP and unrelated Customer/Party identities remain untouched.

## TDD and evidence

- **RED:** committed the new Workerd acceptance tests against an absent `m07-store-credit-contract.mjs`; observed `ERR_MODULE_NOT_FOUND` before the GREEN implementation.
- **GREEN:** `node --test tests/integration/m07-store-credit-workerd.spec.mjs` initially **10/10 passed on actual local Workerd/D1**; extra regression tests for concurrent distinct-invoice credits and injected movement rollback were added for final CI.
- Scenarios: due reduces from ৳200 to ৳125 on ৳75 Store Credit, paid-sale 0 becomes **-৳75 advance**, exact original customer only; original Cash Book, Bank Book, customer M06 source and Supplier AP unaffected; replay/conflict, concurrent same-lot race, unreviewed/other Customer rejection, stale source, forged lot/overprice/cross-tenant, Cash Session closed, forced ledger rollback, cross-method duplicate guard, malformed input and no HTTP endpoint.
- Review all GitHub Actions and full Workerd aggregator results on this PR before merge; no results are claimed for tests not actually run.

## Explicit limits and rollback

Only **synthetic one-lot, owned-unit, single-invoice Store Credit** with an injected trusted actor and deliberately seeded original sale/Party evidence. No real M04 atomic RBAC and user session authority, no real M05 lot/consumption/fallback, no exact M08 signed Party schema or production Cash Session lifecycle, no batch/multi-line/multi-unit/vendor/bundle/OVERSOLD, no walk-in identity creation, no later settlement or native return edit/delete reconciliation, no original UI/print integration or production D1 writes. This is **not production M07**.

Rollback this PR's test fixture, documents and CI import; no remote data or live schema is affected. A real adapter requires a reviewed single posting owner and source/import reconciliation before it can be enabled.
