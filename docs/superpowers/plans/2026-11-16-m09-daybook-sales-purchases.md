# M09 Day Book Sales/Purchases source rows — Superpowers plan

> **For agentic workers:** REQUIRED SUB-SKILL superpowers:test-driven-development and superpowers:verification-before-completion. GitHub-based RED test commit first, verified failure, minimal GREEN, exact-head CI, draft PR.

**Goal:** Preserve source-faithful Sales and Purchase Day Book rows as a safe independent prerequisite for later D1 transaction assembly.

**Architecture:** pure `projectDayBookSalesPurchases({sales,purchases},isAdmin,includeDeleted)` maps already trusted, already date-normalized records to the original Day Book row format. No D1, auth, posting, API routes or source edits. Consumed by upstream authorized/full source adapter after eventual approval.

**Tech Stack:** Node 22 ES modules, node:test, node:vm original GAS oracle, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-16-m09-daybook-sales-purchases-design.md`

## Constraints
- Frozen source Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
- Keep source ordering Sales then Purchases, exact field/output shape and enum method semantics.
- Sensitive financial schemas, posting, M03 auth and public route remain untouched and not activated.
- Full source completeness and unique source IDs must be checked; fail closed instead of showing false totals.

## Task 1 — RED source oracle
- [ ] Add plan/spec and new Node VM oracle test of unmodified `DayBook.gs` Sales and Purchases blocks.
- [ ] Test Cash, Bank, Mobile Banking, no method default, due zero, backdated, deleted admin/nonadmin, metadata, navigation, malformed data and immutable input.
- [ ] Commit tests before production module exists; open draft PR and observe exact GitHub Actions RED reason and counts.

## Task 2 — minimal GREEN
- [ ] Add `src/modules/daybook-sales-purchases.js` with strict own-data records, canon dates/times, safe refs, finite money and Administrator gating; original row output/ordering.
- [ ] Rerun exact-head full Node/source checks; correct any differences using RED→GREEN; review remaining browser/Workerd CI.
- [ ] Verify no global RPC, SQL, source UI or D1/finance posting modifications.

## Task 3 — PR review
- [ ] Document exact RED/GREEN run URLs and counts, four file paths, API/schema/data migration impact and rollback.
- [ ] Re-check latest main, mergeability/CI and record known absence of live D1 transaction feed.
- [ ] Owner reviews/merges. Follow-up: Sales/Purchase Return rows, then all ledgers and D1 completeness/reconciliation.
