# M06 — Source-faithful POS phone invoice history (Superpowers TDD)

**Source:** pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, immutable `legacy/source/Invoice.gs::findSalesByPhone` and `legacy/source/Utils.gs` phone/duplicate helpers. Base: GitHub `main` after merged PR #82. Parallel M06 PR #83 owns a different posted-invoice reprint model and must not be modified.

## Goal

Adapt original POS past-sale **read-only phone/customer lookup** into one pure internal Worker-safe function. It receives a query containing a phone and optional exact source Customer ID, plus **trusted already-authorized** active/source sale rows and per-invoice settlement status snapshots prepared by a future M03/M08 D1 read service. This is not `findSalesByPhone` RPC and must not return any customer records to unauthenticated users.

### Required source invariants

- Staff `pos.view` permission is a separate M04 access prerequisite and must be checked *before* loading or returning source rows. No tokens or client-controlled roles accepted by the projector.
- Original `normalizePhoneDisplay_` fixes a 10-digit BD mobile; `normalizePhoneSearch_` compares ASCII/Bangla digits with +880/880 normalization and punctuation removed. Comparison is full equality, not substring. Blank phone input returns the original error rather than fetching all sales.
- Original selected `customerId` is an **exact** match, not a name/phone identity merge. A query with an ID includes sales for that ID **or** matching phone (as in source), but must not rewrite the Customer or Party identity of any sale.
- Deleted sales are excluded. All nondeleted duplicate `Invoice ID` headers are retained in lookup but marked `duplicateInvoiceId: true`. A duplicate cannot use inferred customer settlement; no arbitrary `findInvoice` selection.
- Sort newest first by original `Created At`; project original invoice/date/time/customer/total/status keys only. For unique customer due invoices, use an independently computed **trusted** current Customer settlement status, not the obsolete stored status. A missing computed status means original stored status is retained; no money is posted or altered.
- Use original `Invoice.gs` and `Utils.gs` in a test-only VM oracle. No new client transport, live D1 reads, financial writes, subscriptions or source changes.

## Superpowers steps

1. **RED** — add `tests/fixtures/m06-phone-history-oracle.mjs` to evaluate the pinned source and `tests/m06-phone-history.test.mjs` to execute meaningful fixture comparisons against the missing `src/modules/sale-phone-history.js`. Commit and capture GitHub Actions expected module-not-found failure.
2. **GREEN** — implement the minimal pure `projectSalePhoneHistory(query,snapshot)`, fail closed for malformed/untrusted input. Require explicit trusted `saleRows` and `settlementStatusByInvoice`, not a client-supplied authorization flag. Test no mutation and exact source parity for Bangladesh phone formats, duplicate IDs, selected customer identity, timestamp sort, deleted rows, due status and invalid query.
3. **VERIFY** — Node and source manifest, frontend compilation, existing real Workerd/D1 regression and Chromium/preview CI. Update PR with before/after evidence and release blockers.

## Changed files / contracts / rollback

Only four **new** files: this plan, the test VM oracle, its unit/source contract tests, and the internal pure module. RPC before/after: **unchanged**. D1 tables/migrations: **none**. Stock, Cash, Bank, Party Customer/Supplier/Vendor accounts, ledger, audit: **zero writes**. Original source and UI untouched. Revert this PR; no financial data rollback.

The proposed projector accepts a trusted settlement status *read model*, not arbitrary client data. The future authorized D1 integration must ensure customer-specific Customer ledger and return evidence, M04 `pos.view` and tenant-scoped actor before calling it. Real M05 FIFO sale posting, M08 settlement, M07 returns and M06 browser E2E remain separately blocked. This pure read model does not make POS operational.
