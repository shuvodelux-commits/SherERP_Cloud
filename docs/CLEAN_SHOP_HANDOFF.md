# SherERP clean business handoff

Start with [issue #690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690) and the latest GitHub `main`. Related workstreams are #22 for D1 and #23 for authorization. Before editing, check the open PRs, current CI, `AGENTS.md`, and `docs/PARALLEL_EXECUTION.md`. Review status in GitHub takes precedence over this dated summary.

## Where we are

- The Owner staging site has a read-only catalog of 481 verified pilot products from #687. Stock valuation, edits, and transaction saves remain gated. #689 merged the saved purchase price and stock-at-backup display. Verify the deployed version independently before claiming those fields are live.
- #691 proved two empty local Shop D1 databases can each accept a first product, reject cross-shop access, and retry without duplicates. #692 merged at `05be0cb` and proved the existing Add Product form against that local save path. The browser test confirmed that a lost save response, retry, and reload leave one row. Both PRs passed all 53 checks before merge. The fixture is excluded from the Owner release.
- The Super Admin can reserve a business identity. The no-code workflow that creates and links a separate database and grants Owner access for any new shop is incomplete.

## Next PR: authorize the first real product save

Reuse the existing form and the operational `products` table for a standard product with zero opening stock. Start with a failing Workerd test on the real candidate write path. Use a trusted shop selection, a current Owner grant, the established Product ID allocation contract, and an operation receipt that makes a retry return the same product. Verify identical replay, changed-payload rejection, a revoked session, cross-shop denial, and no committed row after a failed write. Then use the #692 browser test against the candidate rather than the fixture.

The current Owner session lives in Control D1 while products live in Shop D1. Checking the session in Control D1 and then writing to Shop D1 leaves a revocation race. Review `M04_ATOMIC_AUTHORITY_BOUNDARY.md` and `M03_G1_INTEGRATION_HANDOFF.md` before exposing a writer. The M03 and M04 owners must agree on how the Shop D1 mutation checks current authority inside its SQL boundary, including how disable and revocation take effect. Do not promote the fixture's separate preflight or its synthetic product IDs into the live path.

## Release order

1. Connect Add Product for verified empty shops. Prove a purchase, a POS sale, and a return against expected stock, FIFO cost, cash, and customer balances.
2. Complete Super Admin setup with business name and Owner Gmail. Create the database, apply the reviewed schema, verify the binding, and allow safe retries. Prove two shops stay isolated.
3. Resume historical imports only after the clean shop workflow works. Require per-import backup, exact reconciliation and the approved cutover process.
