# M07-B — Native Sales Return Correction Evidence Preflight

**Source authority:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `SalesReturn.gs::prepareSalesReturnChange_` and `DeleteEngine.gs::isDeleted_`.
**Repository:** `shuvodelux-commits/SherERP_Cloud`; branch `m07/sale-return-correction-evidence-20261116`.
**Status:** non-posting internal evidence planner; not M07 activation or a complete edit/delete implementation.
**Architecture:** KISS, additive Node ESM module, no import of GAS runtime and no Cloudflare/D1 mutation.

## Overview (12 sentences)

1. M07 must preserve the original Sales Return's edit and delete workflows rather than introduce another correction engine.
2. Each correction targets exactly one immutable historical Return ID.
3. Missing, duplicate or soft-deleted return headers must fail before planning any reversal.
4. The original invoice must still exist uniquely and must not be soft-deleted.
5. The existing return must contain active item rows and a documented historical refund.
6. Cash refund reversal requires exactly one matching active Cash Book debit entry and no credit.
7. Store Credit reversal requires exactly one matching Customer Ledger credit assigned to the original Customer ID.
8. Later Customer Ledger activity prevents an automatic Store Credit reversal because dependent settlement cannot be silently rewritten.
9. Existing Cash Session history must show the original session still open, in addition to an active current session gate.
10. Stale correction versions, missing reasons and unsupported operation IDs are rejected before a writer runs.
11. Editing a child of a batch must not change its refund method in conflict with sibling returns.
12. This slice returns read-only evidence only; M03/M04/M05/M06/M08 must still recheck authoritative rows and permissions atomically before a real correction can post.

## Files / ownership

- Add `src/modules/sale-return-correction-evidence.js`: pure internal source-shaped preflight for historical Cash and Store Credit correction evidence.
- Add `tests/m07-sale-return-correction-evidence.test.mjs`: source-authority characterization/oracle rejection tests, positive evidence shapes and fail-closed cases.
- This plan document is the third additive file.
- Do **not** modify `src/db/**`, `src/rpc/**`, `migrations/**`, `legacy/source/**`, Wrangler config, original UI, Cash Book or Customer Ledger writers. No independent financial engine.
- Source bytes are referenced, not copied or rewritten. Data are supplied as a trusted read snapshot by a future M03 integration; this helper cannot authorize an actor or obtain SQL row locks.

## TDD tasks / acceptance gates

1. **RED:** commit plan and tests before module. `node --test tests/m07-sale-return-correction-evidence.test.mjs` must fail only because the not-yet-implemented module is missing; observe CI.
2. **GREEN:** implement the minimal pure planner. It rejects duplicate Return ID, deleted return/invoice, duplicate invoice, missing lines, bad prior Cash/Store Credit evidence, wrong Customer attribution, later dependent Customer Ledger entries, stale version, invalid reason/operation ID, closed historical/current Cash Session, and mismatched batch sibling refund method. An eligible Cash/Delete or Store Credit/Edit produces a frozen, non-posting plan with source evidence; it never creates a Cash, Bank, Party or Stock mutation.
3. **VERIFY:** focused tests, complete `npm test`, `npm run verify:source`, `npm run build:frontend` and exact-head GitHub Actions. The returned plan is **not** a write instruction or authority token.
4. **PR:** document actual test results, impact inventory, conservative ownership boundary and blockers. Leave draft for owner review. **No merge or deployment in this task.**

## Boundary and future integration

- `SalesReturn.gs::prepareSalesReturnChange_` has additional price, quantity, source-lot, audit/journal and posting logic; this preflight intentionally does **not** claim those behaviors.
- The production writer must derive actor/permissions from M04, verify tenant/session/source hashes inside its M03 atomic SQL boundary, apply exact source-lot undo under M05 and reconcile M08 Cash/Bank/Party obligations. Never trust the read plan for atomic authority.
- Historical `Is Deleted` uses boolean true or the string `TRUE`, including case variations; rows with blanks remain active.
- Release gates remain `PARALLEL-MODULE-READY=false` and no public return-correction RPC. Roll back by reverting only these three additive files.
