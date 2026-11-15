# M06 POS / Sale Payments — Source-Parity Preparation Design

**Date:** 2026-11-15
**Status:** TEST-ONLY PREPARATION. M06 runtime posting, schema and public RPC remain BLOCKED by the readiness gate.
**Workstream owner:** M06 source-contract lane; M03 owns shared D1/atomic kernel and migration files; M04 owns authenticated actor.
**Source of business truth:** `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, preserved byte-for-byte in `legacy/source`.
**Authority:** `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/M03_PARALLEL_READINESS.md`, `docs/MIGRATION_PLAN.md`, ADR-007.

## Intent

Start M06 safely while M05 stock/lot posting, M03 SQL safety and M04 server-authentication contracts are unfinished. Capture **observable frozen original** cash/bank/mobile split-payment behavior in executable parity tests. These tests are the reference for later ports, not a substitute for Worker + real D1 integration. Preserve original POS V2, invoice and draft interfaces; do not redesign the frontend or create a second financial engine.

## Approaches considered

1. **Implement live Worker sale posting immediately:** attractive short-term, rejected because the shared D1 schema and concurrent stock/Cash Session/actor kernel are not approved; partial or duplicated money is unacceptable.
2. **Source-pinned payment characterization, then guarded M06 implementation:** chosen preparation approach. A test-only adapter loads immutable `SalePayments.gs` in a local VM and asserts genuine source outputs; no service endpoint or D1 writes.
3. **Document-only inventory or mocked generic payment math:** insufficient as an executable migration oracle because it can silently diverge from original rounding, revision and reconciliation rules.

No later business posting approach is implicitly approved by adopting option 2.

## Source behavior to preserve

| Entry / behavior | Original owner | Required future contract |
|---|---|---|
| `getPosBootstrap(token)`, `previewPosInvoiceProfit(token,payload)` | `Sales.gs` | Authorized POS options/pricing without trusting client-supplied cost |
| `completeSale(token,payload)` | `Sales.gs` | Cash Session + actor/permission checks, correct invoice/line/stock/tender/due effects in **one** atomic and SQL-guarded D1 commit |
| `normalizeSalePayments_(total,rows,accounts)` | `SalePayments.gs` | Integer-paisa validation, at most 20 payment rows, unique IDs, max one Cash, typed active Bank/Mobile account; applied cash limited to unpaid remainder |
| `readSalePaymentBreakdown_(sale,children)` | `SalePayments.gs` | Unversioned legacy fallback versus version `1` active child rows; no synthetic backfill; stored paid total, revision and cash-change integrity enforced |
| `salePaymentAccountDeltas_`, `assertSalePaymentBookEvidence_` | `SalePayments.gs` | Correct **applied** amounts per cash drawer / bank account, no change as income; invoice-linked existing book evidence before corrections |
| `salePostingJournalDecision_` | `SalePayments.gs` | Same-intent committed replay only; interrupted/ambiguous operation needs human review; changed payload conflicts |
| `saveSalesDraft`, `updateSalesDraft`, `getSalesDraftPreview` | `DraftSales.gs` | Source-saved selected customer ID, split-versus-legacy payment shape and draft version preserved; draft is not a posted sale |
| `getSalesManagementList`, `getSaleDetail`, `getSaleForUpdate`, `updateSale` | `SalesManagement.gs` | Original sale history, active Cash Session edit restriction, tender revisions and exact reversal effects; M07 owns native return/delete boundaries |
| `buildInvoicePayload_`, `findInvoice`, `findSalesByPhone` | `Invoice.gs` | Invoice snapshot and applied/current payment status remain distinguishable from original tender/change |

**Identity:** An explicitly selected `Customer ID` is authoritative across POS/drafts/edits and maps through reviewed Party legacy links; no name/phone auto-merge. A fully paid sale does **not** create a Party solely to account for its cash payment (the source still requires a name and phone snapshot). Due sales require a resolved eligible customer account; NEVER net supplier/vendor/loan/owner accounts automatically.

**Stock:** M05 FIFO by purchase date, then lot ID, with bundles, vendor sourcing and OVERSOLD/negative-stock policy must be preserved. Preview calculation does not reserve stock. Last-unit races must be prevented inside SQL, not by UI checks.

**Posting:** Future D1 batch includes invoice header, item/lot children, guarded stock changes, vendor sourcing where applicable, customer AR, tender book entries, immutable operation receipt and journal/ledger records. Zero-row conditional updates must abort the **whole** operation. M03 owns shared SQL guard contract; M06 consumes it after owner sign-off. Unknown timeout: reconcile stable tenant+actor+operation+payload, never re-post with a new key.

**Money:** Native pure helper accepts two-decimal amounts and uses integer paisa. Before SQL conversion, M03/M06 must approve exact BDT rounding, FX assumptions (if any), database bounds and legacy single-method compatibility. The old GAS split journal accepts 12–100-character IDs while the current M03 internal contract has different limits: agree on one canonical server-side key format instead of silently truncating or changing stable keys.

**Session / security:** RPC allowlist and authentic actor must come from M04, not `token`, `actorId` or `isApproved` fields supplied by POS clients. Cash Session is a required original sale gate even if no cash tender moves; M08 owns lifecycle/ledger integration. All financial changes remain disabled until enforceable.

## Exact first-slice files and effects

- `tests/fixtures/m06-payment-source-oracle.mjs`: test-only VM wrapper; verifies the Git blob hash of frozen source; exports no Worker endpoint.
- `tests/contract/m06-sale-payment-source.test.mjs`: original-result characterization for split, precision, invalid tenders, versioned children, cash/bank books and replay decisions.
- This spec and its implementation plan.

**Modified production source:** none. **Copied/transformed source bytes:** none; existing `legacy/source/SalePayments.gs` is read without modification. **RPC before / after:** unchanged. **Tables/migrations:** none. **Cash, bank, Party and stock writes:** zero. **Import/backfill:** none. **Rollback:** revert the test/docs-only PR.

## Release / implementation gates (not met by this slice)

1. M05 reviewed stock lot planner, SQL stale-lot abort and real D1 FIFO/OVERSOLD/vendor/bundle cases.
2. M03 single owner approved posting boundary, unique IDs, exact intent fingerprint, immutable receipt and lost-response reconciliation, real workerd/D1 concurrency tests.
3. M04 trusted persistent auth, roles and actor, including rejected/disabled-session cases; Party legacy link/independent AR account contract approved.
4. Cash Session gate and M08 single accounting owner decide placement and idempotent ledger book responsibilities; any terminal stage failure rolls back all effects.
5. Source-vs-Worker golden payment parity PLUS simultaneous last-item sales, duplicate submit, interrupted outcome, CAS=0, child-insert failure, mixed bank/cash/change totals and gross per-account Party reconciliation on **real local D1**.
6. Print/POS V2/draft UX parity tested in browser before any M06 release. Never expose test-oracle functions via RPC.

## Explicit non-goals

No POS UI refresh, no production Worker handler activation, no Cloudflare remote D1, no live Google Sheets access, no ledger table design, no public preview DB binding, no import/backfill, no cross-role netting, no M07 return implementation, no cutover.

**Readiness:** `PARALLEL-MODULE-READY = false` until the repository gate is explicitly updated after the required merged evidence. This document is an implementation preparation artifact, not readiness approval.
