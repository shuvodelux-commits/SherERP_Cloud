# Unified Party Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** During migration to Workers/D1, introduce one Party identity with seven combinable roles, retain independent financial accounts and legacy balances, and eventually allow *explicit authorized* manual cross-role noncash settlements.

**Architecture:** Adopt an identity/role/legacy-link layer before porting financial tables. Each legacy transaction still belongs to its original role-specific account and source ID. Introduce derived/reconciled Party views before any new settlement writer; settlement is last, depends on verified M04–M08 auth and atomic accounting.

**Tech Stack:** Cloudflare Workers, D1 SQLite (versioned SQL migrations), JavaScript ES modules, Node.js tests + real Wrangler/D1 integration tests + Playwright.

**Spec:** `docs/superpowers/specs/2026-11-14-unified-party-design.md`; `docs/architecture/ADR-007-unified-party-relationships.md`.

## Global Constraints

- Source is frozen `shuvodelux-commits/Mohim_ERP` commit `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; source code, live GAS deployment and production Sheets are not modified.
- Preserve original front-end modules and original RPC contracts until a feature is individually tested and approved.
- Separate Customer/Supplier/Vendor/Owner/Lender/Borrower/Payee roles and account balances; no automatic netting.
- Store BDT money using reviewed exact precision/rounding, not float financial accumulation; explicitly review multi-currency/legal-entity scope.
- Every mapping preserves original source IDs, references and history; no name/phone-only merges, no auto-created party for anonymous cash sales.
- D1 is async. All monetary operations must use atomic SQL enforcement, idempotency and exactly-once reversal; do not rely on JS-only preflight reads.
- A pure manual offset has **no** Cash Book, Bank Book or Cash Session movement; any real money transfer is its own authorized writer.
- Cross-role settlement is **disabled** until eligibility matrix, authorization/approval and concurrency tests are reviewed and passed.
- Owners' equity cannot silently become lender loans; Payee does not mean an accounts payable balance.

## Review Focus

- Duplicate/ambiguous names and phone numbers; source IDs must never be silently conflated.
- Existing negative customer/supplier balances and two-way vendor obligations; account sign and advances must remain intact.
- Historical finance openings and soft deletes; do not create present-day cash activity or lose deleted history.
- Client-supplied Party ID or approval flag; enforce independently from authenticated actor and selected source account.
- Duplicate or concurrent manual offsets, interrupted responses and reversal after subsequent allocations; never double-post.

---

### Task 1: Party identity/role/legacy contract inventory (M02-P0)

**Files:**
- Create `docs/baseline/party-contract-inventory.md`
- Create `tests/fixtures/party-identity-mapping.synthetic.json`
- Test: `tests/contract/party-legacy-inventory.test.mjs`

**Interfaces:**
- Consumes frozen `Config.gs`, `Customer.gs`, `Suppliers.gs`, `Vendors.gs`, `FinanceModule.gs`, `Expense.gs`, `OpeningBalance.gs` and source RPC response shapes.
- Produces original key/ID/account/sign/source-reference matrix and sanitized ambiguity fixtures.

- [ ] **Step 1 RED:** test that every source master group and ID column is inventoried: `CUSTOMERS.Customer ID`, `SUPPLIERS.Supplier ID`, `VENDORS.Vendor ID`, `FINANCE_PERSONS.Person ID`, `EXPENSE_PAYEES.Payee ID`; fail with missing inventory.
- [ ] **Step 2 GREEN:** generate the matrix from the pinned schema and source functions, including finance roles and separate vendor Due/Receivable. Record discrepancies and non-unique historical IDs.
- [ ] **Step 3:** test duplicate names, shared phones, missing Person ID and legacy finance-name aliases, inactive/soft-deleted original roles, mixed Owner+Lender+Borrower.
- [ ] **Step 4:** run `node --test tests/contract/party-legacy-inventory.test.mjs`; expect all pass.
- [ ] **Step 5:** commit only source-faithful inventory and synthetic fixture. This does not modify the old ERP.

### Task 2: Party schema and source link constraints (M02-P1)

**Files:**
- Create next available numbered migration under `migrations/` (number determined **after** M02 PR #6 and other migrations are resolved)
- Create `src/db/party-schema-map.js`
- Test: `tests/integration/party-schema.test.mjs` (real local D1) plus narrow SQLite constraint tests

**Interfaces:**
- Produces `parties`, `party_roles`, `party_legacy_links`, `party_identity_review` and FK/index/unique constraints; semantic role values in ADR-007.

- [ ] **Step 1 RED:** test one Party with all seven roles, distinct parties sharing a phone, same name with different IDs, source IDs scoped by `source_group`, and FK protection.
- [ ] **Step 2 GREEN:** implement minimum audited migration using reviewed identity field types and constraints. No finance tables or balances in this task.
- [ ] **Step 3:** tests require denied unknown role, duplicate legacy source link, invalid references, and preservation of inactive-role historical identity.
- [ ] **Step 4:** run SQL migrations against actual local Wrangler D1 and inspect schema; not only mocked DB or Node SQLite.
- [ ] **Step 5:** commit PR with schema/source mapping review and rollback notes.

### Task 3: Deterministic identity backfill and human-review queue (M02-P2)

**Files:**
- Create `scripts/dry-run-party-import.mjs`
- Create `src/db/party-import-plan.js`
- Test: `tests/contract/party-identity-import.test.mjs`, `tests/integration/party-import.test.mjs`

**Interfaces:** `planPartyImport(sourceSnapshot, verifiedLinks): {links, proposedParties, reviewItems, reconciliation}` with **no DB writes**; actual importer is a separate approved operation.

- [ ] **Step 1 RED:** same phone/name across customer and supplier must yield ambiguous review, not automatically the same Party.
- [ ] **Step 2 GREEN:** deterministic source-to-party IDs, mapping audit, original record provenance and review queue; use only explicitly verified links to combine existing masters.
- [ ] **Step 3:** tests cover idempotent dry-run, stable references, blank/duplicate legacy IDs, soft deletes, finance-person role combinations, expense payee identity and selected Customer IDs.
- [ ] **Step 4:** verify PII-free reports and checksum/row-count parity; import real data only through approved, private, staging-only process.
- [ ] **Step 5:** commit. Fail closed on unresolved **posted obligation** mappings before finance cutover.

### Task 4: Separate accounts and read-only reconciliation (M02-P3 / M03)

**Files:**
- Create reviewed account-kind migration and `src/db/party-accounts.js`
- Create `tests/integration/party-accounts.test.mjs`
- Modify domain repositories only through adapters defined by original source contracts.

**Interfaces:** `getPartyAccounts(partyId)` returns **separate** receivable/payable/advance/owner-equity/lender/borrower positions per account/currency/contract; `getPartySummary(partyId)` may provide explicitly labeled non-posting net.

- [ ] **Step 1 RED:** one Party simultaneously owes and is owed through customer/supplier/vendor/loan/owner roles; test that balances remain independent.
- [ ] **Step 2 GREEN:** source-linked account types, original contract references, status and documented debit/credit sign mapping. No `party.current_due` aggregate field.
- [ ] **Step 3:** tests cover customer advances, supplier advances, independent vendor AP/AR, owner capital/drawings vs loans, payee without debt, inactive roles, historical opening balances.
- [ ] **Step 4:** run baseline parity for each legacy ledger, source ID, opening amount, corrections and cash/bank side effects on real local D1.
- [ ] **Step 5:** commit adapter only after there is one *authoritative* posting path; avoid simultaneous independent legacy/new ledger writes.

### Task 5: Permissions and native workflow contract (M04–M08)

**Files:**
- Modify only relevant approved `src/rpc/registry.js`, `src/modules/**`, `src/db/**` once those modules have been ported.
- Test: `tests/contract/party-rpc-parity.test.mjs`, `tests/integration/party-authorization.test.mjs`

**Interfaces:** Existing `completeSale`, purchase, vendor, expense, finance and ledger RPCs keep response contract; new Party endpoints use a strict allowlist and server-side permission checks.

- [ ] **Step 1 RED:** existing POS customer ID remains stable after party link/contact update; original supplier/vendor/finance/payee workflows return compatible data.
- [ ] **Step 2 GREEN:** adapt source-to-party resolution internally while preserving legacy keys and UI; do not change frontend DOM/layout.
- [ ] **Step 3:** deny unauthorized role creation, party identity merge, selected-account manipulation and ledger access; Party roles grant no staff RBAC.
- [ ] **Step 4:** run real D1 transactional integrity and end-to-end browser tests for each migrated source module.
- [ ] **Step 5:** commit only with per-module owner sign-off and full reconciliation evidence.

### Task 6: Unified read-only Party workspace (M09)

**Files:**
- Create `src/modules/party-workspace.js` and an additive UI workspace only after baseline visual parity is proven.
- Test: `tests/e2e/party-workspace.spec.js`, `tests/contract/party-summary.test.mjs`

- [ ] **Step 1 RED:** expected role badges, individually labeled balances, role-specific ledgers and non-posting net summary; cash sale remains party-free.
- [ ] **Step 2 GREEN:** add compact Party view without redesigning/removing original Customer/Supplier/Vendor/Finance screens.
- [ ] **Step 3:** verify mobile, keyboard/touch, Bangla/English and permissions, including hidden/unavailable accounts.
- [ ] **Step 4:** commit only after original and new UI workflows pass side by side.

### Task 7: Explicit manual noncash cross-role settlement (M08-S, gated)

**Files:**
- Create approved settlement-specific D1 migration, `src/modules/party-settlement.js`, `src/db/party-settlement-posting.js`
- Test: `tests/integration/party-settlement-atomicity.test.mjs`, `tests/integration/party-settlement-authorization.test.mjs`

**Interfaces:** `proposePartySettlement(partyId, sourceAccountId, targetAccountId, sourceObligationRefs, targetObligationRefs, amountMinor, reason, operationId)`; `approvePartySettlement(settlementId, approvalContext)`; `reversePartySettlement(settlementId, reason, operationId)`. These are **proposed interfaces**, not public RPCs until reviewed.

- [ ] **Gate 0:** written eligible account-type pair matrix, consent/legal evidence policy, currency/legal-entity scope and maker-checker/threshold rules approved. If absent, DO NOT activate.
- [ ] **Step 1 RED:** unauthorized or self-approved (where disallowed), cash-affecting, over-allocated, unreviewed-pair, different-identity/currency and concurrent duplicate offset attempts must fail.
- [ ] **Step 2 GREEN:** implement disabled-by-default flow with one atomic **balanced noncash** posting, SQL precondition guards, unique operation key, source-linked allocations and immutable audit.
- [ ] **Step 3:** prove Dr AP / Cr AR example (৳3,000) reduces two gross balances only, leaves separate lender loan unchanged, **zero cash/bank/cash-session effect**.
- [ ] **Step 4:** real D1 tests: duplicate submit, ambiguous network result, lost response, concurrent settlement, changed obligation, failure-injected batch abort, exactly-once permissioned reversal.
- [ ] **Step 5:** enforce reconciliation and owner approval before enabling the feature. Do not introduce automatic netting or a competing generic correction engine.

### Task 8: Staging rehearsal and cutover checks (M10–M11)

**Files:** `docs/reconciliation/party-cutover-checklist.md`; staging importer/check tools; operational runbook.

- [ ] **Step 1 RED:** detect unresolved posted-transaction links and mismatched per-account money/advances despite matching display-only net.
- [ ] **Step 2 GREEN:** full privately held snapshot matching of 5 source Party master groups, role combinations, native source transactions, ledger totals, opening balances and audit history.
- [ ] **Step 3:** verify rollback includes identity links and any post-cutover settlement postings; never route to stale Sheets and lose writes.
- [ ] **Step 4:** owner reviews signed discrepancy report; zero unexplained material differences before production.

## Ordered handoff

**First:** add ADR/design/plan and master migration dependencies to GitHub (documentation-only review).  
**Then:** M02-P0/P1/P2 schema and dry-run identity mapping, M03 and M04 adapters/authorization, M05–M08 role account readers and writers, M09 additive Party workspace, M08-S manual offset **only after policy + accounting gates**, M10/M11 reconciliation and cutover.

This plan does **not** certify any actual schema migration, party record creation, settlement, or full ERP function as completed.
