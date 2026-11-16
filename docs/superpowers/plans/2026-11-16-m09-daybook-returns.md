# M09 Day Book return rows — Superpowers TDD implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL superpowers:test-driven-development and superpowers:verification-before-completion. Execute test-first in GitHub and verify actual RED Actions logs before implementing; then minimal GREEN and exact-head regression evidence.

**Goal:** Match original Sales and Purchase Return Day Book presentation and cash/credit accounting classification without changing native financial posting.

**Architecture:** Pure `projectDayBookReturnRows(snapshot,isAdmin,includeDeleted)` accepts three *complete, already authorized* source arrays (Sales Returns, Purchase Returns, entire Supplier Ledger), derives Supplier Credit from the source's `Type` and `Reference` and maps to the original `dayBookRow_` output. No D1/RPC/I/O/ambient time.

**Tech Stack:** Node 22 ESM, Node test, Node VM frozen-GAS code as independent oracle, GitHub Actions; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-16-m09-daybook-returns-design.md`

## Constraints
- Authority `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, original `DayBook.gs` read-only.
- Sales Return Mobile Banking and unknown source refund methods are **Store Credit display**, not new bank mutations.
- Purchase Return cash/credit decision uses complete Supplier Ledger including deleted credit rows, never a fabricated Refund Method.
- No M07 return posting or reversal edits, M08 financial accounting writes, D1 schema/API, M03/M04 login/roles, source UI or production deploy.

## Task 1 — RED independent oracle
- [ ] Create design/plan and `tests/m09-daybook-returns.test.mjs` (all test-only).
- [ ] VM execute exact pinned Sales Returns and Purchase Returns source slices including `dayBookRow_` map; test Cash, Bank, Store Credit, Supplier Credit, backdated, deleted, metadata, preservation, invalid snapshots.
- [ ] Open draft PR, collect actual test-only Actions RED SHA/run/count/reason before implementation.

## Task 2 — minimal GREEN module
- [ ] Create `src/modules/daybook-returns.js` only after verified RED.
- [ ] Validate own data, complete canonical rows/ledger, actor flags, unique IDs, finite money and safe refs; project exact original shape and source order.
- [ ] Verify full Node and source build, selected original UI Chromium & M04/Workerd regression via GitHub Actions; state any checks pending/failing precisely.

## Task 3 — PR owner review
- [ ] Record RED and GREEN Actions links/counts, four-file inventory, no DB/RPC/source changes, no source import/posting and rollback.
- [ ] Re-check current main, PR mergeability and concurrent M07 Return credit work before merge. Owner decides merge; assistant never auto-merges.
- [ ] Remaining work: Customer/Supplier settlement, Expense, Finance, Bank Transfers, Stock Adjustments, complete D1 read snapshots and posted money reconciliation for full Day Book.
