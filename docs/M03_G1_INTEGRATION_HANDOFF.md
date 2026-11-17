# M03 G1 — Shared D1/RPC integration handoff (preflight v0.1)

**Status:** REVIEW-ONLY INTERFACE INVENTORY; **not** a frozen production writer interface.  
**Workstream/owner:** M03 single shared D1/schema/RPC/posting integrator; issue [#22](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/22), coordination [#456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456).  
**Audited base:** `main@1f068fc3c30c625446c560364fb872ae68cb8bc1` (2026-11-17).  
**Source of business truth:** immutable `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; never alter source GAS/Sheets.  
**Decision:** Parallel *preparation* is ready; **PARALLEL-SHARED-TRANSACTION-WRITES remains BLOCKED** per `docs/PARALLEL_EXECUTION.md` and `docs/M03_PARALLEL_READINESS.md`.

## 1. What actually exists on main (not an authorization to post)

| Current private path / test evidence | Verified interface shape | Evidence boundary and unresolved gate |
| --- | --- | --- |
| `src/db/d1-binding.js`, `src/db/legacy-catalog-read.js`, `src/db/product-catalog-d1-read.js`; `tests/m03-d1-readonly.test.mjs`, `tests/m03-product-catalog-d1-read.test.mjs` | Explicit `await`-based source-shaped catalog reads via `env.DB`, no fallback | Narrow private readers; **not** full 394 affected-source-function async closure |
| `src/db/atomic-source-id-issuer.js`; `tests/m03-atomic-source-id-issuer.test.mjs` | `createAtomicSourceIdIssuer(env, trustedTenantId).allocate_({idKey,operationId,intentHash})` returns `{id,sequence}` after SQL claim and receipt readback | Uses `synthetic_m03_*` schema/triggers; it is **not** a production source-ID allocator |
| `src/db/atomic-source-id-posting-proof.js`; `tests/m03-id-post-atomic-proof.test.mjs` | `postSale_({operationId,intentHash})` checks original ID and synthetic journal after one SQL-triggered claim | Exactly one fictitious SKU/unit; no real FIFO, split tender, Party, Cash or authenticated actor |
| `src/db/exactly-one-batch.js`; `tests/m03-exactly-one-batch.test.mjs` | `createD1ExactlyOneBatchGuard(env).execute_(preBoundStatements)` asserts each SQL statement changed exactly one row **inside** the D1 batch | Low-level helper accepts only pre-reviewed bound SQL; **does not** by itself authorize or implement idempotency |
| `src/db/operation-intent-fingerprint.js`, `src/db/operation-receipt-reconcile.js`; `tests/m03-operation-intent-fingerprint.test.mjs`, `tests/m03-operation-receipt-reconcile.test.mjs` | Original operation ID + canonical tenant/actor/type/payload digest; returns `REPLAY`, `CONFLICT` or `NEEDS_REVIEW` on private receipt readback | `operation_receipts` exists only in a synthetic test fixture, not an approved production migration |
| `src/db/authorized-operation-receipt.js`; `tests/m03-authorized-operation-receipt.test.mjs` | Private D1 session+role-bound **read-only** receipt reconciliation | A successful lookup cannot authorize a later write; must recheck current authority in the mutation SQL boundary |
| `tests/fixtures/m03-authorized-post-contract.mjs`, `tests/fixtures/m03-reversal-contract.mjs` and their local Workerd/D1 suites | Synthetic SQL-atomic authority+stock+receipt and once-only owned-stock reversal proofs | Synthetic roles and stock only; not approved live M05/M06/M07/M08 posting or reversal |
| `src/rpc/registry.js`, `src/rpc/handler.js`, `src/index.js` | Public registry deliberately **empty**; Worker health reports `database:not-connected`; private bridge tests are opt-in only | **No public D1-backed sale/purchase/return/cash mutation is approved** |

The pinned source's `docs/baseline/m03-async-closure.json` / `tests/m03-async-closure.test.mjs` record a conservative transitive audit: **47 original .gs files, 614 functions, 394 affected functions**. These are migration *work items*, not 394 verified ports. Re-run the documented `scripts/audit-m03-async-closure.mjs --check` and record endpoint-specific awaited call-chain coverage before claiming closure.

## 2. Proposed private G1 contract — dependencies, not an implemented API

M03 is the **only** owner of `src/db/**`, `migrations/**`, shared SQL/receipt/posting, `src/rpc/**`, `src/index.js`, Worker bindings, source invoice/stock IDs and the Cash Session SQL authorization boundary. These are the *minimum* fields and invariants a future reviewed internal posting interface must provide, **not a new public RPC schema or permission**:

1. **Authority:** trusted server-derived tenant ID, authenticated actor, live D1 session and current M04 permission/role/auth-version checks **inside the same SQL write boundary**; never honor user-provided actor, isApproved, role or tenant as authority.
2. **Stable intent:** source operation family and original operation ID, canonical hash over exact immutable operation inputs and source IDs; a replay must not issue a different invoice/stock ID or shift Party account scope.
3. **Source identities:** reviewed M02 original group+record+physical-row provenance; distinct approved source-ID namespace with SQL uniqueness, not name/phone similarity as an identity link.
4. **Atomic transaction:** fixed parameterized SQL, DB-enforced one-row CAS guards (zero affected rows means conflict/abort), protected source ID, stock FIFO lots, operation receipt, Party account-specific ledger and Cash/Bank or Cash Session effects in **one** approved SQL-atomic commit.
5. **Replay/uncertainty:** identical committed original intent returns the same immutable result, altered intent conflicts, unknown/absent receipt is **NEEDS_REVIEW** and never authorizes blind resubmission under a new operation ID.
6. **Reversal:** explicit original operation and lot/tender/obligation lineage, authorized reason, immutable inverse entries and SQL uniqueness ensuring at most one reversal; vendor/consignment versus owned stock stays distinct.
7. **Accounting:** distinct customer AR/advance, supplier AP/advance, vendor AP/AR, owner equity, loan AP, borrower AR and Payee identity; no automatic cross-role netting or historical opening-balance cash movement. Manual cross-role settlement remains disabled.
8. **Contract responses:** preserve original `serverCall(functionName,...args)` external method names, argument order and success/error envelope only once M04 verifies the endpoint allowlist. Resolve every dependent Promise before serialization; never expose SQL, hashes, internal row IDs, raw session values or private staff evidence.

**Version rule:** No downstream writer may claim an approved G1 version from this document. The first **G1-writer-v1** freeze requires executable reviewed source parity and passing real Workerd/D1 integration evidence, with a dedicated PR, exact-head SHA and explicit M02/M04/M05–M08 sign-off.

## 3. Ownership handshake and ordered blockers

| Lane | Supplies to M03 integration owner | Must not independently mutate |
| --- | --- | --- |
| **M02 / #24** | Approved source-group/physical-row identities; Party role/account directions; reconcile gross role balances, historical opening data and repeatable local import proof | Shared numbered migrations or guessed identity links |
| **M04 / #23, #252** | Persistent D1 actor/session/role versions, revoked/disabled policies and verified permissions with inside-write SQL predicate; last-admin proof | `src/rpc/**` public writer registration, M03 schema/posting |
| **M05 / #314** | Frozen product/lot/FIFO, unit conversions and Tiles Box/Pcs/Sqft read/preflight contracts | Live purchase receipt and stock+supplier ledger writer |
| **M06 / #314** | Original POS/draft/sale/split-tender/Cash Session intent with stable source IDs | Live sale/receipt writer before M04 and M05 |
| **M07 / #314** | Original-lot return/edit/delete and once-only correction semantics | A second correction/transaction engine |
| **M08 / #66, #452** | Independent Party/Bank/Cash/loan/equity account signs, historical balance and Cash Session source rules | Cross-role auto-offset, Cash/Bank writer, shared SQL |
| **M09 / #431, M10 / #312, M11 / #306** | Report parity, full local rehearsal/restore/reconciliation and release/CI safety | Public financial reports, remote data writes, unapproved cutover |

M03 integration order: (a) resolve reviewed M02 source/master/Party account mapping with original IDs; (b) land M04 session authority usable **within** mutation SQL; (c) submit one narrow M03 **real-schema** SQL posting/receipt interface with CAS, replay, failure-injection and concurrent Workerd/D1 proof; (d) have M05 freeze product/FIFO/lot interfaces; (e) integrate M06 sale and M07/M08 corrections/finance in dependency order; (f) re-run all required CI, source reconciliation, browser parity and M10/M11 gates. Independent safe proof lanes may continue meanwhile.

## 4. Mandatory acceptance evidence before changing the readiness flag

- [ ] M02 master/transaction/source-ID import parity and gross seven-role Party account directions approved; ambiguous identity links unresolved by guesswork.
- [ ] M03 awaited source RPC closure established with negative Promise-leak tests, no GAS-only dependency reachable on the audited endpoints.
- [ ] A reviewed **real-schema** D1 repository read and write contract with current tenant/session/actor authority and immutable receipt in the **same** atomic posting boundary.
- [ ] Concurrent last-stock, stale actor/role/Cash Session, zero-row CAS, rollback on late ledger failure, duplicate replay, payload conflict and exactly-once reversal tests against local **real Workerd/D1**.
- [ ] M05 original FIFO/multi-unit/Tiles mapping, M06 split payment, M07 original-lot reversal and M08 gross Party/Cash/Bank balancing validated against pinned source fixtures.
- [ ] M04 real D1 persistent auth, user disable, revoke, logout, last-admin and allowlist tests approved for live mutation.
- [ ] Full exact-head GitHub CI and required reviews; no workflow exemptions, hidden preview D1 bindings, remote imports or production rollout.
- [ ] Dedicated owner-reviewed readiness PR updates `docs/M03_PARALLEL_READINESS.md` only **after** all above evidence is linked and accepted.

## 5. Scope, test strategy and rollback of this PR

**Changed path:** only this handoff document, `docs/M03_G1_INTEGRATION_HANDOFF.md`. No code/SQL/CI/source changes, production/public RPC, D1 binding, remote import or deployment. This is a documentation-only coordination handoff exempt from artificial RED acceptance tests; **full existing CI remains mandatory before merge**. It links existing automated evidence without claiming current-head checks pass. Future executable G1 contracts **must** follow Superpowers failing test (RED) → minimal change (GREEN) → affected Node/Workerd/D1/browser tests → full exact-head CI. Rollback is simply reverting the document. The readiness gate and original UI remain unchanged.
