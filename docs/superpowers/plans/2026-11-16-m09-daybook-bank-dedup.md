# M09 Day Book Bank Book deduplication — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:test-driven-development` plus `superpowers:verification-before-completion`. Commit design, RED test, observe failing GitHub Actions, then minimal GREEN code; leave draft PR for owner review.

**Goal:** Project the source-faithful standalone Bank Book Day Book rows without double counting bank-backed business documents, while preserving correct manual reversal and soft-deletion treatment.

**Architecture:** A pure M09 read model consumes complete, trusted, source-selected arrays. It builds the original owner reference index and reversal-target index, filters only standalone Bank Book rows, and emits the original `dayBookRow_` Bank contract without touching SQL/authorization/posting. Real-D1 financial reconciliation is intentionally outside this PR.

**Tech Stack:** Node 22 ES modules, `node:test`, `node:vm` frozen-source oracle, GitHub Actions. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-16-m09-daybook-bank-dedup-design.md`

## Global constraints
- Source SHA `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` and unchanged original frontend stay authoritative.
- This helper is internal; preserve empty/fail-closed public RPC registry and DB-free previews.
- No new SQL table/ledger, auto-netting, posting, writes, original Sheets access, migration or shared-module changes.
- Only complete, authorized and source-filtered records may be passed by a future approved caller.
- No user impersonation through `isAdmin` or `includeDeleted`; booleans from server authority only.

## Review focus
- Reference collisions from all seven supported business-owner streams, including Customer ID and Supplier ID aliases.
- Manual mirrored reversal retains original money; delete-voided Reversed entry is zero only for Admin includeDeleted.
- Bank transfers and blank references do not become phantom bank movements.
- No leaked deleted entries or malformed partial snapshots.
- Canonical date/ID validation; no prototype-string collision, time shift or input aliasing.

### Task 1 — RED tests
**Create:** `tests/m09-daybook-bank-dedup.test.mjs`, spec and this plan.
**Interface:** `projectDayBookBankRows(snapshot, isAdmin=false, includeDeleted=false)`.
- [ ] Extract and evaluate exact source `DAY_BOOK_DELETE_MAP`, `DAY_BOOK_OPEN_MAP`, `dayBookRow_`, `ownedReferences_`, Bank Book loop via Node `vm` and compare full JSON rows.
- [ ] Commit tests before `src/modules/daybook-bank-dedup.js` exists.
- [ ] Verify Github Foundation source test fails solely because the new export is missing; record HEAD/run and failure count.

### Task 2 — minimal GREEN
**Create:** `src/modules/daybook-bank-dedup.js`.
- [ ] Validate complete trusted snapshot, actor flags and safe source Bank scalars; build owner and reversal indexes as temporary local Sets.
- [ ] Select and project Bank rows with source fields, exact source ordering, no input mutation, no D1/requests.
- [ ] Verify exact-head GitHub full `npm test`, source byte audit, UI build, existing Workerd/D1/auth/browser checks; report any unverified checks.

### Task 3 — PR and rollback
- [ ] Record independent RED/GREEN run links/counts, source/RPC/SQL/file impact and what remains (Cash Book running balance, D1 financial feed/reconciliation).
- [ ] Verify exact branch diff has only four new M09 files and check current `main` freshness and mergeability.
- [ ] Draft PR stays unmerged for owner review; rollback four additive files only.
