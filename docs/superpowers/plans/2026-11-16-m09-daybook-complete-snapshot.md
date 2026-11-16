# Superpowers TDD — M09 complete Day Book snapshot composition

**Goal:** Compose already-proven source-shaped Day Book section projections into a complete **internal** display pipeline, without exposing D1 or public RPC. Read `docs/superpowers/specs/2026-11-16-m09-daybook-complete-snapshot-design.md` first.

**Source authority:** Mohim_ERP pinned `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `DayBook.gs::getDayBookTransactions`. Original sections already tested independently by frozen-source Node VM oracles. Preserve original source order, deletion visibility, Bank Book owner reference suppression, Cash Book chronology and filter order.

## Task 1 — test FIRST
1. Use a GitHub branch from verified `main`; no changes to original source or other M00–M11 owner files.
2. Commit spec/plan and `tests/m09-daybook-complete-snapshot.test.mjs` with mixed-source, complete-empty, missing group/sparse/accessor, duplicate reference, Admin-only deleted, Bank dedup and Cash Book chronological/final-filter regressions. Test helper imports new composer dynamically so **RED fails only for expected missing module**, not unrelated fixture errors.
3. Open draft PR to run full GitHub Actions; capture exact RED Node test count and unexpected failures if any. No source module until actual RED.

## Task 2 — minimal GREEN
4. Add `src/modules/daybook-complete-snapshot.js` only: complete own-data source validation; Bank owner group filtering consistent with original `keep`; call existing six section projectors; interleave exact source order; pass rows through running Cash Book and then final filter/totals. No new formula, posting behavior or storage access.
5. Run and inspect exact-head full Node + source integrity, Workerd D1 and Chromium/preview checks; repair only newly found defects with TDD. Never claim real-D1 business completeness because tests use authorized synthetic snapshots.
6. PR description: RED/GREEN evidence URLs, preserved source, no production effects, exact changed paths, rollback, concrete remaining M03/M04 authorization/D1 source loader, M08 reconciliation, M10 import and M11 owner-cutover gates.

## Next, only after reviewed merges
A separate M09/M03 PR must implement **tenant-scoped, M04-authorized, complete source snapshot read adapters** with real isolated Workerd D1 tests, source provenance completeness and no public preview bindings. Then compare Cash/Bank and separate gross Party ledgers against actual source posting data; retain fail-closed behavior on missing groups/partial imports.
