# M05-0019 — SQL-guarded Sqft-entered tile purchase receipts (synthetic local D1)

**Dependencies:** M02 #439 tile revisions, M03 #441 quantity proposal, M05 #442 purchase quote, M05 #443 synthetic atomic receiving, M05 #444 DB-enforced money conservation. Draft child of #444; PR #444 must merge safely before this child can be retargeted/reviewed. Production status: **not enabled**.

## Thirteen-sentence Superpowers module overview

1. The original local-D1 receiving proof accepts only physical Box/Pcs input although the approved tile quantity resolver can also calculate Pcs from requested Sqft.
2. The new branch will support *synthetic* Sqft-entered receiving with loose Pcs or box-only fulfillment while retaining physical stock measured exclusively in canonical Pcs.
3. The selected tile's original Product ID, immutable measurement revision, real pack factor, coverage policy and manufacturer evidence remain server-owned and immutable.
4. For nominal tiles the first reviewed SQL subset uses positive integer dimensions in inches; for manufacturer-covered tiles it uses the stored verified Sqft-per-box value with no more than four decimal places.
5. The requested Sqft must be a canonical positive decimal string with at most four fractional digits and bounded values; malformed or excessive precision fails closed.
6. SQLite calculates the exact whole-piece minimum as a rational ceiling without floating point and independently checks it against the receipt's claimed Pcs.
7. Box-only fulfillment rounds the resulting minimum up to an exact multiple of the product-specific pieces per box, whereas loose fulfillment permits remainder Pcs.
8. The receipt trigger independently verifies Box and remainder quantities against the same immutable pack conversion, never a browser-supplied factor.
9. The existing M05-0018 SQL money guard separately verifies the recorded BDT minor-unit amount against the trusted Box/Pcs/Sqft purchase price.
10. The original synthetic cash-session, reviewed supplier/Party link, stock compare-and-swap, dated lot, source snapshots, immutable receipt, operation replay and late rollback remain inside the same D1 boundary.
11. Tests first demonstrate that currently rejected valid area requests must be accepted and that forged or understated area/quantity claims never create a stock movement or supplier due.
12. Test the new behavior with actual local Cloudflare Workerd/D1 and raw SQLite, then run all required exact-head GitHub workflows and source/UI preservation checks.
13. This is still a fixture-only unpaid-credit proof without production migrations, authenticating RPC, live source purchasing, Cash/Bank settlement, FIFO/OVERSOLD inventory release, or supplier-account deployment.

## Source-parity design and guard

The pure M02 quantity resolver defines `pieces=ceil(requestedSqft/effectiveSqftPerPiece)`, then if `fulfillment='box-only'`, rounds the computed Pcs up to whole packs. The SQL only accepts the bounded **first release**: positive whole-inch nominal dimension values (1..120), or manufacturer coverage fixed to four decimals, positive pieces-per-box, requested Sqft 0.0001..1000.0000 and final received Pcs 1..100000. All decimal strings become signed-64-bit-safe fixed-scale **integers**, never binary REAL. Unsupported size/unit/precision is **NEEDS_REVIEW**; do not silently use a rounded Sqft value or another measurement revision.

Scope: modify only `tests/fixtures/m05-tile-receiving-contract.mjs`, `tests/fixtures/m05-tile-receiving-schema.mjs`, add a private `tests/fixtures/m05-tile-exact-area-sql.mjs`, extend the existing `tests/integration/m05-tile-atomic-receiving-workerd.spec.mjs`, and this plan. No new migration / production `src/db` / RPC / UI changes. Money source remains `tests/fixtures/m05-tile-exact-money-sql.mjs`. Keep input hash, current catalog version, physical quantity and supplier Party identity validations in one transaction.

## TDD / CI gates

1. Commit plan + real Workerd/D1 tests first; confirm *genuine RED* from currently unsupported `mode:'area'` while existing regression tests pass.
2. Add a minimal SQL independent ceiling check and expand the test-only receiving handler, then rerun actual Workerd/D1, 14 core migrations, full Node suite, 84-file source verifier and original UI assembly.
3. Retain draft stacked PR until all parent PRs merge and all current mandatory checks are green. Prior owner exception for the broad M03 test applied only to #439/#440; do not apply it here.