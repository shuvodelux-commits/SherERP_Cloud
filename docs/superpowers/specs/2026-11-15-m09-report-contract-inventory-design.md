# M09 Reporting Read-Contract Inventory — Design (2026-11-15)

## Goal
Make the original reporting and transaction-centre read interfaces inspectable and drift-detectable before any M09 SQL port. The tool is a **read-only preparation gate**, not an implemented report endpoint.

## Source and approved constraints
- Pinned source: `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
- Inputs: frozen `legacy/source/Reports.gs`, `Dashboard.gs`, `DayBook.gs` only.
- The original file headers establish Reports as an aggregator, Dashboard as operational cards, DayBook as read-only transaction-centre. M09 report SQL parity depends on M05/M07/M08.
- No edits to `legacy/source`, `src/db`, `src/rpc`, Worker, SQL migrations, UI or CI; never touch remote D1 or source production Sheets.

## Approaches and decision
1. Port SQL reports now — rejected: transaction and shared posting interfaces are not stable.
2. Manually maintain a report worksheet — weak: silently drifts as functions and data source calls change.
3. **Selected:** deterministic source-verified JSON manifest and offline tests. Per public source function record the explicit permission gate, direct `getAllRows_/activeRows_` source group references and called helper functions. Keep a SHA-tied manifest and enforce it with `--check`.

## Implementation boundaries
- Scanner recognizes only **top-level** `function NAME(...)` declarations (there are no transpilation/AST promises). It removes comments before scanning direct invocation tokens so commented-out examples are not treated as live calls. It scans source *without execution*.
- A strict endpoint list per file ensures removal/rename of an endpoint fails even if the snapshot is changed accidentally.
- An explicit `requirePermission_(token,module,'view')` gate is required for all audited endpoints. If this lexical form changes, the audit must fail until reviewed.
- Direct source group reads include `getAllRows_('GROUP')` and `activeRows_('GROUP')` only; helper calls are listed but **not** recursively interpreted as resolved data lineage. This is intentionally less than a full transitive dataflow, matching the M03 inventory's limitation.
- An endpoint's changed group, permission or helper dependency changes the generated inventory and causes `--check` to fail. For tooling review, `--write` regenerates the checked-in manifest only when an agent explicitly requests it.
- Snapshot includes pinned source SHA from `docs/baseline/source-manifest.json`, a deterministic surface/function inventory and a warning that these are source contracts, not D1 parity evidence.

## Test contract
- Real frozen source produces expected endpoint counts, key reports groups and permission gates.
- Synthetic mutation deleting a permission fails; removing endpoint fails; adding/altering direct source group is recorded; commented-out source reference excluded; a drifted snapshot fails in check mode.
- `npm test` covers tests; CLI `node scripts/audit-m09-reports.mjs --check` checks manifest; `npm run verify:source` protects frozen original SHA.
- Report-specific critical notes: profit COGS uses SALE_ITEM_LOTS and vendor sourcing and attributes returns to original invoice period; Dashboard uses source-scoped payment/collection; DayBook de-duplicates bank rows linked to documents. These are manual domain review items, not guarantees proven by the lexical scan.

## Release / handoff
M09 actual SQL read models, permission tests in real D1, matching profit, gross Party ledgers, correct date boundaries, filter/soft-delete behavior and browser/UI parity remain **blocked** until M03–M08 gates. This preparation cannot set PARALLEL-MODULE-READY.