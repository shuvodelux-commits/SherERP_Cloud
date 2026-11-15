# M03 Canonical Intent Fingerprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task, with the red-green test cycle.

**Goal:** Freeze deterministic, tenant/actor/domain-separated operation-intent SHA-256 bytes for the synthetic idempotency kernel without opening any financial RPC.
**Architecture:** Internal pure Worker WebCrypto digest helper over a bounded canonical JSON encoder. Separate fixed-input test-only Workerd/D1 fixture feeds its digest to already-merged synthetic posting contract to prove identical replay versus conflicting mutation.
**Tech Stack:** Node 24 ESM + node:test, Cloudflare Workerd/D1, Wrangler 4.161.0, Web Crypto SHA-256.
**Spec:** `docs/superpowers/specs/2026-11-15-m03-canonical-intent-design.md`

## Global Constraints
- One M03 owner for new `src/db` module; no changes to existing catalog writers, transaction fixture, or production DB schema.
- Preserve original GAS source, HTML and RPC. No live financial data touched; no tenant/actor authority from untrusted request.
- Digest output lowercase SHA-256 hex of ASCII domain prefix + exact canonical JSON; amounts encoded as decimal strings.

## Review Focus
1. Nested object key reorder yields identical digest, including both Node and Workerd.
2. One payload change or scope/actor/tenant change yields different digest and DB replay CONFLICT.
3. Float, unsafe integer, -0, invalid surrogate, accessor or undefined must reject, never silently JSON-coerce.
4. Sparse arrays, cycles, excessively deep/wide input reject before hashing or posting.
5. Real local D1 replays unchanged operation without double-decrement or duplicate movement.

### Task 1 — Pure canonical digest TDD
**Files:** new `tests/m03-operation-intent-fingerprint.test.mjs`, new `src/db/operation-intent-fingerprint.js`.
**Interface:** `hashCanonicalOperationIntent({tenantId,actorId,operationType,payload}): Promise<string>`.
- [ ] Test independent expected digest, deterministic nested order, scope/changes, Unicode, exact input validation, forbidden JSON coercions, cycles, input mutation and resource bounds.
- [ ] Observe RED (module missing), then implement smallest pure canonical writer + WebCrypto digest.
- [ ] Run targeted Node test GREEN and full Node regression.

### Task 2 — Workerd and synthetic D1 replay contract
**Files:** new `tests/fixtures/m03-intent-fingerprint-worker.mjs`, `wrangler.m03-intent-fingerprint-test.jsonc`, `tests/integration/m03-intent-fingerprint-workerd.spec.mjs`, `docs/M03_OPERATION_INTENT_FINGERPRINT.md`; one import in `tests/integration/m03-workerd.spec.mjs`.
- [ ] Write real local D1 RED tests against an empty test fixture, observe 404 failures.
- [ ] Add only fixed synthetic actions; hash in Worker; pass digest to PR #49 test-only synthetic posting fixture; test COMMITTED, REPLAY, CONFLICT and malformed payload fail closed.
- [ ] Fresh full `npm test`, `node --test tests/integration/m03-workerd.spec.mjs`, source integrity, frontend build, caller inventory, syntax, git diff --check.
- [ ] Rebase current main; rerun checks, commit/push/open narrow PR for review (no merge).

## Success gate
No deployed API, schema, identity or posting functionality claimed. Test exactly the future operation fingerprint contract and document its validation limits.
