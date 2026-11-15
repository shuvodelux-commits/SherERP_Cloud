# M02-P local D1 Party readback adapter — Superpowers TDD execution

**Source SHA:** `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Workstream owner:** isolated M02-P read-only adapter + integration tests.
**Dependencies:** existing PR #59 synthetic source import and merged PR #86 pure comparator.

- [ ] RED: extend `tests/integration/m02-party-plan-workerd.spec.mjs` first with five live workerd/D1 tests and an import of a nonexistent adapter. Commit to GitHub PR, obtain expected failing CI log.
- [ ] GREEN: add `src/party/d1-identity-readback.js` only. Three exact prepared SELECT queries in one awaited `DB.batch`; validate result shape; feed `reconcilePartyImportReadback`; return only sanitized report.
- [ ] Verify local D1 tests under the existing PR-only GitHub Action, original Node suite, pinned 84 source files, original UI Chromium smoke, frontend build, Cloudflare preview safety.
- [ ] Check latest main and diff, verify PR mergeability and GitHub CI. Keep PR unmerged for review; `PARALLEL-MODULE-READY` stays false.
- [ ] Record concrete gap: approvalRef column absent in current D1 schema; account backfill, reviewer authority and financial posting are separate gates.
