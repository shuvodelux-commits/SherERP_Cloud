# M06: legacy sale posting payload hash — source compatibility only

**Date:** 2026-11-15. Pinned original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; source `legacy/source/SalePayments.gs::salePostingPayloadHash_`, plus merged `src/modules/sale-payments.js::salePostingJournalDecision_`. Mandatory `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, `docs/architecture/ADR-007-unified-party-relationships.md` reviewed before coding.

## Objective and security boundary

Port original GAS SHA-256 sale-journal payload fingerprint in an **isolated read-only compatibility helper** using Cloudflare Workers/WebCrypto. Exact input bytes must be source's `JSON.stringify(payload)` (in JS insertion order), UTF-8, SHA-256, lowercase 64-character hex. Retain original GAS `raw.length > 100000` check in JS UTF-16 code units, and original failure for undefined/empty JSON text, cycles or BigInt. Verify original signed-byte `Utilities.computeDigest` conversion via a test-only Node GAS shim. Neither canonical sorting nor domain separation may be added to this **legacy** hash because doing so would invalidate historic posting-journal fingerprints.

The already-existing **M03 canonical** `hashCanonicalOperationIntent({tenantId,actorId,operationType,payload})` is a separate security-domain hash for **new D1 operation receipts**. **Do not replace, modify, fallback to or automatically accept** either hash as the other format. New D1 sales continue to use canonical M03 hash. The compatibility helper exists solely to compare/reconcile historical GAS posting journal evidence under a future reviewed import path; it does not trust legacy journal state or approve a financial retry.

## Superpowers TDD and acceptance

1. **RED:** commit this plan and test-only `tests/fixtures/m06-sale-journal-hash-oracle.mjs` extracting exact frozen source function with Acorn and running it in isolated VM, with Node `createHash('sha256')` shim implementing signed-byte GAS `Utilities.computeDigest`. Commit `tests/m06-legacy-sale-journal-hash.test.mjs` first. Verify actual failing GitHub Foundation run `ERR_MODULE_NOT_FOUND` for new internal `src/modules/legacy-sale-posting-hash.js`.
2. **GREEN:** minimal async `hashLegacySalePostingPayload(payload)` using `JSON.stringify`, `TextEncoder`, and `crypto.subtle.digest`. Match original success and error behavior for regular JSON, numeric amounts, Unicode Bangla/emoji, whitespace, order of object keys, array ordering, 100000-character JS limit and boundary. Fail closed if WebCrypto unavailable or returns invalid digest. Ensure tests explicitly demonstrate M03 canonical hash differs for the same synthetic payload and remains unchanged.
3. Verify all eight exact-head GitHub Actions workflows including Foundation Node, M03 local real Workerd/D1, M04 auth, M02 Party/staging/import, M01 Chromium and Cloudflare Worker preview safety. The existing real D1 integration tests are regressions, **not** a live/imported sale posting or hash reconciliation test. Keep draft until green.

## Ownership, inventory and rollback

Three new files only: this plan, isolated GAS source oracle, focused tests, and **one** new production helper (four new files total). No modifications of preexisting M03 fingerprint or M06 posting/split-payment modules, D1 schemas/migrations/RPC/Worker, M04 auth or M05 stock code. No edits to original GAS/Sheets, frontend, Cloudflare configuration, cash/bank, journal, invoice or Party accounts. No live data, no keys or actual financial writes. A revert of this additive PR is a complete rollback; no DB change.

**Not an M06 posting milestone.** Production sale idempotency still needs an M04-authenticated, tenant-scoped atomic D1 receipt, M05 stock CAS and FIFO, M08 cash/session and split tender reconciliation, full failure-injection/concurrency Workerd+D1 tests and owner cutover review. This helper never authorizes a replay.
