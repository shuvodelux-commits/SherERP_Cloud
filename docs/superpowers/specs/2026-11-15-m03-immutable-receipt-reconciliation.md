# M03 Immutable Receipt Reconciliation After Unknown D1 Outcome

**Date:** 2026-11-15; **owner:** M03-core.
**State:** Internal, reviewed source-port safety prerequisite; not a production receipt schema, financial writer or RPC.

## Problem and context
The frozen source is `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Merged PR #49 proves atomic synthetic D1 operation-ID replay, and merged #51 provides canonical WebCrypto SHA-256 intent fingerprints bound to the tenant and authenticated actor. A real Worker/HTTP response may be lost **after D1 committed**; treating a client-side error as rollback and repeating under a new ID can duplicate financial postings. An immutable receipt can disambiguate successful original commits versus conflicting intent. Absence, transient DB errors and malformed reads must **not** authorize retry.

## Schema decision and staging boundary
The repository's staging checks require exactly **2 applied migrations and 7 application tables**. Do not add a production migration, alter the reviewed M02 schema, add a preview D1 binding, or weaken guards. Demonstrate a strict **future receipt-table shape** with test-only DDL in `tests/fixtures/m03-receipt-schema.sql`, installed only inside an isolated local Workerd/D1 fixture:
- `operation_receipts(tenant_id,operation_id,actor_id,operation_type,payload_hash,result_ref,committed_at)` with composite `PRIMARY KEY(tenant_id,operation_id)`, nonempty IDs, SHA-256 hex, and test-only triggers prohibiting update/delete.
- Table has **committed receipts only**. Failed/uncommitted intents must not create a receipt; no `PENDING` rows masquerading as success.
- Receipt write must occur in the **same D1 batch as posting** by the eventual reviewed kernel; this PR only proves this with synthetic stock/journal and deliberately failed batches.

## Interface
`createOperationReceiptReconciliationAdapter(env).reconcile_(intent)`, where `intent` is EXACT `{tenantId,operationId,actorId,operationType,payload}`. It computes the hash internally using merged #51 `hashCanonicalOperationIntent`, validates operationId `^[A-Z0-9_-]{1,64}$`, uses one fixed, parameterized, tenant-scoped `SELECT ... WHERE tenant_id=? AND operation_id=? LIMIT 2` and validates result shape. It never accepts an untrusted payloadHash or SQL identifier, does not mutate or cache, and is not imported into `src/index.js` or RPC.

Results:
- `{status:'REPLAY',operationId,resultRef}`: exact matching committed tenant+op ID+actor+type+canonical hash, valid receipt.
- `{status:'CONFLICT',operationId}`: committed record found but any immutable actor/type/hash field differs.
- `{status:'NEEDS_REVIEW',operationId}`: no matching receipt found (including an unknown or interrupted original response); **not a green light to retry**.
- Malformed/ambiguous D1 results or binding errors throw an error with `NEEDS_REVIEW`, never success.

**Critical:** `tenantId` and `actorId` must come from the authenticated Worker context; merely accepting them as arguments does not establish identity. No production writer is exported. Receipt retention/tenancy, approval/audit, actual result IDs and reversal semantics need later design review.

## Proof and safeguards
- Node test with real `node:sqlite` executes only synthetic DDL, checks matching replay, conflicting content, tenant isolation, no row, fail-closed malformed results, validation, no mutations; duplicate immutable receipt/cannot delete verified.
- Real Workerd+D1 proof: fixed synthetic commit writes receipt+stock+journal in one D1 batch **then discards response**; reconciling the same operation is REPLAY and a modified one CONFLICT. A deliberately failed late journal insert must roll back both stock and receipt; its uncertain outcome returns NEEDS_REVIEW. Two tenants with same operation ID are distinct.
- Source unchanged; no remote D1/preview migration, no finance schemas, no public RPC. `PARALLEL-MODULE-READY` stays false.
