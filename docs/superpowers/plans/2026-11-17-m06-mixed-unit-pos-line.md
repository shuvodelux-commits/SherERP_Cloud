# Superpowers TDD plan — M06 multi-unit POS line (issue #314)

**Owner 10–15 sentence overview:** supplied in the conversation immediately before implementation. **Workstream M06**, coordination issue #456, module issue #314. Branch `m06/mixed-unit-pos-line-intent-a01` based on `main@666dd0ca5e0632dbc5bb3fb75c4584e0433d36ec`. M06 exclusively owns new `src/modules/m06-multi-unit-pos-line.js` and `tests/m06-multi-unit-pos-line.test.mjs` plus this plan/spec. Shared M03 D1/sql/RPC and M05 conversion files are **read-only dependencies**, not editable files.

## RED
1. In a new M06 Node regression, first require the internal `planMultiUnitPosLine` capability before its module exists. Assert independent hand-calculated outputs for 1 Bag+2 Box+5 Pcs, 145 base Pcs, custom Bag/Box, FIFO base remainder and 100+45 lot draws, plus untouched immutable source.
2. Add legacy single-unit and auto-price parity, rejected claimed 144/bogus unit, price/factor forgery, deleted/ambiguous catalog, and Own vs Negative/Vendor shortage isolation. Test no purchase-cost leakage or mutation.
3. Commit **tests before implementation**, inspect exact-head GitHub Node test RED for missing capability. Direct isolated source checks can supplement but never replace real Actions evidence.

## GREEN
4. Implement one pure M06 module importing approved M05 conversion helpers and frozen FIFO planners only. Validate already-trusted tenant rows with plain records and deterministic source IDs, then reuse existing quantity/pricing/FIFO algorithms; never reimplement their arithmetic.
5. Return one base-stock quantity, source FIFO draw intents, explicit unfilled quantity mode, exact line total and immutable component factor/price snapshots. Never expose internal source purchase cost or write anything.
6. Run GitHub Node, real local Workerd/D1, Chromium, Cloudflare safety and all required full exact-head CI. Fix any scoped failing regression, distinguish unrelated failures, do not bypass mandatory jobs.

## Merge sequence/dependencies
- Depends on merged M05 conversion source #313; M05 unit schemas/source group review, M03 shared posting/async D1 and M04 authenticated session gate remain **blocked** for live writes.
- One independent PR against main, not stacked. No `src/db/**`, `migrations/**`, `src/rpc/**`, `src/index.js`, `wrangler*.jsonc`, shared ID, Cash Session or ledger modifications.
- Require full current-head CI, conflict-free PR and owner review before merging. Even when merged, this only introduces a nondeployable internal POS preview helper. Rollback = revert this PR.
