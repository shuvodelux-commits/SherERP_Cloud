# M03 — local Workerd/D1 atomic operation and idempotency acceptance contract

**Status:** Synthetic test-only reference, **not** the production ERP posting kernel. This PR contains no real Sales, Cash, StockLot, Party ledger, Expense or Payment schema and does not enable any RPC handler or D1 remote writes.

## Purpose

M03 needs a verified transaction structure before M05/M06/M07/M08 can safely write stock, tenders, invoices and ledgers concurrently. Cloudflare's current D1 Worker API `D1Database.batch()` documentation states that statements are executed sequentially in a **single SQL transaction** and a failing statement causes the batch to roll back. This contract tests that property under **actual local Workerd+D1**, rather than assuming SQLite's stand-alone behavior implies Worker binding parity.

Documentation: https://developers.cloudflare.com/d1/worker-api/d1-database/#batch

## Synthetic fixture, never production schema

`tests/fixtures/m03-transaction-contract.mjs` and the separate `wrangler.m03-transaction-test.jsonc` exercise exactly three synthetic tables created at test time only:

- `synthetic_stock(account_id,available)`: one fictitious `counter` account, nonnegative **integer units**, not cash or currency.
- `synthetic_operations(operation_id,payload_hash,units,state)`: one immutable replay key/intent digest per synthetic operation.
- `synthetic_movements(operation_id,units)`: one linked movement per successfully committed synthetic operation.

No `migrations/**` changes, and no tenant, accounting period, lot cost, Party or financial account is inferred from these names.

## Transaction pattern under test

One `DB.batch` contains four fixed, parameterized statements:

1. `INSERT ... SELECT ... ON CONFLICT DO NOTHING RETURNING` to reserve a new operation ID **only if** synthetic stock is sufficient. The operation row is marked `COMMITTED` within the transaction, not visible outside until the complete batch commits.
2. `UPDATE synthetic_stock` decrements only if `changes()=1` from the new operation insert, the stored intent matches, and stock is still sufficient.
3. `INSERT synthetic_movements ... WHERE changes()=1` writes one movement only after the preceding successful stock update. A constraint or trigger failure here rolls back earlier statements.
4. Read the stored operation inside the **same transaction** to distinguish first commit, identical replay, conflicting replay and insufficient stock.

Public-facing status labels in the **test fixture** are `COMMITTED`, `REPLAY`, `CONFLICT` and `DECLINED`. Invalid result shapes refuse success with `NEEDS_REVIEW`; uncertain network outcomes must be reconciled against the *same* operation ID, never automatically resubmitted under a new ID.

## Evidence and hard limits

Tests cover first successful commit, identical replay with zero extra movements, conflicting payload for the same ID, insufficient stock with no reserved operation, two concurrent last-unit claims where one declines, a trigger-induced movement failure proving **full Workerd/D1 rollback**, input validation before SQL, and the 404 test Worker public route boundary.

The test-only Worker has a synthetic D1 UUID, no routes and no Cloudflare deployments. `tests/integration/m03-workerd.spec.mjs` imports this isolated suite so existing PR-only CI exercises it. Do not add the fixture to `src/index.js`, `src/rpc/**`, production migrations or Cloudflare preview/prod configuration.

**Important remaining gates:** This does **not** prove actual invoice/POS postings, FIFO lot consumption, split tenders, accounting balancing, caller canonicalization, global operation IDs, server-side session/RBAC, audit records or exact-once reversal. Real source-accurate M02 schemas and M04 authentication precede those modules. In particular, synthetic `payload_hash` here is a fixed test digest, **not** an approved serialization/hashing contract for financial requests.
