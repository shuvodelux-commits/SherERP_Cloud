# Superpowers TDD plan — M10 offline rehearsal gate

**Spec:** `docs/superpowers/specs/2026-11-16-m10-offline-rehearsal-gate-design.md`.
**Branch:** `m10/offline-rehearsal-parity-gate-20261116`.
**Source pin:** `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Task 1 — RED: evidence-contract tests
1. Commit `tests/m10-rehearsal-gate.test.mjs` importing nonexistent `src/migration/m10-rehearsal-gate.js` and asserting source rows, original IDs, gross accounts and explicit evidence gaps.
2. Open a draft PR. Confirm GitHub CI reports expected `ERR_MODULE_NOT_FOUND` on the new test before implementation.
3. Expected: test intentionally fails for a missing implementation module, with no modifications to source/target runtime.

## Task 2 — GREEN: minimal pure checker
1. Implement `assessM10RehearsalEvidence` at `src/migration/m10-rehearsal-gate.js`; avoid new dependencies.
2. All report fields aggregate fixed reason codes only. Never echo source values, hashes or errors. Validate 49 reviewed source groups, coverage source pin, row/ID digests, gross current/opening evidence and unresolved identity reviews.
3. Keep `authorizesImport: false` and `productionReady: false` regardless of synthetic parity.
4. Expected: `node --test tests/m10-rehearsal-gate.test.mjs` and `npm test` pass in existing CI. Do not claim actual D1 integration.
5. Recheck latest `main` before review and inspect exact-head GitHub Actions. No merge.

## Changed files and contracts
New design, plan, unit test and pure checker. No SQL tables, RPC entrypoints, runtime wiring, remote staging or migration effects. Source functions copied/adapted: none; checker consumes M02/M03 audit and M02 gross checkpoint report structures only.

## Recovery
Revert this isolated PR. The existing importer, source snapshots, production and deployed preview remain untouched.
