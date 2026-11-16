# M07-B5 — Supplier Credit Purchase Return Reversal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development. Run RED → verify failing test → minimal GREEN → full real-D1/CI validation.

**Goal:** Demonstrate original-source-linked, audited, exactly-once reversal of a synthetic Supplier Credit Purchase Return while preserving independent gross Party role accounts and all Cash/Bank history.

**Architecture:** Reuse merged M05 Purchase and M07 Supplier Credit Purchase Return test-only D1 tables. Add an immutable synthetic correction receipt whose D1 trigger restores the original purchase lot and SKU stock and increases only the same supplier's signed due by the original credit, writing an inverse Supplier ledger entry. The contract validates authoritative source and identity inside the SQL claim, not in a stale JS preflight.

**Tech stack:** Node 22 test runner, Wrangler 4.161.0, Workerd/D1 SQLite, canonical M03 SHA-256 operation intent. **Spec:** `docs/M07_RETURNS_SOURCE_CONTRACT.md`, `docs/WORKSTREAMS.md`, `AGENTS.md`, ADR-007, pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `PurchaseReturn.gs`/`StockLots.gs`.

## Source-anchored overview (12 sentences)

1. Purchase Returns are independent historical transactions and must not physically erase the original purchased inventory or original purchase.
2. A Supplier Credit Purchase Return reduces the source purchase's exact available lot and shop stock and credits only the source supplier's obligation.
3. A correction must preserve the original purchase, return, lot movement and signed Supplier Credit ledger as immutable audit evidence.
4. The corrected return will be excluded only from a synthetic active-return read projection, never silently deleted from storage.
5. The reversal can restore quantities only to the same original purchase's lot and Standard SKU, never another Supplier's inventory.
6. Exactly the credited amount must be added back to that Supplier's separately signed due or advance, including an advance that was negative.
7. Cash Book, Bank Book, Customer AR, owner equity and unrelated Supplier/Party accounts must not move.
8. Original source hash, ledger balance, supplier ID and reviewed Party legacy link must match inside the D1 transactional claim.
9. Historical or later settlement activity, later active supplier credits, stale balance and an unavailable or closed Cash Session must fail closed.
10. A stable tenant-scoped operation ID and canonical intent hash must yield one commit, identical replay or conflict under concurrent requests.
11. Fault injection at stock inverse or Supplier ledger inverse must roll back all D1 receipt, lot, stock and account changes.
12. This test-only proof is not a native PurchaseReturn.gs delete/edit RPC or production M03/M04/M05/M08 ledger integration and may not be enabled for live businesses.

## File inventory and ownership

- `tests/fixtures/m07-purchase-credit-delete-schema.mjs`: test-only SQLite correction receipt, inverse source-stock movement, inverse signed Supplier ledger and dependency marker, active projection, immutable triggers.
- `tests/integration/m07-purchase-credit-delete-workerd.spec.mjs`: real local Workerd/D1 tests that post synthetic M05 purchase and M07 Supplier Credit return before correcting, plus fault/replay/identity tests.
- `wrangler.m07-purchase-credit-delete-test.jsonc`: unique disposable local test Worker/D1, no remote binding or production deployment.
- `tests/integration/m03-workerd.spec.mjs`: one import to existing CI integration aggregator.
- `tests/fixtures/m07-purchase-credit-delete-contract.mjs`: create **only after observed RED**, export `createSyntheticD1PurchaseCreditDeleteContract(DB,{beforeBatch}?).post(input)`.
- This plan is the sixth file. None of `src/**`, `migrations/**`, `src/rpc/**`, `legacy/source/**`, `wrangler.preview.jsonc`, original UI, remote D1, shared posting core, or deployment paths may be changed.

## Task 1 — RED

- [ ] Add plan + disposable schema and Wrangler config.
- [ ] Write integrated Workerd/D1 tests against existing M05/M07 purchase+credit fixtures and one aggregate import **before** implementing correction code.
- [ ] Commit test-first SHA and confirm GitHub Actions M03 real Workerd/D1 fails for intentionally absent correction contract (not unrelated errors).
- [ ] Capture failing job logs and baseline `npm test` count.

## Task 2 — GREEN

- [ ] Validate exact input shape and source ID, reason, quantity, amount, unique operation and canonical intent.
- [ ] Admission SQL verifies original M05 purchase, lot, move, source hash, original M07 Supplier Credit, exact original signed ledger and current reviewed Supplier Party, current signed balance, absence of dependent marker/later active credits and Cash Session Open.
- [ ] One SQLite trigger increases purchase lot remaining with original capacity check, SKU stock and signed Supplier account exactly once, and inserts immutable inverse stock and Supplier Credit ledger.
- [ ] Classify receipt as COMMITTED / REPLAY / CONFLICT / DECLINED; uncertain SQL or ambiguous readback -> NEEDS_REVIEW, no fresh operation retry.
- [ ] Verify fully paid purchase with negative Supplier advance, an unpaid purchase, stale links, dependent settlement, later return ordering, changed/duplicate ID, fault rollback and 404 no public route.

## Task 3 — Verification and review

- [ ] Exact-head GitHub Actions: `npm test`, `npm run verify:source`, `npm run build:frontend`, real local Workerd+D1 and PR safety/Chromium checks.
- [ ] Update one draft PR with RED/GREEN commits, exact evidence, file/RPC/table scope, risks and future production gates.
- [ ] Leave unmerged pending owner review and all passing checks; no remote Cloudflare business-data writes.

## Release blockers

The synthetic `m07_purchase_credit_delete_dependencies` marker is **not** an actual Supplier Settlement ledger or authoritative last-settlement proof. This design intentionally refuses a Supplier balance mismatch and later active credits instead of guessing allocation. The original GAS source has posting, not an established native Purchase Return delete API; production deletion would need a separately approved source-matched flow. Never conflate signed Supplier due/advance with M05's historical nonnegative payable, Customer debt, lender balance or Cash Session turnover. Single-line synthetic source units are not multi-unit, bundles or verified imported historical data. Rollback this slice by reverting the six test/docs-only changes.
