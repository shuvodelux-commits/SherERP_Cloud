# M07-B4 — Purchase Cash Return Reversal (Synthetic Workerd/D1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement the checklist in TDD RED → GREEN → verify order.

**Goal:** Prove an audited, exactly-once reversal of a synthetic Purchase Cash Return, restoring only its original purchase-specific lot and reversing its Cash inflow, with real isolated D1 failure and replay tests.

**Architecture:** Use merged M05 purchase + M07 Purchase Cash Return synthetic evidence. A new *test-only* correction receipt is admitted only after source-specific SQL guards validate the original return, original purchase, stock movement and Cash inflow. One D1 trigger restores the same purchase lot and shop stock, then writes immutable inverse stock and Cash evidence atomically. No change to production schema, app or authorizations.

**Tech Stack:** Node 22 ES modules, GitHub Actions, Wrangler 4.161.0 Workerd and local D1 SQLite.

**Source contract:** `docs/M07_RETURNS_SOURCE_CONTRACT.md`, `docs/WORKSTREAMS.md`, `AGENTS.md`, pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `PurchaseReturn.gs`/`StockLots.gs`/`DeleteEngine.gs`. This is not an already-existing native Purchase Return deletion RPC port.

## Scope overview (12 sentences)

1. Original Purchases are immutable and a supplier Cash Return is recorded as a separate linked return.
2. Its return must have reduced only its own purchased stock lot and the store's SKU stock.
3. A hypothetical correction should never alter the source Purchase, Purchase Items, original Cash/Bank tender, or original Supplier ledger.
4. Correction planning needs to prove one unique Cash Return, its original source hash, quantity, SKU, lot and Cash inflow.
5. The correction may restore the same source purchase lot, but must never mint stock into another lot or a different Supplier's purchase.
6. A SQL guard must reject incomplete, duplicate, stale, deleted, non-Standard or unreviewed source evidence.
7. A historically reversed Cash inflow must be offset with one immutable Cash *outflow*, not an automatic Supplier account change.
8. The source Cash return and audit evidence remain immutable; a synthetic active-view projection hides corrected returns.
9. A stable tenant-scoped correction operation ID and canonical intent hash distinguish exactly one commit, safe replay and conflict.
10. Closing the Cash Session, inserting a dependent adjustment marker or changing the authoritative lot before claim must decline without mutation.
11. An injected stock or Cash inverse failure must roll back every resulting correction effect, not leave half-posted inventory.
12. The new suite proves only a single-line synthetic D1 transaction; native Return edit/delete, original GAS soft-delete display, real M04 identity and M08 accounting migration remain blocked.

## File/RPC/table ownership

- Create `tests/fixtures/m07-purchase-cash-delete-schema.mjs`: disposable D1 tables `m07_purchase_cash_delete_receipts`, `m07_purchase_cash_delete_moves`, `m07_purchase_cash_delete_offsets`, optional dependency evidence and a read-only active view; immutable update/delete triggers.
- Create `tests/integration/m07-purchase-cash-delete-workerd.spec.mjs`: true local Workerd + SQLite D1 tests using existing M05 and M07 source postings.
- Create `wrangler.m07-purchase-cash-delete-test.jsonc`: test-only D1 binding and local fixture Worker; no public endpoint.
- Update `tests/integration/m03-workerd.spec.mjs` by one import so consolidated CI exercises tests.
- Create `tests/fixtures/m07-purchase-cash-delete-contract.mjs` ONLY AFTER confirmed RED; `createSyntheticD1PurchaseCashDeleteContract(DB,{beforeBatch}?).post(input)`.
- This plan is the sixth changed file. **No** `legacy/source/**`, `src/**`, `src/rpc/**`, `migrations/**`, production D1, `wrangler.preview.jsonc`, Pages/Workers deploy configuration or original UI changes.

## TDD tasks

### Task 1 — Source lock and RED tests
- [ ] Confirm GitHub main, AGENTS/ADR-007, pinned Purchase Return and M07 synthetic fixture contracts.
- [ ] Add test schema/config and integration suite exercising original posted Purchase and exact Cash Return before any correction writer.
- [ ] Commit test first, inspect GitHub M03 Workerd test failure for intentionally missing `tests/fixtures/m07-purchase-cash-delete-contract.mjs` (not unrelated red).
- [ ] Record exact RED SHA and GitHub Actions URL in PR.

### Task 2 — Minimal GREEN transaction proof
- [ ] Exact input-shape validation, original immutable source identity, canonical operation intent and bounded money quantities.
- [ ] SQL receipt claim checks original purchase's source hash, original lot/return movement and Cash amount, session, supplier-reviewed Party, dependency absence, source lot balance and no operation collision.
- [ ] In single D1 SQL trigger update original purchase-lot remaining within original bought quantity, increase shop stock, insert inverse stock and Cash audit entries; failure should abort all.
- [ ] SQL readback must distinguish one committed receipt, identical replay, conflict, declined and uncertain `NEEDS_REVIEW`.
- [ ] Green run: complete GitHub Actions and real local Workerd/D1 integration. Fix failures without relaxing safeguards.

### Task 3 — Review/rollback
- [ ] Update draft PR with RED/GREEN commits, full CI, before/after gross stock/Cash/Supplier account evidence, test-only ownership inventory and source parity exclusions.
- [ ] Stop at PR review; user merges separately. No background deployment or live data migration.

## Review focus

A later Supplier settlement or manually adjusted purchase lot requires an authoritative dependency/lot reconciliation gate; the disposable `m07_purchase_cash_delete_dependencies` marker models only one explicit blocker and is not a production settlement ledger. Never infer paid balance from a displayed net or alter a Supplier due when the return was Cash. Original `PurchaseReturn.gs` provides purchase-return posting, not a known native delete API: do **not** claim this synthetic proof establishes native Purchase Return delete source parity. Source Cash Return refund may be received even when the original purchase tender was Bank; reversal still records the inverse of the actual return Cash inflow, never guesses its original tender. M03/M04/M05/M08 owners must integrate reviewed transaction authority and genuine lot provenance before launch.
