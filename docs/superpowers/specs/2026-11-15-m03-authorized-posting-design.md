# M03 Same-statement D1 Posting Authority — Synthetic Contract

**2026-11-15 — M03 shared posting kernel preflight.**
**Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; no source rewrites.
**Status:** Nondeployable synthetic test fixture, not real ERP transaction logic. Preserve `migrations/**` and inert preview.

## Context
M03 PRs #49, #51, #54, #58, #61 proved isolated stock/receipt/reversal/readback. M04 PRs #53, #55, #57 prove local auth. No shared D1 posting kernel yet guarantees all effects are authorized inside the same database transaction. A stale JS auth preflight cannot confer posting authority.

## Decision
Build a **test-only** `createSyntheticAuthorizedPostingContract(DB).post(request)` in `tests/fixtures/m03-authorized-post-contract.mjs`; exact request keys `{tokenHash,tenantId,actorId,operationId,units,amount,now}`. Caller must be trusted Worker code; public routes never pass attacker identity. Actor/tenant are **checked against the current D1 session** in the guarded INSERT, not taken as proof of authority.

Use a local-only synthetic schema for roles, users, sessions, stock, committed receipts, and movements. `synthetic_auth_post_receipts` unique `(tenant_id,operation_id)` stores actor, class, canonical SHA-256 fingerprint, amount, units, original result ref. A single D1 `batch()` executes:
1. `INSERT INTO synthetic_auth_post_receipts SELECT ... WHERE EXISTS (... current valid session/user/role with matching authority versions and can_post) AND EXISTS (stock available>=units) ON CONFLICT DO NOTHING RETURNING ...`. This **single write statement** is the SQL authorization boundary. An AFTER INSERT trigger performs stock decrement (checking exactly one row) plus inverse movement insert. Missing stock or late movement failure **aborts both** with SQLite transaction atomicity; no mutable JS update between statements.
2. An authority-guarded `SELECT` by tenant/op ID for exact-session actor replay verification; no receipt details for revoked/expired/cross-tenant/other actor. A changed intent returns `CONFLICT` without reference, identical committed intent `REPLAY` with original result reference. No receipt returns `DECLINED` (not permission to retry blindly after uncertain delivery). Malformed batch/missing DB raises `NEEDS_REVIEW`.

An acknowledged success is `COMMITTED`, not a deployable business receipt. A synthetically lost HTTP response is recovered using original operation ID in same authorized session. Revocation before the SQL write prevents both receipt and stock. Concurrent revoke/write executes serially: either write commits before revoke or deny; revoked sessions cannot post afterward. Permission downgrade/reenable and user disable/reenable cannot resurrect old sessions owing to auth_version bump triggers.

## Scope and exclusions
This is **one synthetic SKU and integer unit**, not accounting/ledger/Cash Session/FIFO/oversold/vendor/multi-unit/Party settlement, no exchange rate or money computation. `amount` is an exact decimal *string*, not floating point. No `src/db/**` code, public RPC, production auth tables or migrations changed. No changes to source (84 files), user UI or Cloudflare bindings. This is not `PARALLEL-MODULE-READY`.

## Proof
Node SQLite TDD RED and GREEN; real local Workerd/D1 TDD RED and GREEN; authority revoked/expired/role and user version, same actor different sessions, two concurrent last-unit operations, same operation ID replay, changed amount/actor/operation collision, cross tenant IDs, forced journal-failure rollback, no unauthorized receipt existence leak, malicious HTTP body ignored. All full CI tests including M01 browser and Party SQL must pass.
