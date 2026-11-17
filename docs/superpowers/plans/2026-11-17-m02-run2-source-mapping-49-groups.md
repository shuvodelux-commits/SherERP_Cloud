# Superpowers Run 2 — Source-to-D1 mapping contracts for 49 groups (2026-11-17)

**Issue:** #24; **coordination:** #456; **base:** `SherERP_Cloud/main@7c81dca09f975fbda37586eb50c2763c7f8506df`; **source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Upstream:** PR #493 on main; PR #505 source freeze is independent and still pending shared CI.
**M02 ownership:** new `scripts/dry-run-source-mapping.mjs`, `tests/m02-source-mapping-import.test.mjs`, M02-only plan/review docs; no `src/db`, `migrations`, `src/rpc`, `src/index.js`, Worker bindings, auth or posting SQL.
**Integration owner:** M03 for all actual D1 SQL/schema and RPC; M05/M06/M07/M08 own business writers; M10 real rehearsal.

## Twelve-sentence implementation overview
1. Inventory every one of the 49 original Google Sheets groups against the frozen `Config.gs` headers and pinned source commit.
2. Pair each with its *current* versioned-D1 evidence from the existing migration coverage audit rather than inventing deployed tables.
3. Specify a reviewed **proposed** source-preservation lane for every group, including all 30 without current source-specific D1 DDL.
4. Distinguish business master, line item, stock lot, ledger, historical audit, session, private auth, posting journal, settings, and diagnostics.
5. Carry all original source columns forward as a raw-text preservation obligation rather than guessing numeric coercion or stripping deleted/backdated metadata.
6. Define exact source identification rules, including explicit sheet-row provenance for groups without a single-record ID.
7. Preserve split Customer, Supplier, Vendor, Owner, Lender, Borrower and Payee roles without any phone/name auto-identity union.
8. Keep Vendor Current Due separate from Current Receivable and preserve opening balances as historical, not cash-session movement.
9. Record original stock lot, FIFO consumption, bundle component, multi-unit, split payment, return and edit/delete relationships without adding a second accounting engine.
10. Clearly label the current D1 evidence stage, source-data reconciliation stage, responsible downstream owner and required approval per group.
11. Provide a deterministic offline-only JSON/Markdown review report and test failures for missing groups, schema drift, invented targets or silently promoted readiness.
12. Finish with an M03 handoff and a scoped draft GitHub PR, retaining full exact-head CI and ownership review before merge.

## Tests first
- RED: Add acceptance tests importing `buildM02SourceMappingReview` from a not-yet-existent M02 script.
- GREEN: Add a minimal data-driven source-to-D1 **design** review; reuse the existing `buildMigrationCoverage` audit instead of claiming 30 SQL tables exist.
- Validation: `node --test tests/m02-source-mapping-import.test.mjs`, existing M02 source fixtures, `npm test`, required full CI.
- No claims of 49/49 *real* import or reconciliation. No production D1 writes or source-file access; all 49 mapping design records remain pending M03 schema review and/or original source-data evidence.
