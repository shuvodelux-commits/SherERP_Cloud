# M09 Day Book window + totals — Superpowers implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and superpowers:verification-before-completion. Execute in GitHub commits (RED then GREEN), leave PR draft for owner review.

**Goal:** Preserve Day Book filtering, signed cash/bank totals and deleted-row visibility over authorized source-shaped transaction rows without activating incomplete financial data.

**Architecture:** One small internal pure ES module; preserve the original source's filter/totals algorithm and `roundMoney_` semantics, plus fail-closed input validation and server-authority/deleted-row guard. Run a pinned unmodified source block as differential test oracle.

**Tech Stack:** Node 22 ES modules + node:test in GitHub Actions; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-16-m09-daybook-window-totals-design.md`

## Global constraints
- Preserve Mohim source byte-for-byte, original HTML handlers, public RPC registry, no new financial writer or Party net.
- No production or preview D1 binding, no SQL migration or live source data.
- `isAdmin` must come from upstream authenticated D1 actor; filter flag alone never reveals deleted rows.
- All test and source changes restricted to four added M09-owned files.

## Review focus
- Nonadmin deleted-row leak despite `includeDeleted:true`: must be impossible.
- Deleted Administrator rows in `count` but never cash/bank totals.
- 1-cent rounding and separate signed cash vs bank totals: no netting or hidden cross-ledger moves.
- Case-insensitive Bangla/English search and same-day date edges.
- No in-place snapshot sorting, no getters, no prototype inherited values.

### Task 1 — Freeze oracle and RED
- [ ] Add spec, plan and `tests/m09-daybook-window-totals.test.mjs` on isolated M09 branch.
- [ ] Evaluate frozen `DayBook.gs` final filter/totals block with a `node:vm` oracle and frozen `Utils.gs::roundMoney_` numeric formula; test valid authorized legacy-shaped snapshots and security paths.
- [ ] Commit test-only and observe real GitHub Foundation workflow RED due to missing `projectDayBookWindow`. Record precise SHA, number of failures, and run URL.

### Task 2 — Minimal GREEN
- [ ] Add `src/modules/daybook-window-totals.js` exporting `projectDayBookWindow(rows,filters,isAdmin)` with no D1/RPC dependencies.
- [ ] Preserve shape/order and input isolation. Rerun exact-head full `npm test` and M01 browser/M04/isolated D1 CI; report actual failures rather than inferred passes.
- [ ] Refactor only if tests reveal a concrete need, then reverify.

### Task 3 — Review and handoff
- [ ] Open/complete draft PR with original-to-new source impact, TDD evidence, test classifications, all four filenames, no business migration and rollback.
- [ ] Recheck current `main`, conflict/mergeability and CI. The owner makes the merge decision.
- [ ] Future separate PRs: source-reference Bank Book dedup; real D1 transaction input adapters; Cash Book running-balance parity; native edit/delete permissions; desktop/tablet/mobile print parity.
