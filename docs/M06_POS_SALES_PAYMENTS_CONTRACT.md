# M06 — POS, invoices and sale-payment source contract (first implementation slice)

**Status:** The source-faithful **pure payment calculation/read-validation helpers** have been ported and tested. **No sale posting, invoice RPC, real D1 financial table, or login/POS activation is implemented or authorized by this change.**

- Original source: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, immutable `legacy/source/` snapshot; `npm run verify:source` checks the recorded manifest.
- Current target baseline: `SherERP_Cloud/main@08939c4` at branch creation. Future work must rebase onto reviewed M03/M04/M05 contracts rather than modifying their owned SQL/migration/authorization files concurrently.
- Implementation: `src/modules/sale-payments.js` mechanically copies **lines 1–269** of `legacy/source/SalePayments.gs`, with only a module header and seven exports added. GAS-only `salePostingPayloadHash_` (lines 271–281, calls `Utilities.computeDigest`) is intentionally **not ported**. It must use the reviewed M03 canonical versioned intent fingerprint and authenticated actor authority in the later posting service.
- Contract regression: `tests/m06-sale-payments.test.mjs` runs the same inputs against the original pinned GAS functions in a VM and the Worker-safe pure module; it compares normalized result shapes **and failure messages**, with explicit assertions on expected values.

## M06 original entry points and ownership

| Source file | Existing entry points / responsibilities | Current status |
| --- | --- | --- |
| `Sales.gs` | `getPosBootstrap`, `previewPosInvoiceProfit`, `completeSale`: product/customer/session/bootstrap, sensitive-price permissions, FIFO & bundles, vendor shortage, invoice, split/legacy money posting | Baseline reviewed; not ported |
| `SalePayments.gs` | `salePaymentPaisa_`, `normalizeSalePayments_`, `readSalePaymentBreakdown_`, `salePaymentAccountDeltas_`, `assertSalePaymentBookEvidence_`, `salePaymentNextRevision_`, `salePostingJournalDecision_`, `salePostingPayloadHash_` | First seven source-exact, pure helpers ported; GAS digest deferred |
| `SalesManagement.gs` | `getSalesManagementBankAccounts`, `getSalesManagementList`, `getSaleDetail`, `getSaleForUpdate`, `updateSale` and internal adjustment/ledger helpers | M06 read/update contract; transactional edits and reversals also depend on M07 |
| `DraftSales.gs` | `saveSalesDraft`, `getSalesDraftList`, `getSalesDraft`, `updateSalesDraft`, `deleteSalesDraft`, `getSalesDraftPreview`; version checks and posted-draft idempotency | Not ported; draft consume must share posting boundary |
| `Invoice.gs` | `findInvoice`, `findSalesByPhone`, `buildInvoicePayload_`, date/print payload | Not ported; original print layout must remain intact |
| `CashSession.gs` | `startCashSession`, `getCashSessionSummary`, `closeCashSession`, `requireActiveCashSession_` | M08 owns lifecycle; M06 posting must enforce open-session policy at SQL boundary |

### Source-backed invariants for future `completeSale`

1. `pos.add` authorization, server-generated authenticated actor and an **open Cash Session for every sale** (including entirely due sales). `posCost.view` plus the setting gate cost visibility. Server pricing for `auto`; fixed prices require the posted draft's matching line; manual prices are validated.
2. The legacy single-tender path supports `Cash`, `Due`, `Partial`; the multi-tender path requires a business setting and a stable 12–100 character operation ID. The **new D1 posting contract must impose a stable operation ID for all writes**, not replicate the legacy unkeyed-write weakness.
3. Split-tender money is exact integer **paisa**: at most 20 unique row IDs, one Cash row, positive Bank/Mobile allocations only to an active matching account, no Bank/Mobile over-tender. Cash tender may exceed the remaining amount, but **only cash applied** enters the Cash Book; returned change remains on the payment child as metadata. `paid + due = grand total` in paisa. Fully paid uses legacy `Payment Type: Cash` even for all-bank payments; do not reinterpret it as a literal cash movement.
4. Payment Detail Version `1` means active `SALE_PAYMENTS` children are authoritative. An entirely due sale may correctly have **zero children**. Prior unversioned sales retain a read-only legacy synthetic payment presentation; **never backfill a child row on read**. Book reconciliation compares applied credits/debits per cash/account, not tendered change.
5. FIFO uses Purchase Date then Lot ID across suppliers. `OVERSOLD` negative-stock logic and vendor-sourced shortages are distinct. Bundle components and standalone lines must share one aggregate physical demand; frozen bundle revisions/consumption owner attribution and product stock/lot consistency must be proven before posting.
6. Cash and credit sales may retain walk-in name/phone snapshots (the pinned `completeSale` currently requires both on **every** sale), but an anonymous cash sale **does not create a Party**. When due is positive, preserve the explicitly selected **Customer ID** (including canonicalization of stale draft snapshots) and resolve only through reviewed M02-P Customer legacy links; never infer a Supplier/Owner identity from a name or phone. Post Customer receivable separately; no cross-role netting.
7. New posts include invoice, sale items, lot allocations, stock/movements, bundle snapshots, vendor sourcing and its role-specific payable, versioned payment children, Cash/Bank Book, customer due/ledger, posting receipt, and draft consumption. Never treat a stranded header/journal stage as proof of success.
8. Draft versions, backdated permissions/reasons, authorized sale-edit restrictions, invoice-print payload and exact-once M07 reversals must retain original contracts. Only invoice-present + complete matching payment children + a committed authenticated operation receipt may be replayed as success.

## Transaction boundary design gate (not implemented here)

Later M06 posting owns one **atomic D1 `batch()`** guarded by immutable authenticated `(operationId, actorId, authorityVersion, canonicalIntentHash)`. Replan FIFO from current indexed lot/stock versions; require SQL-level CAS/unique/trigger guards for ownership, stock, account/session state, customer/party relationship, due increment and bank authority. An **affected-row count of zero is not a thrown error**: the batch must fail closed or conditionally skip *every* dependent write. No JavaScript read/await/write loop may sit inside the posting boundary. Persist or reconcile a durable operation receipt before answering retries. On uncertain outcome, return `Needs Review` and query the **same** operation ID, never silently mint a new one.

The mandatory real Workerd/D1 acceptance matrix remains: concurrent last-owned-item claims; stale FIFO lot/stock; lost response/replay; same ID conflicting intent; one forced failure at each child/journal/bank/due stage leaves **zero partial impact**; Cash/Bank/Mobile split + change + due reconcile; selected Customer ID gross account isolation; vendor sourcing vs OVERSOLD; bundle overlap; cash-session close race; role/permission/actor changes; draft version replay. M07 must prove exact-once reversal separately.

## Current impact and blockers

- **Code:** new pure `src/modules/sale-payments.js`; no UI, serverCall transport or RPC registration change. The Worker remains fail-closed (`login` unavailable, financial RPCs not migrated).
- **SQL:** no new or modified tables; no migrations; no D1 binding; no data import/backfill or production change.
- **Accounting:** no persisted stock, customer/supplier/vendor/Party, cash, bank or ledger mutation. This module only calculates and validates values in memory.
- **Tests actually provided by this slice:** original-vs-port pure source parity and Node unit tests. **No real D1 posting evidence** is claimed by this PR.
- **Blocked:** M03 real source-backed posting kernel/schema ownership, M04 authorized actor/session RPC enforcement, M05 lot/FIFO/source-contract APIs, reviewed M02-P account identity mapping, and cash-session concurrency policy. Continue later as independent PRs after interfaces freeze.
- **Recovery:** revert this single isolated pure-helper commit. Existing source, stored data and deployment remain unaffected.
