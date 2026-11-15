# M03 Exactly-One D1 Batch Guard — Design

**Date:** 2026-11-15
**Owner:** M03-core, shared D1 repository only
**Status:** Internal transactional safety prerequisite; not a sale/finance/stock production implementation.

## Problem
The migration's GAS `LockService` cannot be copied to a Cloudflare Worker. D1 `batch()` is a transaction, but an individual guarded `UPDATE ... WHERE ...` returning zero rows is ordinarily a *successful SQL statement*. If subsequent statements run, an operation can commit partial stock/ledger effects. M03 must prove that an affected-row count mismatch aborts **the whole** batch before considering financial posting, replay and reversal.

## Selected approach
A small, **internal** `createD1ExactlyOneBatchGuard(env).execute_(preparedStatements)` accepts a *nonempty* list of already-prepared D1 statements from a reviewed server-side module and executes each followed by a fixed `SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('invalid-json', '$') END` SQL assertion **inside the same D1 batch transaction**. If any statement changes zero or more than one rows, the assertion raises a SQLite error; D1 rolls back prior successful statements. For successful execution, assert response shapes and return results to the caller. The helper is not an RPC and does **not** accept SQL strings or caller-defined identifiers. It cannot turn unsafe SQL into correct posting; the caller must use safe DML with source/operation IDs and optimistic SQL conditions.

## Alternative approaches
- JS `await update.run()` then conditional insert: rejected, not transaction-safe.
- Inspect `meta.changes` after `DB.batch()`: rejected; a logically failed update may already have allowed other statements to commit.
- D1 `batch` and check `changes()` in the *following* UPDATE: rejected, a no-match in the following write could still commit the first claim.
- Fixed SQL assertion after each DML inside D1 `batch`: selected. The deliberate JSON parse failure is scoped to assertion mismatch; a valid match is inert. Source-safe local Workerd integration establishes the runtime behavior.

## Safety boundary
- Input `preparedStatements`: nonempty Array of already-bound D1 prepared statement objects exposing `all()`. The trusted caller supplies fixed reviewed SQL; raw SQL strings and HTTP payloads are not accepted. No arbitrary table names or SQL strings enter the executor.
- Each step must modify **exactly one row**; zero, duplicates, >1 changed rows abort. The caller owns operation-ID, fingerprint, unique source-ID constraints, authorization, original ledger sign and posting parity.
- If D1 returns malformed batch metadata after committing, the helper throws **unknown outcome; reconcile by stable operationId**, not “rolled back”.
- No shared operation ledger DDL is approved yet; verification uses **test-only synthetic tables** `proof_operations`, `proof_stock`, `proof_journal`, `proof_receipts` inside a nondeployable Worker with synthetic D1. No currency, real inventory, funds or customer Party data.
- Synthetic sale tests: one operation ID, one stock decrement, journal/receipt, repeated same ID, same-ID different fingerprint, parallel last-item requests, missing stock, journal failure, zero/2+ affected row fault, and zero mutations after failure.
- No production/public Worker imports, schema migrations, finance modules, legacy source files or remote D1 modifications.
- This is only the **transactional assertion mechanism**, not a complete M03 posting kernel, idempotency API, or PARALLEL-MODULE-READY approval.

**Original source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, especially `Sales.gs`, `CashSession.gs`, `StockLots.gs`, and `Database.gs`; governed by `AGENTS.md` and `docs/M03_PARALLEL_READINESS.md`.
