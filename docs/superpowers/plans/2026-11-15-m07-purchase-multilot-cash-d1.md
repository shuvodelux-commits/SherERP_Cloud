# M07-B4A — Original Purchase multi-lot Cash Return: atomic local D1 proof

**Status:** test-only design; not authorized production posting/migration. **Source:** Mohim_ERP frozen `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`: `StockLots.gs::planPurchaseReturnLotReduction_`, `PurchaseReturn.gs::completePurchaseReturn`, `Utils.gs::effectiveTransactionUnitPrice_`. Prior dependencies: merged M05 synthetic purchase posting; merged M07-B1 purchase Cash and B2 Supplier Credit single-lot D1 proofs; merged M07-B3 source-parity multi-lot preflight. Review AGENTS.md, docs/MIGRATION_PLAN.md, docs/WORKSTREAMS.md, ADR-007.

## Scope (approved continuation, narrow B4A)
Prove one **Cash** Purchase Return consuming two or more purchase-owned FIFO lots in one real isolated Workerd/D1 atomic operation. Existing M05 proof represents exactly one original purchase lot; therefore synthesize multiple same-purchase lot splits *only in this disposable test fixture* and make the limitation visible. Do not claim real imported multi-lot provenance or production D1 coverage.

## Frozen behavior
Original Purchase Return is a new linked document, never edits the purchase. It decrements exact purchase-bound lots (date, then Lot ID) and Products stock, appends outgoing lot movements, and credits Cash Book once. Refund value is net of original invoice discount. Cash refund is limited to verifiable paid amount less prior Cash refunds. No Supplier payable/advance, Customer, Bank or unrelated Party account should change. Requires active Cash Session and original reviewed Supplier identity; must not reallocate to another purchase's lot. B3's legacy fallback is **not eligible for this synthetic posting proof** and is blocked pending separate source-linked SQL design.

## Implementation contract
- New *test-only* `m07b4_*` immutable receipt, split purchase lots, outgoing movement and Cash inflow tables and triggers. SQL validates immutable M05 receipt + item + original lot/movement, reviewed supplier link, active cash session, exact return amounts, fully reconciled split original quantities, eligible lot balances and strict FIFO prefix **inside** the commit boundary.
- Stable operation ID and SHA-256 canonical intention with checked `{lotId,units}` lines; D1 `DB.batch` claim/receipt -> `COMMITTED|REPLAY|CONFLICT|DECLINED`, uncertain errors -> `NEEDS_REVIEW`.
- All split lot decrements, stock CAS decrement, one movement per lot, Cash inflow and header must roll back on later child constraint or injected failure. Guard cross-method legacy B1/B2 receipts both directions; do not silently double-spend a purchase already touched by a different synthetic return proof.
- Deterministic whole-unit/integer-paisa single standard owned product, 2–20 split lots. Exact source-net price verified in SQL; never claim fractional/multi-unit, multi-product, settlement, vendor/OVERSOLD, Bundle or legacy lot fallback completeness.

## TDD acceptance
1. RED: Commit tests first without D1 schema/contract implementation; observed GitHub failure due expected `ERR_MODULE_NOT_FOUND` before implementation.
2. GREEN: Real local Workerd/D1 exercises source FIFO across at least two split lots, same original purchase, original discounted amount, unchanged historic M05 and unrelated gross Party accounts.
3. Reject skipped earlier source lot, forged lot/quantity/source hash, stale/disabled supplier link, wrong Cash ceiling, closed Cash Session, ambiguous replay, duplicate/cross-method identity or altered intent; no write on decline.
4. Inject movement and Cash failures; reject partial effects with exact before/after SQL snapshot. Concurrent last-unit attempts commit once.
5. CI: full Foundation, local M03 workerd/D1 integration, source verification, frontend preservation, Cloudflare preview safety, and current-head mergeability checked. Record RED/GREEN run URLs in PR.

## File / ownership boundaries
Add `tests/fixtures/m07-purchase-multilot-cash-{schema,contract,worker}.mjs`, `tests/integration/m07-purchase-multilot-cash-workerd.spec.mjs`, `wrangler.m07-purchase-multilot-cash-test.jsonc`, the present plan and evidence doc. Add **only** a test import to `tests/integration/m03-workerd.spec.mjs`. No `src/**` edits, `migrations/**`, shared financial posting kernel, `src/rpc/**`, original GAS/UI, production Cloudflare D1, Worker secrets or deployment bindings.

## Follow-on / safety
B4B must reconcile real Supplier Credit with the same synthetic multi-lot contract and cross-method semantics, then M07 native edit/delete corrections. No production authorization, official Party signed-account switch or cutover implied. Rollback: revert branch/PR, drop local disposable D1 tables; no remote data written.
