# M03 private stock lot cost audit D1 reader — Superpowers implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development. Steps use checkbox for tracking.

**Goal:** Add the original 16-column STOCK_LOT_COST_CORRECTIONS private awaited D1 read contract without writes, arithmetic or public access.

**Architecture:** Fixed M03 read-only query against existing immutable M02 archive; strict original row-index/data-field validation and original read-helper shapes. Node source parity and separate real local Workerd tests, no live D1.

**Tech Stack:** Node >=22 ESM, node:test and node:sqlite; Cloudflare Wrangler 4.161.0 isolated Workerd/D1, GitHub PR checks.

**Spec:** `docs/superpowers/specs/2026-11-17-m03-stock-lot-cost-history-read.md`.

## Global constraints

- Base main `1cd270e29e7a023f1a84c784e31845a9927704c4`; pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
- M03 #22 single shared `src/db` integrator; M02 migration 0011 already merged; no simultaneous M05/M06 writer or data-model change.
- No financial arithmetic or silent rounding of signed historical prices, quantities and COGS; Party, FIFO, invoices, Cash Session, receipt/reversal, original source and public RPC remain untouched.
- No remote D1 operations; no source data, credentials or confidential price rows in public Worker.
- Review edge classes: repeated Lot IDs, original source row gaps, `-0.00` and decimals, malformed D1 reply, 1001-row over-cap and user-controlled SQL-like Sheet/column.

## 14-sentence overview

1. Original StockLots appends historical cost corrections to a dedicated source group.
2. Its source group has sixteen fixed headers.
3. M02 already preserves that group in an immutable D1 archive.
4. Monetary and quantity evidence is stored as TEXT rather than recomputed numbers.
5. There is no current M03 private reader for that archive.
6. The next task is to create one bounded source-shaped private adapter.
7. It will use only a fixed parameterized SELECT.
8. The query will order by original source physical row position.
9. Duplicate Lot IDs will remain distinct historical corrections.
10. Any missing row, unknown action shape or malformed D1 field will fail closed.
11. Numeric spelling such as negative zero and signed COGS will remain exactly preserved.
12. All six original read helper methods will be awaited and expose no writes.
13. Synthetic real Workerd/D1 tests will verify the M02 importer and immutable history.
14. Full CI and M11 CI-owner review will be required before merging.

## Task 1 — RED unit contract

**Files:** `tests/m03-stock-lot-cost-history-read.test.mjs`.

- [ ] Commit test-only exact headers, 16 fields + `_rowIndex`, repeated lot corrections, signed and decimal TEXT, six reader method shapes, no writes, invalid selectors, malformed/getter result, row gap, 1001 over-limit, confidentiality.
- [ ] Verify GitHub Foundation RED fails due to missing `src/db/stock-lot-cost-history-read.js`, not a typo or dependency failure.

## Task 2 — Minimal GREEN

**Files:** `src/db/stock-lot-cost-history-read.js`.

- [ ] Add one fixed query and bounded validation. Expose six read-only, awaited helpers. No new shared abstraction, migrations, RPC or posting.
- [ ] Verify full Node CI green and source/preview isolation unchanged.

## Task 3 — Real local D1 import-to-read proof

**Files:** `tests/integration/m03-stock-lot-cost-history-read-workerd.spec.mjs`; `.github/workflows/m03-stock-lot-cost-history-read.yml` (M11 CI review).

- [ ] Use `wrangler.m02-stock-lot-cost-audit-test.jsonc`, frozen M02 importer, and local D1; synthetic repeated Lot/COGS.
- [ ] Verify M02 import→M03 read, strict historic signs, immutable SQL triggers, no source/API mutation, gap denial and public Worker 501.
- [ ] Add only new PR-only workflow with superseded PR cancellation and cached npm, pinned isolated Wrangler, no secrets/deploy.
- [ ] Full 43+ exact-head CI, review, conflict check and approved merge into main. Do not merge pending CI.

## Handoff

- [ ] PR against main with workstream M03, issue #22, central #456, base SHA, source commit, filenames, M02 dependency, M11 CI review, RED/GREEN IDs and rollback via revert only.
- [ ] Update the issue and verify the exact reader on main after later merge; do not mark production/M03 closure complete.
