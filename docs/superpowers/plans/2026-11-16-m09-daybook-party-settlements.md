# M09 Day Book Party Settlements — Superpowers GitHub-first TDD plan

> Follow `superpowers:test-driven-development` and `superpowers:verification-before-completion`. Keep production implementation absent until a failed GitHub Actions RED run is observed. Use KISS and one owner-reviewed draft PR.

**Objective:** Match frozen Customer Payment, Customer Advance Refund and Supplier Payment Day Book source rows, without changing financial postings or authorization.

**Contract:** `projectDayBookPartySettlements({customerLedgerRows,supplierLedgerRows},isAdmin=false,includeDeleted=false)` is a pure read model. The caller must supply two complete, shop-local-normalized arrays from approved internal M04 authentication and tenant-scope read, not client flags. Output original Day Book shapes in source-section order. Invoice/expense/return/finance source rows remain outside scope.

**Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`: `DayBook.gs` three settlement blocks, `SettlementDiscount.gs` original payment/discount helpers, `Utils.gs::roundMoney_` and Bank/Mobile method semantics.

### Task 1: Design and RED oracle
**Files:** this plan, `docs/superpowers/specs/2026-11-16-m09-daybook-party-settlements-design.md`, `tests/m09-daybook-party-settlements.test.mjs`.
- [ ] VM execute byte-original source blocks plus frozen settlement helpers; compare exact entire object key order, module, money columns, timestamps and navigation.
- [ ] Test current payment/discount vs legacy Credit fallback; refund Debit precedence/Payment Amount fallback; mobile bank methods; deleted Admin rows; source ledger group filtering, immutable inputs, malformed/incomplete data, prototype/duplicate IDs and unchanged public RPC.
- [ ] GitHub-only new feature branch; test-only commit, draft PR, capture actual failing Actions logs with missing implementation assertion (not source-oracle failures).

### Task 2: Minimal GREEN
**File:** `src/modules/daybook-party-settlements.js`.
- [ ] Validate two complete arrays and records before filtering, strict canonical source dates/timestamps and finite monetary values for relevant entries. Check ID uniqueness per ledger.
- [ ] Implement original per-section mapping and helper money rounding, keep exact row shape/mappings and signed amounts; no D1, RPC, posting or date conversion.
- [ ] Run exact SHA Actions complete Node/source audits, browser and Workerd regression when applicable; fix findings with minimal test-first changes. Do not misrepresent missing real D1 settlement read evidence.

### Task 3: PR review
- [ ] Add RED/GREEN runs and counts, exact changed-file inventory, no schema/RPC/production writes, rollback, incomplete adapter/role/tenant gates and status of open PR #369.
- [ ] Compare to newest main; leave PR draft/unmerged and require owner approval.
- [ ] Follow-up: Expense, Finance, Bank Transfer and Stock Adjustment Day Book read models, then complete authenticated D1 source adapter and financial reconciliation.
