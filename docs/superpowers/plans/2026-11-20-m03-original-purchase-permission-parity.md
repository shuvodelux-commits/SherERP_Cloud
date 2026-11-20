# M03 Original Purchase Permission SQL-Time Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans with explicit RED→GREEN and verification-before-completion. This plan only changes disposable local Workerd/D1 proof; it never enables production purchase posting.

**Goal:** Replace the incorrect `pos.add` check in the synthetic M03 first-purchase SQL authorization boundary with the original `purchase.add` source permission and prove two-direction role separation using real local Workerd/D1.

**Architecture:** Reuse the existing M03 synthetic first-purchase test harness and actual M04 local D1 user/session/role schema. First add distinct POS-only and Purchase-only roles and tests on the existing integration spec. Then make the smallest SQL grant and fixture seed change; keep current-role-version, staff status, Shop membership, active Cash Session, same-Shop Supplier, money, replay, CAS, rollback and source audit unchanged. Do NOT update the operational Worker or source data.

**Tech Stack:** Node.js 22 native node:test, Wrangler 4.161.0 local Workerd/D1, existing `tests/fixtures/m03-first-purchase-atomic-local.mjs`.

**Spec:** Frozen `legacy/source/Purchase.gs` at source SHA `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`:
`requirePermission_(token, 'purchase', 'add'); requireActiveCashSession_();`
Existing `docs/reviews/2026-11-20-m03-purchase-posting-gate.md`, M05→M03 contract `docs/m05/INTEGRATION_HANDOFF.md`, RED source finding M05 draft #767 and issue #22, coordination #456, source issue #314.

## 12-sentence implementation overview

1. The original purchase writer uses staff `purchase:add` permission and then checks an active Cash Session.
2. M03's merged first-purchase synthetic local D1 SQL currently guards `pos.add`, which is a POS sale grant.
3. A POS-only role must not have permission to create supplier purchases or stock lots.
4. A Purchase-only role must be able to create a purchase even if it lacks POS sale authorization.
5. Current-role checks must execute in the atomic SQL mutation, not only in a stale JavaScript preflight.
6. The existing two-Shop synthetic test writer already proves basic receipt and money conservation in real local Workerd/D1.
7. This change adds two behavioral role tests to the existing M03 suite rather than creating a second test engine.
8. The tests must first fail against the old `pos.add` SQL with actual local D1 results.
9. The minimal GREEN fix changes one SQL JSON path and updates the synthetic role seeds and one stale test title.
10. The change preserves the source Cash Session requirement even for bank tender and zero-paid purchases.
11. All real Business/Party source reconciliation, future operational SQL migrations and live RPC approval remain separately blocked.
12. No original GAS, local owner PC, hosted staging D1, runtime Worker, UI or business data will be modified.

## File ownership and parallel safety

- Base `main@e81e243b94ff7712ae6c42392ae4fc4c763faf8d`; branch `m03/source-purchase-add-sql-auth-parity-20261120`.
- Modify only M03-owned `tests/integration/m03-first-purchase-atomic-workerd.spec.mjs` and `tests/fixtures/m03-first-purchase-atomic-local.mjs` plus this new plan.
- M05 PR #767 remains a **separate RED evidence PR**, not merged until correctness is established; avoid double-adding its tests to `main`.
- No edits to common `src/db/**`, `src/auth/**`, numbered migrations, original source, `src/rpc/**`, `src/index.js`, Cloudflare config/deployment or `src/modules/m08-*`.
- The source permission key is an executable original contract, not a design preference to simplify.
- M02/M03 other parallel PRs must be rechecked before merge; no financial posting activation.

## Task 1 — test-first RED

- [ ] Append two explicit M03 local Workerd/D1 tests and two synthetic roles:
  - `M03PosOnly`: `{"pos":{"add":true},"purchase":{"add":false}}` must be denied, with exact before/after D1 stock/lot/ledger/receipt snapshots unchanged.
  - `M03PurchaseOnly`: `{"pos":{"add":false},"purchase":{"add":true}}` must commit a 1 Pcs × BDT 0.335 source purchase as a 34-paisa Supplier Ledger Debit and 34-paisa supplier due, one stock lot and zero Cash/Bank book movement.
- [ ] Keep the role tests directly in `tests/integration/m03-first-purchase-atomic-workerd.spec.mjs` so the existing, pinned M03 first-purchase GitHub workflow runs them.
- [ ] Open a draft PR and obtain the exact-head GitHub hosted real Workerd/D1 RED result; identify two intentional failures in these tests, no unrelated source test errors.

## Task 2 — minimal GREEN fix

- [ ] Replace only `json_type(role.permissions_json,'$.pos.add')` with `json_type(role.permissions_json,'$.purchase.add')` in M03 `CURRENT_AUTH` SQL.
- [ ] Change existing synthetic allow/deny seeds to Purchase-only vs POS-only distinct roles; preserve the old positive and negative test coverage, now with truthful title.
- [ ] Keep same SQL-current role-epoch, user revocation, session, Shop, Supplier and active Cash Session predicates.
- [ ] Run exact-head existing M03 first-purchase Workerd/D1 suite and all GitHub Actions, Node Foundation, M05 and M04 authentication regression and M01 original Chromium smoke.

## Task 3 — QA and integration handoff

- [ ] Review exactly three-path PR diff and SOURCE `purchase:add` parity, confirm Bank and zero-paid still require Cash Session and have no drawer effect when unpaid.
- [ ] Link M05 RED #767 evidence and new M03 RED/GREEN run IDs in #22 and #456.
- [ ] Independent `/super qa → /super review`, owner-approved merge only; no real operational D1, public RPC or live tenant purchase permission activation.
- [ ] After M03 correction is truly merged and green, close/supersede the redundant RED #767 with explanatory evidence, never merge a known-failing PR. Recheck branch protection and live state.
