# M03 — Legacy Database.gs catalog read contracts (source-driven slice)

> **Superpowers:** use test-driven-development, executing-plans and verification-before-completion. Implement only reviewed non-sensitive catalog reads until M04 authentication is ready.

**Goal:** Bridge the six original `Database.gs` read/find helper shapes to D1 for `PRODUCT_CATEGORIES` and `PRODUCT_UNITS` without leaking Settings, exposing public RPC, or writing remote data.

## Planned/implemented

- [x] Confirm PR #16 status; merged verified test-only `workerd` gate after 5 green checks
- [x] Reopen frozen `legacy/source/Database.gs`, `Config.gs` source inventory and repository AGENTS.md
- [x] Record `getAllRows_`, `getSheetHeaders_`, `findRowIndex_`, `findRow_`, `findRows_`, `findFirstRow_` semantics and the original four catalog column headers
- [x] RED: write Node tests for original row shape, null timestamp, string-exact lookup, unknown sheet/column refusal, physical row mismatch and >1,000 rows; observe missing-module failure
- [x] GREEN: add `src/db/legacy-catalog-read.js` (DB binding required, fixed SELECT allowlist, bounded queries, no writers/cache)
- [x] Run 6 local SQLite tests, verify 0 failures and `node --check`
- [x] Update *test-only* Worker fixture and actual D1 integration spec for both master tables and rejection tests
- [ ] Confirm full GitHub Actions Node tests and real `workerd` integration suite
- [ ] Confirm Cloudflare PR Preview deploys with no D1 binding and unchanged `/api/health`
- [ ] Code-review, then merge only when all CI checks pass

## Rulings

- **Contiguous legacy physical row indices required:** source `getAllRows_` maps Sheet rows sequentially starting at 2; a migrated dataset with sparse/missing `legacy_sheet_row` cannot safely fake `_rowIndex`. The adapter raises an explicit error rather than silently shift indices.
- **No silent pagination truncation:** two small catalogs are capped at 1,000 rows; a 1,001st row produces an error to force an explicit pagination/source-parity design.
- **No source settings read:** original `SETTINGS` may include sensitive values. Keep it inaccessible until M04 auth.
- **Never add broad sheet writers:** side-effecting `Database.gs` methods will need separate reviewed D1 semantics, concurrency tests and original data parity.
- **No public routes or real cloud D1:** adapter is internal, and extra routes exist only under `tests/fixtures/m03-readonly-worker.mjs`.

## Follow-up

Next M03 slice: source-aware master data paging, rest of reviewed direct callers, D1 imports with immutable source identities and M04 authorization architecture. Full M03 acceptance remains incomplete.
