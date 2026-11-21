# M01 Party Supplier Gross Opening / Advance — Source-Backed UI Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, RED → GREEN → refactor → browser screenshots → retest.

**Goal:** Render the Supplier's independent historical advance and current payable correctly in the existing HisabIQ Party screen, and accept a source-authenticated historical Opening row in the Supplier ledger, with no new financial writes.

**Spec:** `docs/architecture/ADR-007-unified-party-relationships.md`, `docs/architecture/ADR-008-hisabiq-party-ui-parity.md`; backend reference proposed in PR #862 (unmerged at start).
**Architecture:** Extend only the existing M01 Party source read adapter to recognize optional `Opening Balance`, `Opening Payable`, `Supplier Advance` in authenticated `GET /api/owner/suppliers`. Keep old data without these fields backward compatible. Both gross amounts remain independent; `Current Due` already includes historical payable so must never be increased again. Recognize `Historical Opening` rows with an immutable UUID source operation reference from authenticated Supplier ledger, without manufacturing a credit/advance ledger entry.
**Tech:** Current Owner HTML/JS Party adapter, Node test contracts, Chromium Playwright in compiled Owner UI.
**Reference lock:** `hisabiq_ui@e42a00a9f48ffc1f5c4ec10083e36d9eb4686484`; opt-in tokens `docs/design-system/HISABIQ_SHERERP.md`; existing dual receivable/payable cards and 320/390/768/1024/1440 responsive breakpoints. No new visual direction or component library.

## Implementation overview (12 sentences)
1. The existing Party view already uses a verified Supplier-only D1 source fallback and does not fabricate other role balances.
2. PR #862 proposes a server-issued signed opening checkpoint and exposes separate opening payable and Supplier advance amounts.
3. A Supplier may later have an advance receivable and an outstanding payable at the same time; netting them is not allowed.
4. The current `sourceSupplierParties` projects only `Current Due` and can therefore hide a separately tracked advance.
5. An opening payable is already included in the server's current due, so adding it again would double count debt.
6. We will use the server-provided advance only when the optional checked field set is complete and internally consistent.
7. Old clean-Shop Supplier rows without opening metadata will keep their existing safe interpretation.
8. The profile will label positive Supplier Advance explicitly without changing account roles or staff authorization.
9. The ledger will accept the exact `Historical Opening` source kind and a UUID operation reference only in the authenticated Supplier context.
10. Negative Supplier advances remain separate assets and must not create a fictitious payable-ledger credit row.
11. Any malformed, contradictory or overprecision money from a source is rejected before it becomes a displayed balance.
12. The UI will be tested at the source breakpoints with Playwright before/after screenshot inspection; no new Supplier opening write or production D1 mutation will occur.

## Global constraints
- Workstream **M01**, user-approved Party architecture; base `main@9670c5e2947a35a5e7d31c84c2aea36af1b83a46`.
- Change only `src/ui/hisabiq/party-workspace.mjs`, optionally scoped Party CSS, M01-only contract/Chromium QA and this plan/evidence. M03-owned `src/db`, Worker, migrations, M08 posting and shared shell stay untouched. PR #864 owns the shell and PR #862 owns signed-opening backend.
- No fake database writes, historical loan/cash movement, automatic cross-role offset, fabricated Party ID or legacy UI deletion.
- The explicit `/ui-refine-skill` launcher is unavailable on the connected PC. Do not claim execution; use pinned HisabIQ reference, Impeccable/Refero design guidance and inspected Playwright snapshots as documented fallback, mark skill-specific gate unverified.

## Test-first tasks
- [x] Add RED contract assertions for optional historical payable/advance metadata, simultaneous gross receivable/payable, negative due plus advance, partial/mismatched fields and source historical opening row.
- [x] Verify new tests fail on current main for the correct financial-display/ledger reason.
- [x] Implement strict read-only normalization and metadata consistency; keep source-only legacy fallback behavior.
- [x] Add Playwright fixture for Supplier advance and positive historical opening in the actual compiled Owner app, verify mobile/desktop profile and ledger.
- [x] Save and **inspect** 390px and 1440px baseline/new screenshots; fix any clipped amounts/labels, then retake. Check other HisabIQ 320/768/1024 breakpoints.
- [x] Run contract + baseline M01 Party browser + original Owner browser; source verification/docs checks; preserve all prior financial POST gates.
- [x] Commit, push scoped branch and open one PR with remaining backend/hosted release conditions; do not merge without review.

## Rollback / release
Revert this M01 UI-only PR if the backend contract changes; no D1 schema or historic data rollback. Do not claim this completes seven-role Party CRUD, source historical opening mutation or supplier full ledger reconciliation until M03 #862 and its hosted rollouts pass. No legacy retirement.
