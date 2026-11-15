# M07-B1 — Original purchase Cash Return D1 proof plan

**Skill:** Superpowers executing-plans, test-driven-development, verification-before-completion.
**Spec:** `docs/superpowers/specs/2026-11-15-m07-purchase-cash-return-d1-design.md`
**Target:** Disposable original M05 purchase receipt + exact M05 original lot; test-only D1, no financial production writer.

## Task 1 — RED source-parity tests
Create `tests/integration/m07-purchase-cash-return-workerd.spec.mjs`, `tests/fixtures/m07-purchase-cash-worker.mjs`, local `wrangler.m07-purchase-cash-test.jsonc`.
- Use real M05 purchase poster to create one `m05_purchases`, `m05_items`, `m05_lots`, original `m05_movements`.
- Verify partial purchase return restores no stock; instead reduces exact original source lot + overall stock, logs outgoing movement and a Cash Book credit (not debit). Supplier payable unchanged and no Customer cross-role offset.
- Cases: fully unpaid original Cash refund refused, cannot refund more than verified paid across cumulative earlier returns, duplicate/stale operation replay and conflict, concurrent last original unit, wrong purchase/lot/supplier, unreviewed supplier Party mapping, Cash Session closed, over-return, price/discount mismatch, and injected cash/lot movement rollback.
- Run tests before implementing contract/schema: confirm RED (missing module).

## Task 2 — GREEN minimal D1
Create `tests/fixtures/m07-purchase-cash-{schema,contract}.mjs`.
- Add D1 guarded return receipt and source-linked outgoing movement/Cash inflow tables; no mutations to original M05 schema tables or files.
- One SQL guarded parent return receipt, AFTER INSERT stock/lot decrement/receipt writes, all-or-nothing. Bound IDs/amounts/operation hash; use exact source purchase metadata, reviewed Party, current Cash Session, cash-paid ceiling, remaining original lot.
- Reproduce fault failures, replay and stale concurrent requests. No workarounds that write child rows in separate JS transactions.

## Task 3 — Verify and review
- Import test suite in `tests/integration/m03-workerd.spec.mjs` without altering production Worker.
- Run focused real Workerd/D1 suite and unaffected M05 purchase/M07 return proofs as relevant, Node `TZ=UTC npm test`, source-manifest verification, original frontend build, syntax and diff check.
- Document RED/GREEN + status in `docs/M07_PURCHASE_CASH_D1_PROOF.md`; GitHub PR describes source SHA, table/RPC/file scope, tests and gaps.
- Recheck current main, CI and conflicts before merge. Owner review required; no deploy authorization.
