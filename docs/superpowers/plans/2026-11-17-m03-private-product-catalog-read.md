# M03 Product Catalog candidate read — private, version-pinned D1 projection

**Parent:** M02-13 PR #422 (schema migration 0013; wait for merged/fully passing before merge). **Tracking:** #314. **Frozen source** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2 and separate optional source sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c.

## 13-sentence implementation overview
1. Implement one non-public M03 D1 reader for the operational candidate product catalog introduced by M02-13.
2. Do not add the reader to `rpcRegistry`, public Worker routing, or a privileged session's methods.
3. Bind product IDs and unit revision values in static parameterized statements, not dynamic SQL.
4. Preserve original Product IDs, source profile, source row and base-stock unit label verbatim.
5. Allow an explicitly chosen historical positive revision to be read without switching the currently active configuration.
6. Return revision zero as a single-unit base-only candidate with no invented conversions.
7. Require a real existing profile when a product points to an active positive revision and fail closed if it is missing.
8. List all conversion rows of a revision in stable sort order with status and master evidence intact.
9. Do not exclude inactive conversions from historical readback, because transaction snapshots may depend on them.
10. Preserve factor and purchase/selling override text without float conversion, rounding or price interpretation.
11. Never report stock available, COGS, cash, ledger balance or purchase/sale posting authority from a catalog read.
12. Verify malformed D1 results, SQL failures, missing profiles, stale revision arguments and HTTP isolation in Node and local Workerd/D1 tests.
13. Ship through a dedicated GitHub PR, RED tests before implementation, exact-head CI, reviewer approval and no remote D1 access.

## Test workflow
- RED: Node tests and real local Workerd tests target a nonexistent `src/db/product-catalog-d1-read.js`, proving the missing reader.
- GREEN: smallest pure awaited D1 read module, no schema/RPC changes.
- Final checks: original-source test suite, local Workerd and schema guards, unchanged original UI, no ledger writes, source identity isolated.
- On in-flight parent PR #422: keep the child branch based on its known head and open/retarget the child PR only after 0013 merges; do not bypass parent checks.

## Safety
This reader is an internal candidate projection; it is not an authenticated product list or a production staff endpoint. External clients must never reach it without later M04 authorization/tenant scoping. All original Sheets data remains untouched.
