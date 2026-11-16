# M07-B7 — Cash Sales Return Price-Only Edit, Local D1

> **Agent:** Execute using Superpowers RED → verified failing CI → minimal GREEN → refactor/verify; no production RPC.

**Goal:** Prove original SalesReturn.gs source-preserving price-only Cash Return correction without altering stock, lot provenance or original historical Cash/Invoice postings.

**Authority:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `SalesReturn.gs::prepareSalesReturnChange_` and `updateSalesReturn`, the merged M06 Sale and M07 Return fixtures, M07 source contract, and AGENTS.md. Live production ERP changes are not authorized.

## Module overview (13 sentences)

1. The original ERP allows `updateSalesReturn` to adjust a Cash Return's unit price while its original quantity, SKU, invoice and lot remain unchanged.
2. Price-only corrections must leave the original physical stock restoration, source lot and product quantity untouched.
3. The original invoice, Cash Return, movement, refund receipt and immutable monetary history remain auditable.
4. This isolated D1 proof represents corrections as append-only versioned receipts and Cash adjustment rows, never overwriting the original return.
5. A reduced refund records only the Cash credit adjustment and an increased refund records only the Cash debit difference.
6. The corrected Cash total is the latest valid versioned amount, not a second gross refund.
7. Every correction requires a stable operation ID, authenticated-in-production actor identity, expected edit version, exact source invoice/return/lot hash and meaningful audit reason.
8. SQL admission proves the source invoice, immutable return/lot/Cash movement and current edit version inside a single atomic D1 claim.
9. The requested new Cash return amount must be nonnegative and no higher than the original invoice's prorated economic value.
10. Current and original Cash Sessions must be Open, the return must not be deleted, and unresolved dependent adjustments must fail closed.
11. Exact operation replay is read-only, changed actor/payload conflicts, and concurrent same-version edits produce at most one monetary adjustment.
12. Injected adjustment or version failure must roll back every correction receipt and Cash effect without changing inventory.
13. This suite uses local synthetic Workerd/D1 only, does not expose `updateSalesReturn`, and does not establish native batch edit, Store Credit, bundle or historical migration parity.

## Files

- `docs/superpowers/plans/2026-11-16-m07-cash-return-price-edit.md`: this source/TDD scope.
- `tests/fixtures/m07-cash-price-edit-schema.mjs`: isolated append-only receipts, signed Cash adjustments, version CAS trigger and active price selector.
- `tests/integration/m07-cash-price-edit-workerd.spec.mjs`: real local D1 integration suite.
- `wrangler.m07-cash-price-edit-test.jsonc`: disposable Worker/D1, never production.
- `tests/integration/m03-workerd.spec.mjs`: single aggregate CI test import.
- `tests/fixtures/m07-cash-price-edit-contract.mjs`: write only after the expected RED run; strict input validation, canonical hash, SQL original-source/return/Cash evidence, exact version check, replay classification.

## Implementation sequence

### Task 1 — RED
- [ ] Create plan and synthetic schema/config with no public RPC or remote binding.
- [ ] Commit Workerd integration tests for price reduction, increase, stale version, replay, actor conflict, closed Cash Session, deletion, tampered source, exact stock and ledger snapshot, injected failure and unsupported HTTP.
- [ ] Verify RED against missing contract in actual GitHub Actions; record exact SHA/run and expected failure.
### Task 2 — GREEN
- [ ] Add strict validated synthetic contract; one D1 batch inserts guarded receipt and reads back immutable operation.
- [ ] Trigger writes exact one signed Cash adjustment and version update; all-or-nothing rollback on unexpected DB failure.
- [ ] Run exact-head Foundation Node tests, source verification, frontend build, real Workerd/D1, PR safety, Chromium.
### Task 3 — Review
- [ ] Record full red-green evidence, remaining production gates, all check failures, and compatibility notes in one draft PR.
- [ ] Leave owner to review/merge; do not deploy or touch original Sheets/live D1.

## Constraints and future work

No changes to `src/**`, `migrations/**`, `legacy/source/**`, production Cloudflare Worker, customer/supplier/owner financial accounts, original UI or public RPC. The current M07-B6 edit-version table is a **synthetic test projection**, not a live source-backed version authority. The original GAS implementation updates current Return header, audit rows and original Cash Book; this proof instead uses immutable revision history, requiring a separately reviewed source-compatible presentation/active selector before production use. The signed Cash adjustment rows in this test are not M08 production Cash Book entries. Cash Session historical timestamp validation, M04 trusted `returns:edit` actor permission, M03 shared writer, M02 import ID mapping, M05 bundle provenance, M06 split tender and M08 reconciliation remain blockers. No automatic cross-role settlement or accounting inference.
