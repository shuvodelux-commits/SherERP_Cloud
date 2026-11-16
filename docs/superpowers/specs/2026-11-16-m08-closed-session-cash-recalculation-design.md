# M08 — Closed/Closing Session expected cash recalculation (read-only)

**Frozen source of truth:** `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/CashReconciliation.gs:cashReconciliationRecalculateClosedSession_`, and its pinned source helpers.

## Goal

Provide a pure internal calculation of `{expected,variance}` for a `Closed` or `Closing` Cash Session by attributing real Cash Book movements exactly as the original ERP did. The source writer recalculates these fields after linking an explanation. This slice prepares only the **calculation**; it must never persist it, change Cash Book rows, clear legacy synthetic adjustments, or approve cash movements.

## Alternatives

1. Port the old `saveCashReconciliationExplanation` writer and `LockService`: rejected because D1 financial atomicity, authenticated actor, repeat replay, and exactly-once reversal gates are unfinished.
2. Build a second accounting engine or date-based cash report: rejected. Original behavior uses **positional Session Open markers**, not date filtering or Party balance netting.
3. **Selected:** `recalculateClosedSessionCash(session,sessionRows,cashRows)`, a pure source-shaped projection with frozen-source-oracle tests. Reuse the merged M08 ID parser where appropriate, keep normal source arithmetic and attribution, and fail closed on corrupted ambiguous duplicate identifiers.

## Behavioral contract

- Accept fully loaded record arrays, not Promise/null/nonrecord, and a source-shaped session record. Return `null` for non-`Closed`/`Closing` session or missing `Session Open` marker with matching `Reference`.
- Locate the first matching Session Open marker by **array position** and stop its native movement window at the **next** Session Open marker, even when that next marker belongs to another session. Do not sort by date. A synthetic marker itself is never turnover.
- In the native window exclude deleted rows (`Is Deleted: true` or `TRUE`) and synthetic `Session Open`/`Day Close Adjustment`. Exclude entries linked to the session's **opening** explanation and entries claimed by other sessions/phases unless they are explicitly linked to **this closing** explanation. Include real unlinked rows, even if legacy Entry ID is blank (source behavior).
- Include a real closing-explanation entry appearing inside the native window **once**. Add valid closing-linked entries found outside the native window **once**, including ones posted after a later Session Open. Missing/deleted/synthetic late-linked entries add zero. Do not move any row to another session or double count a linked entry in the same window.
- Movement = cent-rounded `Credit - Debit`, cent-rounded after each addition; `expected` = cent-rounded Opening Cash plus movement. `variance` = cent-rounded Counted Cash minus expected, or `''` if counted was absent; explicit counted zero is a real value.
- Keep use attribution source-faithful for valid input; do not infer role account effects or synthesize financial transactions. Historical opening balance remains an opening balance.
- **Fail-closed corrupt-import improvement**: detect duplicate nonempty Session IDs, Cash Book Entry IDs, and duplicate same-session Session Open markers rather than picking one arbitrarily. Internal `Map` and `Set` prevent prototype-shaped IDs from colliding with inherited object keys. Document that these malformed-data cases are intentionally stricter than legacy Sheets.
- No RPC, frontend, SQL, D1 binding, authenticated writer, worker endpoint, production cutover, Party-role offset or remote data access.

## Test-first acceptance

Create a Node `node:test` suite using the existing frozen-source VM fixture (`cashReconciliationRecalculateClosedSession_` plus helpers). Test source parity on synthetic normal rows: missing marker/nonclosing, boundary position vs dates, opening/other-use exclusion, in-window and late closing attribution, rounding, soft deletion, synthetic entries, missing counted, explicit zero and frozen rows. Test duplicate IDs, unawaited Promise/invalid rows and prototype-shaped IDs defensively. Confirm **RED** missing-module failure from GitHub Actions *before* adding implementation; confirm **GREEN** full `npm test`, `npm run verify:source`, `npm run build:frontend` in CI. No real D1 transaction, concurrency, rollback, actor authority or data migration is proven by this pure source test. Leave owner review/merge as a separate step.
