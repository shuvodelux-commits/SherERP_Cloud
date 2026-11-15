# M07-B2 Purchase Supplier Credit — Superpowers TDD plan

**Spec:** `docs/superpowers/specs/2026-11-15-m07-purchase-supplier-credit-design.md`. **Objective:** signed Supplier Due/advance with an original-purchase-only lot reduction and SQL atomic cross-method guards. Source pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## 1. Test first — RED
Create `tests/integration/m07-purchase-supplier-credit-workerd.spec.mjs`, isolated test Worker `tests/fixtures/m07-purchase-supplier-credit-worker.mjs` and `wrangler.m07-purchase-supplier-credit-test.jsonc`.
- Set up real M05 purchase poster, original lot/stock receipt, M07-B1 shared lot balance/movement and a **separately seeded signed Supplier account oracle**.
- Test source case Supplier payable decreases 5000→3500 paisa on 1500 credit; fully paid source and zero original signed supplier due yield **negative -1500**; original M05 supplier balance, original Cash/Bank and unrelated same-Party Customer unchanged.
- Test original receipt replay/change conflict, Cross-method Cash→Credit and Credit→Cash duplicate IDs, sequential Cash+Credit sharing purchased quantity without over-return, second-stage movement/ledger failure rollback, stale Party link, signed account identity mismatch, Cash Session closure, original hash, forged source lot, discount basis, concurrency, malformed input and 404 endpoint.
- Run Workerd test **without the new contract**; capture expected `ERR_MODULE_NOT_FOUND` (RED).

## 2. Minimal D1 GREEN
Create `tests/fixtures/m07-purchase-supplier-credit-{schema,contract}.mjs`. No production or M05/M07-B1 shared file updates.
- Test-only `m07_purchase_supplier_signed`, `m07_purchase_credit_returns`, `m07_purchase_credit_ledger`; one parent insert with SQL source guard, AFTER stock/original-lot and supplier update/ledger trigger, two cross-method identity guards. Existing purchase lot/movements and original M05 immutables are reused.
- M03 canonical fingerprint and exact receipt; bounded accepted strings and integer paisa. `COMMITTED|REPLAY|CONFLICT|DECLINED`, ambiguous D1 `NEEDS_REVIEW`, no silent retry.
- Prove before/after state and rollback on actual Workerd/D1; document all changes and unsupported source behaviors.

## 3. Aggregate CI and PR
- Add a single import to `tests/integration/m03-workerd.spec.mjs`.
- Run new and prior M07-B1 focused real D1 suites, M05 purchase, `TZ=UTC npm test`, `npm run verify:source`, `npm run build:frontend`, JS syntax/diff checks.
- GitHub-first branch and scoped PR with file/schema/RPC inventory, TDD RED→GREEN evidence and current head CI; recheck recent main mergeability. Owner review/production rollout separate.
