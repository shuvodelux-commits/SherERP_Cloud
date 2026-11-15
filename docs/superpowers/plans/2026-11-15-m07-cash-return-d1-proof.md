# M07-A1 Implementation Plan — Local D1 Cash Return

**Spec:** [M07-A1 design](../specs/2026-11-15-m07-cash-return-d1-proof-design.md).
**Parent:** [M07 source contract](../../M07_RETURNS_SOURCE_CONTRACT.md).

## Task 1 — RED integration acceptance
- New `tests/integration/m07-cash-return-workerd.spec.mjs`, `tests/fixtures/m07-cash-return-schema.mjs`, `tests/fixtures/m07-cash-return-worker.mjs`, and `wrangler.m07-cash-return-test.jsonc`.
- Import the merged M06 posting and schema fixtures; post synthetic original sales through **real** M06 logic.
- Explicitly seed synthetic source lot provenance because M06 has no real lot lineage. Exercise cash-on-fully-due, exact source qty, no customer due mutation, replay, different intent, last-unit concurrent return, missing evidence, closed Cash Session and fault rollback.
- **Expected RED:** absent M07 cash-return contract module.

## Task 2 — GREEN minimal internal contract
- New `tests/fixtures/m07-cash-return-contract.mjs`, test-only. Validate exact bounded input, canonical fingerprint from M03, tenant/source scoped SQL guard for original sale, original receipt hash, lot, qty, session, money cap.
- Same-statement SQLite trigger reserves returned qty, restores original synthetic owned lot/shop stock and writes one linked Cash debit and inverse movement. Immutable record; retried operations classify without extra writes.
- **Expected GREEN:** targeted real Workerd D1 tests pass; no SQL/user-controlled identifiers.

## Task 3 — Isolation and complete verification
- Add M07 integration to existing PR-only real Workerd suite imports (one-line test aggregation change; no runtime shared DB changes).
- Verify `npm test`, focused Workerd D1 with installed pinned Wrangler, complete Workerd aggregate, `npm run verify:source`, `npm run build:frontend`, `git diff --check`.
- Create narrow GitHub PR; explicitly record that real D1 **synthetic atomicity** is not full source/Party/cash accounting migration parity. No merge without review.
