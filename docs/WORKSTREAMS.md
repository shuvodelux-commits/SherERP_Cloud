# SherERP Cloud — Workstream Register and Acceptance Matrix

**Status:** Proposal only. Refer to [MIGRATION_PLAN.md](./MIGRATION_PLAN.md) for the authoritative engineering design and complete acceptance gates.

**Approved architecture amendment:** [ADR-007 — Unified Party](architecture/ADR-007-unified-party-relationships.md) is mandatory for customer/supplier/vendor/finance/payee-related D1 work; see [Superpowers execution plan](superpowers/plans/2026-11-14-unified-party-migration.md). One identity, seven combinable roles, separate financial accounts; never auto-net. Manual settlement is later opt-in with explicit permission and approval.

## Delivery rules

- Each Mxx below is a separate pull request or a small series of PRs; do not merge a single giant port.
- No feature is complete based on compilation alone. Affected browser/UI tests, D1 runtime integration tests, and exact accounting parity evidence are mandatory.
- Assign owners to the shared DB repository, schema and posting kernel; do not allow multiple workers to change these simultaneously.
- Maintain one GitHub issue or checklist per workstream after planning review. Link PRs to issues and provide before/after test artifacts.
- P0 pins an immutable source SHA. New source commits are not automatically merged during migration; assess and port them explicitly.

## M00 — Baseline and behavior inventory

**Depends on:** nothing. **Critical files:** Mohim_ERP AGENTS.md, PROJECT.md, Code.gs, Config.gs, Database.gs, Utils.gs, all client HTML and existing tests.

**Deliverables:** source SHA manifest; complete 47-file backend ledger with external APIs and global function graph; inventory of 37 HTML inputs and include order; configured 49 DB-group mapping; RPC registry inventory; risk-ranked direct Sheet/range callers; sample sanitized parity dataset; baseline unit/regression results.

**Definition of done:** every endpoint, data group and financial write is mapped; missing baseline coverage is explicitly reported.

## M01 — Frontend build and Worker shell

**Depends on:** M00 contracts. **Critical files:** index.html, javascript.html, style.html, pos.html, posv2.html, print/invoice partials, Code.gs.

**Deliverables:** Wrangler configuration with separate local/staging/prod, static HTML include build, /health and /api/rpc placeholder, same-origin fetch adapter, unresolved include validation, Playwright baseline screenshots.

**Definition of done:** frontend shell loads without GAS; no broken DOM events/navigation; mobile, desktop, print tests; API returns controlled errors rather than false successes.

## M02-P — Unified Party schema and migration prerequisites (blocking substream)

**Depends on:** M00 pinned Config.gs and transaction behavior, owner-approved [ADR-007](architecture/ADR-007-unified-party-relationships.md). **Blocks:** related financial/party schemas in M02, corresponding repository writers in M03/M05/M08 and later manual settlement activation.

**Critical files:** Config.gs, Customer.gs, Suppliers.gs, Vendors.gs, Expense.gs, ExpenseSettings.gs, FinanceModule.gs, OpeningBalance.gs, PartyLedger.gs and their original tests; specifically `CUSTOMERS`, `SUPPLIERS`, `VENDORS`, `FINANCE_PERSONS`, `EXPENSE_PAYEES`.

**Deliverables:** (1) source contract and ID/ledger/sign matrix; (2) reviewed `parties`, `party_roles`, `party_legacy_links` and identity-review queue D1 schema; (3) separate Party account-kind/contract mapping including advances, vendor AP/AR and owner equity distinct from loan AP/borrower AR; (4) deterministic dry-run identity mapping with human-reviewed ambiguous matches; (5) real D1 integration tests for constraints, preservation of legacy IDs and row provenance.

**Definition of done:** no automatic merging by name/phone, no changed legacy account/transaction semantics, no single combined Current Due field, separate account balance parity and a clear reviewer-owned queue for unresolved identities. This is a *Party identity foundation*, not permission to post manual offsets.

## M02 — D1 schema and offline importer

**Depends on:** M00 schema/data inventory. **Critical files:** Config.gs, Setup.gs, SeedData.gs, Database.gs.

**Deliverables:** typed SQLite migrations for all in-scope groups; unique IDs and indices; stable row identity; constraints and audit retention; import/export mapping; dry-run reports; deterministic sanitized fixture import. **Party-related finance table DDL must use M02-P's approved role/account source mapping; the already proposed three catalog tables are independent.**

**Definition of done:** local and staging D1 schemas apply cleanly, repeatable import, no missing relationships, phone/date/amount preservation; exact row-count report.

## M03 — D1 repository + async runtime conversion

**Depends on:** M01, M02. **Critical files:** Database.gs, Utils.gs, direct range users, all relevant .gs modules.

**Deliverables:** ported .js modules, build/bundle imports, async getAllRows_/findRow_/appendRow_/updateRowFields_ interfaces, date/UUID/hash/property/cache replacement, full transitive async call-graph conversion, static scan for forbidden GAS services. Include Party legacy-ID resolution adapters without changing the original RPC contract or creating two independently authoritative financial ledgers.

**Definition of done:** representative reads/writes work in actual Wrangler+D1 test runtime; tests fail if Promise accidentally propagates to UI result; no silently skipped writes.

## M04 — Authentication and authorization

**Depends on:** M03. **Critical files:** Auth.gs, UserManagement.gs, RoleManagement.gs, UI.gs, login.html, javascript.html.

**Deliverables:** token/session persistence, login-throttle and password upgrade, account-disable behavior, role and permission contracts, last-admin protection, API allowlist and input validation. Party relationship roles are **not** staff RBAC; identity-link review and future settlement approval require dedicated server-side permissions.

**Definition of done:** login/logout/permission/disable/unauthorized tests pass with real D1; no user identity taken from untrusted client fields.

## M05 — Inventory, purchases and sourcing

**Depends on:** M03, M04. **Critical files:** StockLots.gs, Products.gs, Purchase.gs, PurchaseManagement.gs, PurchaseReturn.gs, Bundles.gs, Vendors.gs, Suppliers.gs, SupplierSettlement.gs.

**Deliverables:** indexed product/supplier/lot repositories, FIFO planner, lot posting atomicity, negative stock/OVERSOLD, vendor/consignment and bundle coverage, purchase edit/delete and linked record protection. Supplier/Vendor source IDs and obligations resolve to Party identity only through reviewed legacy links; never collapse their due/receivable buckets.

**Definition of done:** source fixture parity for stock and costs, concurrent purchases/stock mutations safe, no cross-lot false allocations.

## M06 — POS, invoices and split payments

**Depends on:** M05. **Critical files:** Sales.gs, SalePayments.gs, SalesManagement.gs, DraftSales.gs, Invoice.gs, CashSession.gs.

**Deliverables:** atomic sale posting design in D1 batch and SQL guards; stable operationId, replay/Needs Review policy; all child records, stock, due, journal and tender postings inside enforced commit boundary. Preserve explicit selected Customer ID through Party mapping; anonymous cash sale does not create a Party; never settle supplier balances automatically.

**Definition of done:** two concurrent last-item sales do not oversell owned stock accidentally; failure-injected sale leaves zero partial accounting impact; duplicate submit does not double post; split cash/bank/change reconciles.

## M07 — Returns and native corrections

**Depends on:** M06. **Critical files:** SalesReturn.gs, PurchaseReturn.gs, DeleteEngine.gs, SalesManagement.gs, StockLots.gs.

**Deliverables:** partial/full return, multi-invoice return, original lot restoration, native edit/delete, dependency protection, audited soft-delete and exact-once reversal. Reversals retain original Party/account source links; a displayed net never substitutes for an obligation-level reversal.

**Definition of done:** repeated/parallel reversal has one effect, and all resulting stock/party/cash/bank balances equal verified original fixtures.

## M08 — Finance, cash, bank and party ledgers

**Depends on:** M06, can overlap with M07 after posting interfaces freeze. **Critical files:** FinanceModule.gs, CashBook.gs, BankBook.gs, CashReconciliation.gs, CashSession.gs, Customer.gs, CustomerSettlement.gs, Suppliers.gs, SupplierSettlement.gs, PartyLedger.gs, OpeningBalance.gs, DayBook.gs.

**Deliverables:** cash session lifecycle, bank transfers, customer/supplier/vendor ledgers, finance person flows, opening balance historical semantics, reconciliation and audit actor. Support seven Party roles with distinct receivable/payable/advance/owner equity/loan buckets; Finance Persons' existing mixed Owner/Lender/Borrower roles map to one Party without combining balances. Payee alone creates no debt.

**Definition of done:** no double counting, cross-ledger inflow/outflow matching, opening balances do not falsely alter today's cash, relevant cash-session gates correct.

## M08-S — Optional manual cross-role settlement (disabled until separate policy gate)

**Depends on:** M02-P reviewed links/accounts, M04 authorization, M05–M08 posting and reversal safety, real-D1 concurrency testing, and explicit owner approval of eligible account pairs and proposer/approver thresholds. This is **not** an automatic migration feature.

**Deliverables:** explicit same-Party/compatible-currency/legal-entity account selection, source obligation allocations, restricted maker/approver permissions, immutable audit + documentary reason, one balanced noncash SQL posting guarded by remaining obligation amounts, operation-id idempotency, exactly-once reversal, and per-account reconciliation. Default candidate Customer AR against Supplier AP only after reviewed eligibility. Do not allow loans, owner equity, advances or vendor combinations without a separate policy.

**Definition of done:** no automatic offsets, no cash/bank/cash-session side effects for pure offsets, no unauthorized or over-allocated posting, no duplicate posting or partial commitment under concurrent/retry/failure scenarios in real D1. Feature stays off if any gate is missing.

## M09 — Reports/settings/interface parity

**Depends on:** M05, M07, M08. **Critical files:** Reports.gs, Dashboard.gs, DayBook.gs, Settings.gs, UI.gs, invoice HTML/CSS, other module HTML.

**Deliverables:** SQL read models with indexes, parity date ranges and reports, settings, permissions-based navigation, export/receipt/print parity, desktop/tablet/mobile browser test coverage. Add an optional compact Unified Party overview with separate role ledgers and clearly labeled display-only net; preserve original Customer/Supplier/Vendor/Finance screens and UX.

**Definition of done:** same report values and visibility rules for identical datasets; no frontend redesign.

## M10 — Full data migration rehearsal and security/performance gate

**Depends on:** M07–M09. **Critical files:** importer, all SQL migrations, infrastructure and CI.

**Deliverables:** full snapshot staging import, discrepancy ledger, source ID/row mapping, all financial invariant checks, retry/failure/concurrency suite, security review, query/CPU and UX performance baselines, restore drill. Reconcile original source identities and **each gross Party account** independently (including customer/supplier advances, vendor two-way amounts, owner equity and loans) and reject ambiguous mappings on posted obligations.

**Definition of done:** zero unexplained critical discrepancies; defined p95 latency and D1 budget gates met; owner signs readiness report.

## M11 — Cutover, monitoring and documented rollback

**Depends on:** M10 approval. **Critical files:** runbooks, CI/CD, deployment environment, source export tooling.

**Deliverables:** time-bounded GAS write freeze, last source snapshot + checksum, final import/reconciliation, routing switch, smoke tests, rollback of both *traffic and new writes*, monitoring and support playbook. Include Party link/review state and any approved post-cutover settlement journal in the rollback/replay strategy.

**Definition of done:** production workflows verified, legacy source preserved read-only, successful recovery rehearsal, owner handover.

## Cross-workstream parity checklist

| Requirement | Primarily owned by | Evidence |
|---|---|---|
| Existing UI without redesign | M01 + M09 | Playwright snapshots + manual print acceptance |
| No client-initiated arbitrary RPC | M01 + M04 | Registry/negative security tests |
| All 49 configured data groups mapped | M02 + M03 | Schema diff, import counts and ID mapping |
| One Party can carry all seven roles without auto-merge | M02-P | Verified source-ID link fixtures, same-name/phone ambiguity queue, FK tests |
| Gross AR/AP, advances, vendor balances, owner equity and loans stay separate | M02-P + M08 | Original ledger parity per account and contract; no global Current Due |
| Manual cross-role offset never posts automatically | M08-S | Permission tests, atomic signed noncash entries, replay/reversal and unchanged cash/session totals |
| Asynchronous D1 calls awaited | M03 | Static graph + real integration tests |
| Safe globally unique invoice/payment IDs | M03 + M06 | Concurrent counter and idempotency tests |
| FIFO across lots in original order | M05 | Source-parity fixtures and concurrency cases |
| No partial sale/purchase posting | M05 + M06 | Deliberate SQL constraint failure rollback proof |
| Exactly-once reverse on edit/delete/return | M07 | Duplicate replay and state reconciliation |
| Cash-session, opening balances, bank transfers | M08 | Financial golden fixtures |
| Historic reports and current balances match | M08 + M09 | Full ledger/report comparison |
| Migration can resume and be audited | M02 + M10 | Import manifest and checksums |
| Cutover can be recovered without losing writes | M10 + M11 | Staging disaster-recovery drill |

## Critical research/spike decisions before main implementation

1. **D1 transaction correctness:** Prototype one completeSale with FIFO version checks and duplicate replay. A simple sequence of await db.prepare(...).run() calls is not atomic. Design must enforce stale-row and zero-updated-row abort inside the same SQL transaction, not merely read a status after commit.
2. **Sheet row index replacement:** Find all usages of getSheet_(), getRange(), deleteRow_() and _rowIndex; distinguish stable IDs from physical row ordering; design mapping without changing business relationships.
3. **Money precision:** Compare original value serialization, rounding and discounts to an integer-minor-unit or otherwise exact SQLite schema; prove outputs match.
4. **Legacy authentication:** Audit Auth.gs hashes, tokens, expiry behavior and upgrade path; preserve access without copying credentials to logs.
5. **Single shop versus multi-shop:** Initial plan assumes one existing business. Write a separate architecture decision before implementing many-tenant routing, multiple D1 bindings, shop isolation or billing.
6. **User's existing GAS environment:** Live spreadsheet export is a separate authorized operation; do not infer live data from repository code.
7. **Unified Party policy:** [ADR-007](architecture/ADR-007-unified-party-relationships.md) fixes identity, roles and separated accounts. Before implementation review permitted noncash offset account pairs, approval policy, legal entity and currency, original ID linkage, and reconciliation of soft-deleted/historical records. This is not permission for auto-netting or unsupervised merges.

## Source preservation and PR review template

Each PR must explicitly state:
- Source SHA and original function(s) copied/adapted
- Files and SQL tables changed
- RPC before/after contract
- Account/stock/cash/bank/ledger impacts
- Tests actually executed (unit / real D1 / browser)
- Failure injection and concurrent behavior when transactional
- Import/backfill need and recovery plan
- Remaining gaps, known limitations, and owner decision if needed

Do not claim a phase is complete based only on a green syntax check, mocked Google APIs or a working UI screen.
