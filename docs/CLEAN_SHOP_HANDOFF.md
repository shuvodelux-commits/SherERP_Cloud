# SherERP clean business handoff

Start with [issue #690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690) and the latest GitHub `main`. Related workstreams are #22 for D1 and #23 for authorization. Before editing, check the open PRs, current CI, `AGENTS.md`, and `docs/PARALLEL_EXECUTION.md`. Review status in GitHub takes precedence over this dated summary.

## Progress as of 20 November 2026

GitHub `main` verified through `7ff6050` (#704). The [clean business milestone #690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690) remains open.

| Area | Status |
| --- | --- |
| Owner staging | Google sign-in and read-only Products are live. The #687 release imported and verified 481 canonical pilot products. #689 merged the saved purchase price and stock-at-backup display. Verify the deployed Worker version before claiming #689 is live. Stock valuation, Add Product, and transaction saves remain unavailable. |
| First product in an empty database | #691 proved isolation and retry safety across two local Shop D1 databases. #692 used the existing browser form with local Workerd D1, including a lost response, retry, and reload. The form integration is test-only. |
| Owner write authority | #695 and #698 proved guard checks at insert time, safe sign-out retry, and resistance to stale grants. #701 added the disabled Shop D1 grant schema candidate. #702 added identity-bound grant publication and withdrawal. #703 added Control D1 session generations. #704 added internal publication for the exact current session, verified locally in Workerd and Chromium. None of these auth write candidates has been activated on staging. |
| New-business setup | Super Admin can reserve a business identity. Automatically creating and linking a Shop D1, applying its schema, and approving the Owner for that shop remain open. Empty businesses need no historical import. |

## Next visible milestone

**An Owner signs in and saves the first real product for one empty staging shop.** Reuse the original form and operational \`products\` table. Start with a standard product and zero opening stock. The remaining work is:

1. Connect live-candidate Owner sign-in, sign-out, and access removal to the Shop D1 grant. Keep the permission check inside the product mutation. Control D1 and Shop D1 do not share a transaction, so prove that interrupted or reordered grant updates cannot restore write access after revocation. See \`M04_ATOMIC_AUTHORITY_BOUNDARY.md\` and \`M03_G1_INTEGRATION_HANDOFF.md\`.
2. Connect the form to a real Product ID and operation receipt. Verify one save on retry, changed-payload rejection, cross-shop denial, refusal after revocation, and no committed row on failure. Reuse the #692 browser flow against the actual release candidate.
3. After current CI, review, and staging release approval, verify the first product save in the browser on the approved empty shop. Keep the existing pilot and historical archive separate from this test.

## Release order

1. Connect Add Product for verified empty shops. Prove a purchase, a POS sale, and a return against expected stock, FIFO cost, cash, and customer balances.
2. Complete Super Admin setup with business name and Owner Gmail. Create the database, apply the reviewed schema, verify the binding, and allow safe retries. Prove two shops stay isolated.
3. Resume historical imports only after the clean shop workflow works. Require per-import backup, exact reconciliation and the approved cutover process.

## Opening the next chat

> Continue SherERP Cloud issue #690. Read \`docs/CLEAN_SHOP_HANDOFF.md\`, \`AGENTS.md\`, and \`docs/PARALLEL_EXECUTION.md\` from the latest GitHub main. Verify open PRs and what is deployed, then make a high-level plan to get a new empty business working. Keep the setup simple for Super Admin, reuse the existing ERP screens, and put historical imports after the clean business workflow works end to end.
