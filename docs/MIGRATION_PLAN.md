# SherERP Cloud — Master Migration Plan

**Status:** Proposed plan, not implemented.  
**Source:** https://github.com/shuvodelux-commits/Mohim_ERP (main; pin a commit SHA at kickoff).  
**Target:** https://github.com/shuvodelux-commits/SherERP_Cloud.  
**Technology decision:** Cloudflare Workers + Workers Static Assets + **Cloudflare D1 SQLite**.  
**Scope:** Port the existing Google Apps Script (GAS) + Google Sheets application, preserve business behavior and visual frontend, retire GAS/Sheets from the *new* runtime only after acceptance.  
**Source protection:** The original repository and production spreadsheet are read-only migration references. Do not alter/delete them.  
**Approved Party amendment (2026-11-14):** One Party, seven combinable roles, separately reconciled financial accounts and optional explicitly authorized manual noncash cross-role settlement. See [ADR-007](architecture/ADR-007-unified-party-relationships.md), [design](superpowers/specs/2026-11-14-unified-party-design.md), and [Superpowers implementation plan](superpowers/plans/2026-11-14-unified-party-migration.md). No Party production implementation is authorized by this planning amendment.

## 1. Goals, invariants, and non-goals

### Goals

1. Existing browser HTML, CSS, JavaScript, page structure, DOM ids, keyboard/touch behavior, POS V2, invoices, printing and responsive layout have visual/behavioral parity. **No React, Vue, Next.js or frontend redesign.**
2. Reuse existing backend JavaScript algorithms; convert .gs to .js, make dependencies explicit, and alter only runtime/data-access/transaction-boundary code required for correctness.
3. Replace all Google Sheets reads/writes with D1 and all GAS-only services with audited alternatives.
4. Preserve all existing authorization, FIFO/OVERSOLD lots, stock sourcing, customer/supplier/vendor ledgers, cash and bank movements, cash-session rules, transaction edits/deletions, returns, history and audit trails.
5. Data migration is deterministic, repeatable and fully reconciled before production cutover.
6. Every financial posting is atomic and idempotent; no duplicate invoice, lot movement, cash/bank posting or reversal on retry.
7. CI tests, verified Cloudflare preview, operational monitoring, backup/recovery, and a rehearsed rollback plan are required.
8. A verified Party may simultaneously be Customer, Supplier, Vendor, Owner, Lender, Borrower and Payee; its accounts must remain financially distinct, with opt-in manual settlements only.

### Non-goals

- Unrequested module redesign, introduction of a **second authoritative** accounting engine, changes to existing posting semantics or SaaS billing features. The owner-approved unified Party identity and optional explicit manual settlement are an **in-scope, gated architectural addition**, not permission to rewrite legacy postings.
- Running the old GAS app and Workers as simultaneous independent writers to the same business state.
- Replacing D1 with Durable Objects or a non-Cloudflare DB without a separate architecture decision approved by the owner.
- Copying secrets, production credentials, private staff/customer information or live spreadsheet exports into GitHub.

### Hard business invariants (from source AGENTS.md)

- Products do not permanently belong to suppliers; purchases create supplier-specific stock lots.
- POS sells by product; FIFO order is **purchase date ascending, then lot ID ascending** across suppliers.
- Negative stock is represented by OVERSOLD lots; own/vendor/negative sourcing must remain distinct.
- Returns and edits restore/reverse their original physical and monetary effects **exactly once**.
- Authorize and apply the configured cash-session policy before applicable writes. Keep historical opening-balance semantics.
- Validate before writes; SQL transaction guards must also protect against concurrent state changes between preflight and commit.
- Non-administrators cannot create administrators; never remove the last administrator.
- Navigation visibility is not authorization; deleted rows must be excluded from ordinary selectors.
- Preserve native module edit/delete workflows; do not introduce a generic second accounting state or correction engine.
- Audits use the authenticated application user, not Google session identity.
- Existing permission module separation and existing invoice layout/print rules remain intact.
- Party relationship roles are not staff authorization roles. The Party identity is not a single current-due account: Customer AR/advance, Supplier AP/advance, Vendor payable/receivable, Owner capital/drawings, Lender payable, Borrower receivable and Payee identity remain distinct.
- Never merge original customers, suppliers, vendors, finance persons or expense payees by name/phone alone; keep verified legacy IDs, references, deletion history and review ambiguous identities.
- No automatic netting of receivable against payable, loan or equity balances; an explicit approved noncash offset is a separate exactly-once posting with no Cash/Bank/active Cash Session movement.

## 2. Verified source inventory and preliminary mapping

The source repository review identified **47 main .gs backend files, 37 HTML files, 49 configured database sheet groups**, and an extensive regression suite. These counts describe a reviewed snapshot, not a promise that the source will stay unchanged.

| Original | Target / action | Critical caveat |
|---|---|---|
| index.html, page partials, style.html, expenseCompactStyle.html | frontend/raw + build-generated dist | Resolve GAS include syntax at build time; preserve DOM and page styles |
| javascript.html | Shared client controller | Preserve serverCall(fnName, ...args) and response contract; replace google.script.run transport |
| Code.gs | Worker router and static asset behavior | Replace HtmlService/doGet/onOpen; spreadsheet menu is GAS-only |
| Config.gs | Typed schema manifest and app config | Do not blindly map all columns to TEXT |
| Database.gs | Async D1 repository | Replace Sheet/range methods; audit direct usages elsewhere; preserve legacy object-key contract |
| Utils.gs, Setup.gs | Runtime helpers, ID service, database migrations | Remove PropertiesService, Utilities, spreadsheet setup assumptions |
| Auth.gs, RoleManagement.gs, UserManagement.gs | D1-backed authentication and permissions | Migrate legacy password hashes safely; revocation, rate limits, last-admin protection |
| StockLots.gs, Products.gs, Bundles.gs, Purchase*.gs, Vendors.gs | Inventory and procurement services | FIFO, quantities, stock-lot writes, vendor shortage and bundle components must be safe |
| Sales.gs, SalesManagement.gs, DraftSales.gs, SalePayments.gs, Invoice.gs | POS and sales service | Posting journal, payment splits, drafts, edit/delete, invoice numbers and cash session |
| SalesReturn.gs, PurchaseReturn.gs, DeleteEngine.gs | Correction and reversals | Atomic reversal/restore and idempotency |
| CashBook.gs, BankBook.gs, CashSession.gs, Customer*.gs, Suppliers.gs, FinanceModule.gs, OpeningBalance.gs, PartyLedger.gs | Finance / ledgers | Balance direction, settlement discount, opening balance, cash/bank/party reconciliation |
| DayBook.gs, Reports.gs, Dashboard.gs, Settings.gs, UI.gs, Diagnostics.gs | Read models, UI configuration, diagnostics | Compare outputs with the original app on matching fixtures |
| appsscript.json | Wrangler config + deployment environments | Asia/Dhaka time handling must be explicit |
| tests/*, *.test.js | Adapted unit, contract, integration and E2E suites | Existing GAS mocks are not proof of D1 runtime correctness |

Create a machine-readable audit report at kickoff with each file, function, RPC entry, Google service reference, Sheet/range call, direct write, lock scope, and test coverage. Identify missing .gs functions for referenced RPCs before porting.

## 3. Target architecture and conventions

Browser (existing HTML/CSS/JS) -> same-origin POST /api/rpc -> Worker API allowlist/auth/validation -> ported domain modules -> async D1 repository -> D1 SQLite.

Workers Static Assets serves a compiled dist/index.html and any static assets. Cloudflare Worker handles /api/* before assets. Reuse the page include mechanism **during build**, not at request time. No runtime HTML template evaluation.

**Initial deployment assumption:** one existing business on a single D1 database with one binding named DB. Design schemas with clear future tenant isolation boundaries; **do not** claim automatic dynamic per-shop D1 binding without a dedicated multi-tenant ADR. A SaaS expansion is a separate gate.

Suggested structure:

    /
      README.md
      AGENTS.md
      docs/MIGRATION_PLAN.md
      docs/WORKSTREAMS.md
      docs/architecture/    (ADRs and diagrams)
      frontend/raw/         (unmodified source HTML/CSS/JS copies, provenance tracked)
      scripts/build-frontend.mjs
      scripts/audit-gas.mjs
      scripts/import-sheets.mjs
      src/index.js          (Worker fetch entry)
      src/rpc/registry.js   (explicit authorized RPC entrypoints)
      src/runtime/          (GAS replacement primitives)
      src/db/               (D1 repository, typed mapping, SQL builders)
      src/modules/          (ported .js business modules)
      migrations/           (numbered .sql files)
      tests/unit/
      tests/contract/
      tests/integration/
      tests/e2e/
      wrangler.jsonc

Use pnpm, a pinned Wrangler version, ESLint/static checking as appropriate, and GitHub Actions. Avoid hidden globals: explicitly export/import or use a controlled bundling transformation; no eval, dynamic invocation of untrusted function names, or uncontrolled global state.

### Unified Party identity and manual settlement — binding M02 architecture gate

The project owner approved **one Party identity with any combination of Customer, Supplier, Vendor, Owner, Lender, Borrower and Payee roles**, with **financial accounts kept separate**. The authoritative detail is [ADR-007](architecture/ADR-007-unified-party-relationships.md); see the [design spec](superpowers/specs/2026-11-14-unified-party-design.md) and [implementation tasks](superpowers/plans/2026-11-14-unified-party-migration.md).

| Proposed object | Required behavior |
| --- | --- |
| `parties`, `party_roles` | One identity, seven many-to-many roles. Descriptive Party roles do **not** convey user permissions. |
| `party_legacy_links`, `party_identity_review` | Preserve source-group + source-ID links for Customers, Suppliers, Vendors, Finance Persons, Expense Payees. Same phone/name creates a possible **review**, never automatic merge. |
| `party_accounts` and source-linked account entries | Individually reconcile Customer AR/advance, Supplier AP/advance, Vendor AP/AR, Owner capital/drawings, lender loan AP, borrower loan AR; payee has no balance by default. |
| Manual settlement documents and allocations | New disabled-by-default, explicitly permitted, approved, balanced, noncash source; stale/over-balance/duplicate requests cannot commit; reversal exactly once. |

**P2/M02-P:** Freeze the Party identity/role/link/account schema and import mapping **before creating remaining finance/customer/supplier/vendor/payee D1 tables**. The first three catalog tables under PR #6 are independent and do not complete this gate. Do not add a single per-Party current_due field or infer that two legacy records are the same individual.

**P3–P8:** Keep original customer/supplier/vendor/finance/expense identifiers and role-specific RPC behavior behind compatibility adapters. A transaction belongs to its original role account; do not dual-write two independently authoritative journals. Historical opening entries preserve their current historical baseline behavior without becoming today's cash movements.

**P8-S (optional settlement, later):** Require a reviewed allowed account-pair matrix, same verified legal Party/currency, documentary reason, dedicated server permission, approval-policy enforcement, exact available obligation allocations, atomic SQL preconditions, operation idempotency and source-linked reversal. Start with a reviewed Customer AR versus Supplier AP example; do not enable owner equity/loan or other offsets without separate legal/accounting policy review. A pure noncash offset never posts Cash/Bank or changes a Cash Session.

**P9–P11:** Add a compact read-only Party workspace *in addition to* existing modules, and prove all original gross balances and source references reconcile separately before enabling settlements or cutting over.

### RPC compatibility contract

- POST /api/rpc request body: { "fnName": "completeSale", "args": [token, payload] } for initial compatibility; auth transport may be hardened behind the adapter.
- Only entries in a static RPC registry may be invoked; enforce per-function authorization and role/module/action gates on the server.
- Preserve common response: { "success": true, "data": ... } or { "success": false, "message": ... } and meaningful HTTP status.
- Validate method, content-type, body size, function name, argument schemas, input lengths and rate limits. No reflection-based execution.
- Maintain same-origin policy, secure session transport, appropriate CSRF protection for cookie-authenticated writes, and no stack traces leaked to clients.
- Add contract tests comparing original and Worker output shapes for every migrated RPC.

### D1 repository design

D1's APIs are asynchronous. Every DB-dependent helper becomes async and every transitive caller must await it. Static code analysis must reject an unawaited Promise used as a row list/value. Do not hide asynchronous SQL behind fake synchronous functions.

- Generate a **reviewed** SQL schema based on CONFIG.SHEETS/CONFIG.HEADERS; use explicit types, nullability, unique constraints, indices, foreign keys where appropriate and CHECK constraints.
- Keep recognizable JS record object keys (e.g. 'Product ID') at the repository boundary to minimize business-code changes, while using normalized SQL identifiers internally.
- Replace physical Sheet row numbers with stable database primary keys. Introduce an import-only legacy row number / deterministic mapping where needed; never rely on SQLite row order as implicit _rowIndex.
- Preserve IDs and links from historical data. Future ID allocation uses atomic SQL counters/unique constraints; never MAX(id)+1 outside an atomic guard.
- Prefer indexed/filterable SQL queries over unconditional getAllRows_ reads for growing ledgers, while allowing a temporary compatibility helper for small/reference lists.
- Use parameter binding for values and allowlisted, escaped identifiers for SQL table/column names. Never interpolate user-controlled identifiers.
- Design D1 queries below platform limits (including bound parameters and per-request query budgets); bulk import in bounded chunks.
- Store phone numbers and codes as TEXT (preserve leading zeros), timestamps in documented UTC ISO format plus explicit Asia/Dhaka business-date policy. Test Bangla dates and day boundaries.
- Establish financial money representation and historical rounding rules **before choosing types**: SQLite REAL is not exact money. Prefer integer minor units for new canonical amounts, with verified conversion and parity against existing JS roundMoney_/discount behavior; do not silently alter amounts. Quantities/unit conversion also need explicit precision and tests.
- Define soft-delete / audit retention policy before any migration. Never cascade-delete posted financial history.
- Run versioned SQL migrations in CI locally and in a preview DB first; production migrations require backups and approval.

### D1 transaction design — blocking architecture gate

D1 batch() executes an atomic list of statements, but it is **not** a general interactive JavaScript transaction with arbitrary await/read/replan/await between statements. A preflight read followed by several individually awaited writes is unsafe.

Create a posting service that:

1. Authenticates, authorizes, checks cash-session/date/ownership, validates payload and obtains a unique operation ID.
2. Reads enough current data to compute a **candidate** FIFO/financial posting plan.
3. Builds a *single atomic database write boundary* containing source record, child rows, money/stock effects, counter allocation, journal state, and enforced SQL preconditions.
4. Applies version/CAS predicates, unique operation keys, SQL CHECK/trigger constraints or other SQL-level abort guards such that stale stock, changed balances, duplicate operation IDs and failed expected-row updates abort the **entire** batch (do not confuse 0 rows changed with a thrown error).
5. Retries a concurrency conflict with a fresh plan only when safe, using the **same idempotency key**; never retry an ambiguous write as a new operation.
6. Returns an existing committed result for a matching idempotent replay; returns Needs Review for an unknown/ambiguous state rather than reposting.

**Gate:** Prove completeSale and one reversal path survive concurrent requests, lost responses, duplicate clicks, mid-post errors, stale stock, and negative-stock/vendor exceptions. Do not migrate all financial modules until this gate passes. If D1 cannot uphold a particular workflow without unsafe compromises, halt and author a reviewed architecture decision rather than silently weakening the guarantee.

## 4. Phase-by-phase implementation with acceptance criteria

### P0 — Baseline and source audit (15–30 engineering hours)
- Pin exact source SHA, source file tree and migration provenance manifest; copy only approved app files into target.
- Run source tests; capture known failures instead of marking them passed. Inventory all public RPC names, data-access helpers, direct Google APIs (SpreadsheetApp, LockService, CacheService, PropertiesService, Utilities, Session, HtmlService, ScriptApp, DriveApp, UrlFetchApp), scripts, GAS globals, CSS includes and runtime assumptions.
- Record business parity fixtures: sample purchases/stock lots, multiple payment sales, customer/supplier/vendor ledgers, returns, soft-delete and correction effects, cash day, report totals.
- Create a parity matrix with owner, original entry, expected result, new entry and evidence.
- **Exit:** reviewed scope map; all high-risk paths have tests or documented missing tests.

### P1 — Worker shell and frontend parity (15–30 hours)
- Add Wrangler, package scripts, Workers Static Assets, local/preview config, /health route, structured error handling.
- Build script recursively resolves GAS includes from index.html and embeds CSS/scripts in the original order; reject unresolved, cyclic or duplicate includes.
- Port centralized serverCall() only; preserve page handlers, DOM IDs, charts, Bangla text, print CSS and navigation.
- Run Playwright desktop/tablet/phone visual snapshots, POS input tests, invoice print layout.
- **Exit:** original shell loads correctly from local Worker, no GAS dependency in browser runtime, nonfunctional RPC calls produce controlled errors.

### P2 — D1 schema and import tooling (30–55 hours)
- Review all 49 CONFIG schema groups, headers, ID prefixes, relationships, soft deletes and dates. Make table/column mappings explicit and review CHECK/UNIQUE/FK/index design.
- **Mandatory M02-P Party gate:** approve Party/role/legacy identity link/independent account mapping before migrating the remaining customer, supplier, vendor, expense-payee and finance SQL schemas. Preserve a human review queue for ambiguous identity matches; do not automatically merge on names/phones.
- Create numbered SQL migrations, local and preview databases, reversible *deployment* workflow (prefer forward fixes over destructive down-migrations).
- Export each Google Sheet in an approved offline process to sanitized, access-controlled files outside GitHub; retain raw snapshot and checksum.
- Implement import dry run, transforms, deterministic IDs, data-type validation, duplicate detection, dependency ordering, resumability and error reports.
- **Exit:** reproducible empty DB initialization; sanitized demo import passes row/column/fk/checksum verification.

### P3 — Runtime/DB compatibility + async propagation (65–120 hours)
- Move GAS source modules to .js and bundle with explicit dependency resolution.
- Replace Database.gs primitives (getAllRows_, findRow_, appendRow_, appendRows_, updateRowFields_, deleteRow_, settings) and direct Sheet/range access.
- Replace Utilities Date/UUID/digest/encoding, Session timezone, PropertiesService ID/config, CacheService (initially bypass nonessential caches), LockService transaction semantics and HtmlService entry.
- Refactor all transitive async call chains and update tests/mocks; lint against forgotten await, accidental Promise serialization, raw SQL interpolation and global mutable per-request state.
- Add source-ID to Party-ID compatibility resolution without altering legacy API data contracts or assigning new parties to anonymous cash sales. One authoritative posting path per domain.
- **Exit:** DB helper tests plus representative feature flow pass in local Miniflare/Wrangler and preview D1; no unimplemented GAS calls on migrated paths.

### P4 — Authentication, permissions, user management (25–45 hours)
- Port login, sessions, tokens, role/permission evaluation, password reset flows (if present), user/role CRUD and audit actor.
- Safely verify existing salted SHA-256 legacy credentials, then upgrade password hashing at next verified login to a strong appropriate KDF (or require secure reset). Do not bulk expose or log hashes.
- Enforce server-side authorization for all RPCs, session invalidation, login throttling, last-admin guard and explicit revoked-user handling.
- Keep Party roles separate from application roles; design dedicated Party link/merge review and settlement proposer/approver permissions (settlement disabled until policies and tests are approved).
- **Exit:** login/logout/revocation/role isolation/unauthorized RPC tests pass in Worker runtime.

### P5 — Inventory, procurement and suppliers/vendors (40–75 hours)
- Port Products, product settings, purchase/create/edit/delete, purchase items, StockLots, bundles, vendor/consignment flows, supplier ledger and settlements.
- Preserve FIFO date+lot ordering; verify no stock mutation in read-only planning. Test OVERSOLD, vendor shortages, bundled stock, adjustments, multi-unit and exact cost restoration.
- Apply optimistic checks and atomic multi-table posting. Guard edits/deletions against stale lots and dependent returns.
- Preserve Supplier/Vendor role-specific source references via verified Party links, without netting supplier and vendor obligations or changing purchases/FIFO.
- **Exit:** purchase-to-lot-to-sale stock fixture parity, inventory invariants under concurrency, supplier/vendor money reconciliation.

### P6 — POS, drafts, sales, split payments (45–95 hours)
- Port POS bootstrap, create/update/delete sale, draft conversion, invoice assembly, sale payments and posting journal.
- Implement atomic posting and idempotency for invoice + items + FIFO lot consumption + stock movements + customer dues + cash/bank + payment allocations.
- Verify payment split/change, active cash-session policy, discount/rounding, bank account validation, negative stock, source draft and receipt retry.
- A preferred Customer ID remains authoritative and traceable through Party links; do not force Party creation for anonymous cash sales or automatically offset supplier balances.
- **Exit:** exact amount/lot/balance parity; duplicate-operation and concurrency tests pass.

### P7 — Returns and correction/delete engine (35–65 hours)
- Port SalesReturn, PurchaseReturn, DeleteEngine and related native edit/delete operations.
- Preserve original lot-source restoration, dependent record checks, audit reasons, soft delete and exactly-once reversals.
- Test multiple invoice returns, partial returns, sale after edited lots, duplicate return, retry and readback from ledger/Daybook.
- Preserve exactly-once reversal of source-linked Party account effects; never erase legacy provenance or use auto-netting as correction.
- **Exit:** stock + all parties + cash/bank return to expected baseline after reversal fixtures.

### P8 — Cash, bank, finance, people and party ledgers (40–70 hours)
- Port CashBook, BankBook, CashSession, cash reconciliation, bank transfers, FinanceModule, finance person ledger, customers, suppliers, DayBook, opening balances and settlement discount.
- Differentiate historical opening amounts from present cash movements; follow the **existing approved cash-session policy** instead of inventing a universal rule.
- Enforce transaction-type dependent sign conventions, actor audit and no duplicate obligations.
- Map existing finance-person combined Owner/Lender/Borrower roles onto one Party but separate equity/loan/receivable subaccounts. Preserve independent Vendor Due/Receivable, expense Payee identity and signed historical opening balances.
- **M08-S:** Design (but do not enable by default) manual cross-role noncash settlements. Require eligibility/maker-checker policy, explicit actor approval, no cash/bank/session movement, D1 SQL-enforced all-or-nothing allocations, idempotency, audit and exact-once reversal; no automatic offsets.
- **Exit:** accounting invariant tests and daybook/cash/bank/customer/supplier/vendor cross-sums exactly reconcile.

### P9 — Reports, settings, admin and browser polish (25–45 hours)
- Port dashboard, reports, settings, users/roles and diagnostics; move any report-wide full-sheet scan to indexed SQL where needed.
- Verify matching totals, date ranges, deleted row filters, Bangla rendering, receipt/JPG/PDF printing and responsive tables.
- Add a non-destructive, role-aware unified Party view showing distinct accounts, historical role ledgers and informational-only net (without replacing existing screens).
- Add bounded cache only after correctness and invalidation are measured.
- **Exit:** report parity fixtures and cross-device E2E pass.

### P10 — Complete data rehearsal, security and operations (40–90 hours)
- Migrate a full approved snapshot into staging, reconcile every sheet/table, foreign key, ID, archived/deleted record, money ledger, quantity, lot cost and balance.
- Exercise load/concurrency, D1 query usage, Workers memory/CPU/subrequest budgets and indexes.
- Audit authorization, RPC injection, XSS/CSRF, sensitive data leakage, secrets, logging, failure modes and backup/recovery.
- Reconcile every legacy Party ID/link and each separate customer, supplier, vendor AP/AR, owner equity, loan AP/AR and payee relationship. Reject unresolved posted identity mappings and unintended netting; test manual offsets with real-D1 concurrency/failure injection.
- Test clean-state import twice for repeatability; verify backups and point-in-time recovery procedure in isolated staging.
- **Exit:** signed discrepancy report = zero unexplained material differences; complete go/no-go checklist approved.

### P11 — Cutover, observation and rollback (20–45 hours)
- Schedule a bounded write freeze on original GAS app, export final delta/full snapshot, record last writer/transaction/checkpoint, import and reconcile.
- Switch frontend traffic only after full parity and smoke tests pass. Keep old app read-only as an audit/rollback reference.
- Monitor error rate, D1 failures, duplicate operations, stock/ledger drift, response times and session failures.
- Monitor Party link mismatches, account-by-account reconciliation, settlement approval/replay and rollbacks; returning to GAS requires accounting for any post-cutover Party links and approved offset entries.
- Roll back **routing and writes**, not only frontend files, if high-severity error occurs. If D1 contains new production writes, replay/reconcile them before reverting to old backend; never switch back to stale Sheets and silently discard transactions.
- **Exit:** owner-approved production readiness, recovery drill evidence, and handover docs.

**Effort estimate:** approximately **400–800 engineer-hours** (planning range; individual phase ranges are rough and may overlap). First measured P0–P3 pilot determines a new forecast. This is not a fixed deadline.

## 5. Integration / pull-request sequence

Use small, gated PRs, not one mass conversion. Suggested titles/dependencies:

1. M00: source audit and frozen baselines (P0).
2. M01: Worker static frontend + RPC contract (P1), depends M00.
   **M02-P:** Approved Party design and identity/account mapping substream starts before finance-related M02 SQL; its reviewed schema and tests are mandatory dependencies for relevant M03/M05/M08 work.
3. M02: D1 schema and deterministic import pipeline (P2), depends M00.
4. M03: repository/runtime replacement and async graph (P3), depends M01+M02.
5. M04: authentication/permissions (P4), depends M03.
6. M05: stock/procurement/supplier/vendor (P5), depends M03+M04.
7. M06: atomic POS and sale posting (P6), depends M05.
8. M07: returns/delete/correction (P7), depends M06.
9. M08: finance/cash/bank/ledgers (P8), depends M06 + Party account mapping; cross-tested with M07. **M08-S:** optional disabled-by-default, policy-approved manual noncash Party settlement after M04–M08 accounting gates.
10. M09: reports/settings/dashboard (P9), depends M05+M08.
11. M10: full migration rehearsal/security/perf gate (P10), depends M07+M08+M09.
12. M11: production cutover/runbook (P11), depends M10 and owner approval.

Parallelizable after foundations: source fixture extraction, front-end build, initial schema review, security test harness. **Do not parallelize independent edits to shared repositories/transaction engine without branch ownership and interface contracts.**

Each PR includes: scope, source files mapped, affected RPCs and SQL tables, before/after contract, data migration impact, tests with output, concurrency/idempotency evidence if monetary, review checklist and rollback notes.

## 6. Verification and release gates

Required CI checks:
- Frontend build (all includes resolved), JS syntax, lint, no GAS runtime references in compiled app, no secrets, SQL migration validation.
- Original-to-Worker RPC contract and deterministic fixture parity.
- Unit tests for FIFO planner, rounding, idempotency, cash-session, permissions, return reversal.
- Local real D1 integration tests, preview D1 smoke tests, Playwright desktop/tablet/mobile + print CSS tests.
- Concurrency: 2 buyers / last lot, duplicate POST, conflicting edits, return/delete race, unknown write acknowledgment, retry after a lost response.
- Import: row counts per group, orphan checks, ID counter ceilings, phone zero preservation, timestamps, audit history, stock movement sums, unpaid and paid balances.
- Finance reconciliation: opening + inflow - outflow = closing by every applicable party/book; invoice totals match items/tenders/due; no duplicate money movement.
- Security: unauthenticated, unauthorized, disabled user, forged tenant/business, CSRF, body-size abuse, overlong names, raw fnName injection.
- Performance: measure p95/p99 endpoint latency and query budgets on representative realistic dataset, define numerical thresholds after baseline capture.

Release blockers: unexplained stock/financial drift, unprotected financial write path, unreconciled historical data, anonymous RPC execution, broken last-admin protection, missing rollback route or failing real D1 integration gate.

## 7. Data cutover and operational rules

- Do not put credentials/exported business data in git, fixtures or CI logs. Keep sanitized fixtures synthetic.
- Use distinct local, staging and production D1 databases and explicit --local / --remote migration commands. Never accidentally run a remote destructive command in CI.
- Use versioned migrations with GitHub PR approval; capture schema version and D1 Time Travel bookmark before destructive changes. Restore is destructive, so rehearse on staging and preserve independent exports.
- Production secrets live in Cloudflare secrets/environment bindings, not the repo.
- The importer must preserve audit actors, dates, deletion markers, lot IDs, counter floors, ledger balances and cross-links; export raw checksums before transformation.
- Decide system-of-record at cutover; never dual-write to GAS and D1 without a separately designed exact-once replication system.
- Minimum post-cutover dashboards: API errors, auth failures, D1 query failure, idempotency replay counts, stock mismatch, cash/bank differences, and migration anomalies.

## 8. Architecture decisions requiring sign-off

- ADR-001 D1 on Workers is mandatory for initial implementation; documented transaction guard strategy and escalation if unsafe.
- ADR-002 Single-shop D1 initial deployment, with a documented future multi-shop path (no premature tenant platform).
- ADR-003 Money and quantity precision, date/time and historical serialization rules.
- ADR-004 Auth transport (cookie vs compatibility token), session TTL, legacy credential upgrade and CSRF.
- ADR-005 SQLite row identity / legacy _rowIndex translation and historical ID allocation.
- ADR-006 Rollback and data reconciliation for writes after production cutover.

## 9. Definition of DONE

The Cloudflare site can complete all existing user-visible and privileged workflows with the same outputs, all business/stock/financial histories reconcile, Google API dependence has been removed from the new runtime, no unauthorized operations are possible, the full original source remains intact, all blocking tests and migration checks pass, and the owner has approved the cutover checklist.

**This document is a plan, not evidence of completed conversion or Cloudflare deployment.**

## 10. Platform documentation references

- D1 batch atomicity: https://developers.cloudflare.com/d1/worker-api/d1-database/
- Versioned SQL migrations: https://developers.cloudflare.com/d1/reference/migrations/
- D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- Workers static assets: https://developers.cloudflare.com/workers/static-assets/binding/
- D1 Time Travel: https://developers.cloudflare.com/d1/reference/time-travel/
