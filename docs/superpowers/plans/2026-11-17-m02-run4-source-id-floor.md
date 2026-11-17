# M02 Run 4 — Frozen original ID floors and reconciliation handoff

**Owner:** M02 #24, board #456. **Base main:** 2c4fa84e9c8b5d4a26e7dac9a0fae61d51fde3c7. **Frozen source:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2. **Read/write scope:** M02-owned offline script/tests/review docs only; no D1/Worker/RPC/migrations/source Sheets writes.

## Approved task overview (13 sentences)

1. Preserve every original sequential document ID exactly instead of regenerating it during import.
2. Read the 38 source prefix families and six-digit minimum pad from the pinned Config.gs and validate its frozen blob.
3. Treat the original first-column ID plus physical sheet row as a distinct pair of provenance facts for each sequential family.
4. Review the supplied source rows for missing, duplicate, wrong-prefix, malformed and noncanonical IDs without normalizing them.
5. Require separately supplied per-family source counts and document-property counter strings so omissions are not silently treated as zero.
6. Calculate an offline candidate floor from the maximum safe historical sequence and original DocumentProperties counter for each family.
7. A stale counter must not cause a reused ID, and a counter ahead of the surviving rows must not be reduced.
8. Sales, Purchases, Sales Returns and Purchase Returns must be distinct families with no inferred cross-family counter.
9. SRB batch labels derive from the first existing SRT return and must not create a standalone sequential family.
10. Preserve deleted/historical IDs as issued, and reject uncertain row or ID provenance for manual review.
11. This offline proposal must never issue an actual ID or represent a D1 SQL lock, CAS operation or authenticated transaction.
12. Tests must first fail in RED against the missing contract and then pass after a minimal GREEN implementation with no new dependencies.
13. M03 will review the floor contract for SQL-atomic issuance and M10 will reconcile independently authorized original and D1 readbacks before any release.

## Original-source review

- Config.gs lines ~1060–1101: 38 ID_PREFIX families and ID_PAD_LENGTH=6; SESSIONS are random and excluded.
- Utils.gs lines ~57–97: generateId_ uses DocumentProperties ID_COUNTER_<family>, scans historical IDs in column 1 once per execution under caller-held script lock, then increments and persists.
- Setup.gs lines ~97–136: initIdCounters_ seeds absent properties; syncIdCounters_ scans original IDs rather than row count.
- Sales.gs ~601,649: invoice is reserved on split-payment journal path before stock/money writes, or allocated in the ordinary path.
- Purchase.gs ~172, SalesReturn.gs ~758 and ~882, PurchaseReturn.gs ~274: distinct purchase and return generation.
- SalesReturn.gs ~787: SRB- batch label derives from the first SRT return ID, without a dedicated counter.
- Original GAS uses permissive parseInt on prefix-matching text; migration intentionally refuses ambiguous manually edited IDs instead of guessing or silently rewriting them.

## Exact file ownership and acceptance

- Add tests/m02-id-floor-handoff.test.mjs (M02-owned synthetic RED test, no private records).
- Add scripts/dry-run-id-floor.mjs (pure offline review + bounded no-follow local JSON CLI).
- Add docs/reviews/2026-11-17-m02-run4-id-floor-handoff.md (M03/M10 handoff and failure/recovery gates).
- Touch no src/db/**, migrations/**, src/rpc/**, src/index.js, wrangler*, shared posting, original GAS/Sheets or private data.
- RED: missing implementation must fail in GitHub Actions (record actual run, do not fabricate evidence).
- GREEN: targeted Node tests and all exact-head GitHub workflows pass; no existing CI exceptions.
- Output remains no-go even with a clean synthetic review, because real historical snapshots, DB-enforced uniqueness/idempotency and independent M10 reconciliation are not verified.
- Rollback is this single scoped PR revert; no source/financial data or deployed migration exists to roll back.
