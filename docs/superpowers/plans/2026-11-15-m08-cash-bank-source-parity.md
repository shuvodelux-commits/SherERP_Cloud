# M08 — Cash Session & Bank Transfer Source Parity Plan

**Spec:** `docs/superpowers/specs/2026-11-15-m08-cash-bank-source-parity-design.md`
**Owner:** M08 synthetic source-behavior tests only; no shared transaction/auth/schema ownership.
**Base:** fresh `main` after PR #67. **Branch:** `m08/cash-bank-source-parity-20261115`.

## TDD Task 1 — RED behavior tests

- Create `tests/m08-cash-bank-source-parity.test.mjs` and import missing `tests/fixtures/m08-legacy-source-runner.mjs`.
- Tests cover session marker/order, backdated cash, historical opening, linked explanations, closing expected/counted semantics, active-only public read, and balanced bank transfer calls, permission/session and invalid input before writes.
- Run `node --test tests/m08-cash-bank-source-parity.test.mjs`; expected missing module failure (RED).

## Task 2 — GREEN minimal legacy runner

- Implement only a test-only VM loader: parse frozen legacy GAS via Acorn, select explicitly named top-level function declarations, fail for missing/duplicate declarations, execute selected source in a restricted context with caller-provided test stubs. Do not run entire GAS files.
- Run focused node:test; adjust test fixture expectations only when actual source contradicts an assumed behavior, documenting any ruling.

## Task 3 — Verification and review

- Run `npm test`, `npm run verify:source`, `npm run build:frontend`, targeted test and `git diff --check`.
- Commit, open PR, require all GitHub CI checks plus DB-free Cloudflare preview; owner reviews and merges.
- **Excluded:** D1/Sheets data, real financial posting, cash/bank account changes, runtime RPC, schema, settlement, source mutation. Rollback: revert the test/docs-only PR.

## Test limitations

This is executable legacy behavior characterization with synthetic stubs, *not* a real Workerd/D1 integration test, concurrency proof, authorization proof, or an accounting migration. It does not claim to replace real D1 failure injection and source-to-new monetary parity required for M08 acceptance.
