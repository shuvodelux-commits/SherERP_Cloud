# M03 — real D1 idempotent batch contract, synthetic only

**Decision:** Build an isolated local Workerd/D1 acceptance fixture to validate the transaction pattern needed by future inventory/POS/finance posting, but **not** port or activate any business posting until source-faithful M02 schemas, M04 auth, ledger account-kind design and posting/reversal approvals are complete.

## Synthetic schema and contract
Use **test-only**, in-memory/local D1 tables (created after starting a separate synthetic Wrangler Workerd binding, never in `migrations/`):
- `synthetic_stock(account_id TEXT PRIMARY KEY, available INTEGER NOT NULL CHECK(available >= 0))`
- `synthetic_operations(operation_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, units INTEGER NOT NULL CHECK(units>0), state TEXT NOT NULL CHECK(state='COMMITTED'))`
- `synthetic_movements(operation_id TEXT PRIMARY KEY REFERENCES synthetic_operations, units INTEGER NOT NULL CHECK(units>0))`.

Test-only `tests/fixtures/m03-transaction-contract.mjs`: export `createSyntheticD1PostingContract(DB).post({operationId,payloadHash,units})`. Fixed account ID `counter` and positive integer units. No caller-selected table, Party or financial account. Payload hash stands in for a canonical intent digest; this fixture does **not** define the real canonicalization or accounting model.

One `DB.batch` uses four prepared statements: (1) insert operation only if currently sufficient stock, ignoring existing ID conflict, with `RETURNING`; (2) conditional stock decrement only if `changes()===1` from new operation insert, matching source intent; (3) movement insert only if immediately previous stock decrement changed one row; (4) lookup operation to resolve replay or conflict, inside same snapshot. SQL result validation classifies `COMMITTED`, `REPLAY`, `CONFLICT`, `DECLINED`. Malformed/out-of-contract batch results fail closed as `NEEDS_REVIEW`, never transparently retry with a new ID.

## Acceptance
- Same operation ID/intent retried returns `REPLAY` with no extra stock movement.
- Same operation ID with conflicting units/hash returns `CONFLICT`.
- Insufficient stock returns `DECLINED` with no op record.
- Concurrent different IDs competing for last stock cannot both commit.
- A trigger-injected journal failure rolls back operation record and prior stock decrement in real Workerd/D1.
- Missing DB batch, bad IDs/hashes/units rejected without SQL.
- No public Worker/RPC registration or real D1 migrations, local fixture has synthetic UUID and no public routes.

Reference: Cloudflare D1 Worker API `batch()` documentation (multiple prepared statements execute in one transaction, rollback on failure). Distinguish from historical old `@cloudflare/d1` package docs.

**Limitations:** Test harness only; no monetary values, inventory lots, split tender, reversal, authenticated actor, multi-tenant scopes or real operation-hash/canonicalization. These remain blocking for production ERP posting.
