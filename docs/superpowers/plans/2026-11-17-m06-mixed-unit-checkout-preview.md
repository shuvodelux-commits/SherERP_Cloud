# Superpowers TDD — M06 mixed-unit checkout split-payment preview

**Owner overview:** delivered in chat on 2026-11-17 before starting this scoped feature. **Issue:** #314; board #456. **Base SHA:** `1cd270e29e7a023f1a84c784e31845a9927704c4`. **M06 file owner:** only new `src/modules/m06-mixed-unit-pos-checkout-preview.js`, `tests/m06-mixed-unit-pos-checkout-preview.test.mjs`, plan and spec docs.

**Dependency:** #463 mixed-unit line and M05 #313 unit conversion are on `main`, and frozen `sale-payments.js` exact source copy is already covered by independent oracle tests. **Blocked** production integration: M02 unit/history schema, M03 atomic kernel, M04 session authority and M05 stock interface signoff. Do not add public RPC or SQL.

### 1. RED tests, prior to code
- Add Node test cases with two distinct products: Product A mixed 1 Bag + 2 Box + 5 Pcs =145 base Pcs, line ৳1,340 from trusted unit prices/FIFO; Product B legacy 2 Feet @৳30 =৳60; subtotal ৳1,400 and discount ৳15 -> Grand ৳1,385. Pay Bank ৳500, Mobile ৳285 and Cash ৳650 -> applied Cash ৳600 and change ৳50, no due. Compare the allocation output to an independent call of the **original migrated source function**, not new arithmetic.
- Assert exact total even though Product A's rounded effective base unitPrice is ৳9.24 (145*9.24=৳1,339.80, **not** ৳1,340). Verify anonymous sale has no Customer/Party identifier and no stock/cost information.
- Add malformed input / duplicate Product ID / duplicate Bank Account ID / nonpositive/missing product / unauthorized active bank / overpay / cash-only partial/zero invoice cases. A negative-stock mode must remain explicit and flow through existing M06 line planner.
- Commit test first, inspect real GitHub Actions failing RED from missing module; when runner auto-cancels superseded SHA, document the limitation rather than fabricate a green/red CI result.

### 2. GREEN minimum implementation
- Validate plain input, source rows, and unique Product IDs / bank account IDs; use `planMultiUnitPosLine` for all lines and `salePaymentPaisa_` for exact subtotal + discount amounts. Reject unsafe sum; never multiply back effective base prices.
- Call unmodified `normalizeSalePayments_` on exact Grand Total with trusted bank account rows; copy returned lines and allocation into a read-only intent; no write path.
- No changes outside this M06-owned new module, test, docs. Keep code readable and KISS; no new dependency/framework, double accounting engine or frontend redesign.

### 3. CI and merge protocol
- Run full exact-head Node, source parity, real local Workerd/D1, browser and Cloudflare safety GitHub checks. Any unrelated fail must still block merge until fixed in its proper workstream. No shortcuts.
- One draft PR against fresh main; owner approves merge only after all GitHub checks green, required reviews/protections and no conflicts. This internal preview remains nondeployable; future M03 owner must enforce source authority, Cash Session, SQL stock+money atomicity, idempotency, replay, rollback and original UI parity separately.
