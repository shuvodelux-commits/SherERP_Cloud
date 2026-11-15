# M09 Source-Faithful Report Date Windows — Design (2026-11-15)

## Intent
Create a deterministic internal read-only report date-window adapter for a later indexed SQL report reader, preserving the original `Reports.gs` date filter behavior exactly where it matters. This is the next independent M09 slice following endpoint and Settings inventories. No report endpoint or D1 query is activated.

## Original contract
Pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, frozen `legacy/source/Reports.gs::reportRange_` and `inRange_`, `Utils.gs::sanitizeInput_`, `Reports.gs::getReportsBootstrap`:
- `filters.from` and `filters.to` are trimmed strings; invalid/missing start defaults to the trusted current month's first day and invalid/missing end defaults to today.
- A report date matches `^\\d{4}-\\d{2}-\\d{2}$` (lexical, not calendar validation). If start is later than end, swap them.
- Date matching is inclusive at both ends and receives an already-normalized date-only `yyyy-MM-dd` from upstream `safeDateOnly_`.
- Bootstrap reports `defaultFrom` as month start and `defaultTo` as today.

## Approaches
1. Build SQL reporting now — rejected pending approved M05/M07/M08 data models and golden ledger fixtures.
2. Use `Date.parse` and UTC arithmetic — rejected: would change the source's lexicographic input contract and timezone behavior.
3. **Selected:** tiny pure date-window functions with an explicit trusted shop-local `today` argument; validate its canonical shape, preserve source fallback/swap semantics, require already-normalized row dates. Test results against the two original function bodies executed in an isolated Node VM with deterministic `formatDate_` and `sanitizeInput_` substitutes.

## Interfaces
- `normalizeReportRange(filters, today): {from,to}` — `today` is a trusted shop-local canonical `YYYY-MM-DD` string. No `new Date()`, hidden timezone or network. No rounding/amounts.
- `dateInReportRange(dateOnly, range): boolean` — only canonical date-only strings, blank date returns false. Reject timestamps until upstream explicit date normalization; never infer timezone or compare raw timestamps.
- `reportDefaultRange(today): {defaultFrom, defaultTo}` — exact bootstrap date defaults for report UI.

## Safety and scope
No D1, reporting amounts, Party calculations, authentication changes, source copying, browser DOM edits or Worker RPC registration. Avoid changing `src/db/**` and SQL schema shared ownership. Reject malformed trusted today, malformed range objects, getter/proxy access and noncanonical row date strings rather than manufacture a successful report. Filter dates themselves retain source's lexical `YYYY-MM-DD` rule (even impossible month/day), preserving exact original behavior.

## Acceptance and release
Node test-first RED on absent internal module; GREEN verified with direct source-oracle comparisons for missing/partial/from-to/reversed/trimmed/invalid values and inclusive boundaries; distinct cases for timestamp rejection, malformed trusted time and no input mutation. Full GitHub Actions recorded distinctly from focused test. Pending source-vs-SQL fixture parity and real D1/permissions/browser tests; not a complete M09 or a customer-facing report.
