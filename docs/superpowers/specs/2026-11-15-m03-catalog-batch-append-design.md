# M03 Atomic Catalog Batch Append — Design

**Date:** 2026-11-15
**Status:** Internal M03-only source-compatible primitive; not a public business capability.

## Intent and source contract
The pinned `legacy/source/Database.gs#appendRows_(sheetKey,rowObjs)` writes several rows in one batch and returns undefined, unlike `appendRow_` which returns a physical Sheet row. Extend the already merged `createLegacyCatalogAppendAdapter(env)` from M03 PR #29 with `appendRows_(sheetKey,rowObjs)` for only the approved `PRODUCT_CATEGORIES` and `PRODUCT_UNITS` master sheets. Preserve original source-header keys, input order, UTF-8, and immutable source IDs.

## Constraints and safety
- Internal only: no public RPC, no auth workaround, no Cloudflare production or remote staging D1 binding.
- Reject unknown groups/headers, forged `_rowIndex`, blank/invalid ID or name, malformed values before database changes; allow duplicate names but never duplicate stable IDs.
- The entire batch is **one parameterized SQLite INSERT SELECT JSON statement**, not sequential appendRow_ calls. One failing/duplicate ID rolls back every batch item. Exact new indexes must remain sequential starting from physical Sheet row 2.
- Single SQL statement checks pre-existing provenance (no gaps/null rows), and hard total at most 1000, including this batch. Fail closed with zero inserted rows on failed guards.
- Empty array = source-shaped no-op; null/nonarray input rejected. Stable IDs make ambiguous retries fail without duplicate effects, but this is not general posting idempotency.
- No arbitrary SQL table/column identifiers, no JS application lock or shared module-level cache.
- Node SQLite RED/GREEN tests and actual isolated local Workerd/D1 batch tests, including invalid batch rollback.

## Alternatives
1. Repeated `appendRow_` in a JS loop: rejected, partial writes and race with other requests.
2. D1 batch of independent INSERT statements: rejected, single-statement row-count/provenance guard is simpler for known two catalog groups, and non-inserting guarded statements could produce partial results without throwing.
3. **One bound JSON SQLite INSERT SELECT statement (selected):** atomic, bounded, deterministic indexes, same reviewed D1 schema.

## Remaining gates
No catalog delete or updates, no general Database.gs writers, no business permission gates, no M05–M08 or financial transactions until approved M03/M04/shared-kernel evidence.
