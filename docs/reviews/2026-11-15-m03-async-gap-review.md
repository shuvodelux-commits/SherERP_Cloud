# M03 transitive async migration gap review — 2026-11-15

**Source authority:** frozen Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2. **Evidence:** docs/baseline/m03-async-caller-closure.json; scripts/audit-m03-async-closure.mjs, scripts/audit-m03-async-graph.mjs; AGENTS.md; current src/rpc/registry.js.

## Grounded graph inventory

Frozen GAS has 47 source files and 614 named top-level functions. The audited call closure found 242 direct Sheet-read callers, 125 direct write callers, 389 transitively read-impacted, 285 transitively write-impacted, and **394 distinct impacted functions overall**. The 394 is **an impact count**, not a count of outstanding modules, migrated functions, or failing tests.

Automated lexical and AST call graphs are complementary. The baseline itself explicitly does not resolve all dynamic dispatch, method-property calls, local shadowing, callbacks/async timing, or runtime callsites. A green script --check proves the pinned inventory is consistent, not that source workflows are D1-ready.

## High-priority original source groups (affected top-level functions)

| Original .gs file | Affected functions | Examples in pinned inventory | Migration evidence still required |
| --- | ---: | --- | --- |
| DeleteEngine.gs | 68 | activeRows_, adjustCustomerDue_, adjustProductStock_ | Exactly-once reversal and all account/lot effects |
| StockLots.gs | 26 | applySalesReturnStockUndo_, applyPurchaseReturnLotReduction_ | Source FIFO, multi-supplier lot and OVERSOLD with D1 writes |
| PartyLedger.gs | 23 | getCustomerLedgerPage, getPartyLedgerPage_ | Source balances, paging and separate role accounts |
| DraftSales.gs | 18 | deleteSalesDraft, authorizePostedDraftRetry_ | End-to-end awaited writes, source audit and idempotent posting |
| SalesReturn.gs | 18 | completeReturn, completeReturnBatch | Original invoice-linked restoration and one-write transaction |
| Auth.gs | 16 | login, getSessionUser_, getUserPermissions_ | Deployed D1 auth schema and live per-method authority |
| FinanceModule.gs | 13 | addFinanceTransaction, getFinanceLedger | Bank/Cash/loans/owner sign parity and source history |
| SalesManagement.gs | 9 | updateSale, getSaleDetail | Exact stock/ledger/tender reversal and correction |
| CashSession.gs | 7 | startCashSession, closeCashSession, requireActiveCashSession_ | Source settings toggle and payment-path cash session gate |
| PurchaseManagement.gs | 6 | updatePurchase, getPurchaseDetail | Lot/cost/supplier account atomic correction |
| Products.gs | 5 | addProduct, getProductsBootstrap, updateProduct | Full products, serial/warranty/lot/bundle data parity |
| ProductSettings.gs | 4 | addProductCategory, addProductUnit, setProductCategoryStatus, setProductUnitStatus | Internal status/preflight exist; PR #248 is test-only atomic creation |
| Sales.gs | 4 | completeSale, getPosBootstrap | Full POS posting with tender/cash session and FIFO |
| Purchase.gs | 2 | createPurchase, getPurchaseBootstrap | Purchases with source supplier lot and account posting |

These numbers are from the pinned inventory, not guessed. Several local-only synthetic modules and tests exist in M05/M06/M07/M08. Their presence does not imply actual source RPC contracts have been migrated, deployed, authorized or reconciled.

## Async closure and runtime proof work remaining

1. **M03-core owner**: for each source API, record call chain from source GAS name to D1 adapter, every awaited result boundary, transactional write contract, and source-shaped response envelope. Mark not yet implemented rather than inferring coverage from a similarly named module. Keep a dedicated review queue for dynamic/client dispatch absent from the static graph.
2. **M02 importer owner**: reconcile 49 source sheet groups, original IDs, physical row provenance, currency/timezone and high-water counters against a repeatable **local** D1 import before permitting live master writes. Party cross-role identities stay separate from account balances.
3. **M04 auth owner**: prove current session, user/role epoch and permission at the same D1 write; role display metadata is not authorization. Staff schema still lives in tests/fixtures/m04-auth-migrations/ and must not be treated as deployed.
4. **M05–M08 functional owners after gates**: certify source-bounded purchase/sale/return/finance call chains using real Workerd/D1 isolation and replay/concurrency/late rollback evidence, not solely JSON planners.
5. **M01 owner**: preserve all original DOM handlers/serverCall names; add browser workflow proofs when real authorized RPC becomes available.

## Acceptance checklist

- Maintain frozen function/dispatch inventory and regenerate with both repository audits; inspect diffs for new source baseline changes, do not blindly rewrite snapshots.
- Map every user-visible source function to owner, supported/not-implemented state, awaited D1 method and auth permission. Review dynamic/wrapper and date/locale edges manually.
- Test source parity, true Workerd D1 read/write and SQL transaction failure injection; no Promise-as-array/object leak across result handling.
- Retain public /api/rpc=501 until the method's own complete auth, source data and mutation contracts pass. Lack of transport is a hard blocker, not a green readiness state.

## Decision

**NOT ASYNC-COMPLETE.** Existing helper subset and graph audits are meaningful preparation, but the 394 impacted-function graph has not been closed end-to-end. No blanket approval for multiple transaction-module writers or production cutover.