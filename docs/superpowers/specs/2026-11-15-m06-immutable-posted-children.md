# M06 — Immutable posted sale-child rows (synthetic local D1 proof)

**Authority:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `AGENTS.md`, `docs/WORKSTREAMS.md`, M06 original posting, M07 original returns and audited native correction contracts, ADR-007.

## Problem
The merged M06 synthetic Workerd/D1 proof protects `m06_invoices` against UPDATE/DELETE. However, its invoice's posted `m06_sale_items`, `m06_stock_movements`, `m06_payment_children`, `m06_cash_book`, `m06_bank_book` and `m06_customer_ledger` remain directly mutable after commit. This demonstration would leave a tamper pathway despite the immutable header.

## Minimal design
Keep original invoice child effects write-once in the **test-only** SQLite fixture: add BEFORE UPDATE and BEFORE DELETE abort guards to each of the six posted child tables. These rows are only created inside the existing guarded invoice INSERT trigger. Preserve native M07 corrections via separately audited reversal operations; **do not** implement reversal in this PR.

## Acceptance
- A synthetic posted Bank + Cash + Customer-due invoice creates rows in all six protected child tables.
- Direct same-value UPDATE and DELETE of each row fail at SQL level; the snapshot of invoice, stock, Cash/Bank and Customer balances remains unchanged.
- Existing setup/reset of the isolated Workerd/D1 tests still works, using deliberate fixture-only trigger drops/recreates; posting, replay, concurrency, draft and failure-injection regression tests remain green.
- No `src/`, `migrations/`, original source, public RPC, production/staging DB, Workers bindings or live financial behavior changes.
- Superpowers RED tests precede GREEN SQL fixture, with exact-head GitHub CI evidence. Leave PR unmerged for owner review.

**Scope:** `tests/integration/m06-sale-posting-workerd.spec.mjs`, `tests/fixtures/m06-sale-posting-schema.mjs`, this spec and the companion plan.