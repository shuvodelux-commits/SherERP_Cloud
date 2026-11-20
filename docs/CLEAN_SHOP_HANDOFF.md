# SherERP clean business handoff

Start with [issue #690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690) and the latest GitHub `main`. Related workstreams are #22 for D1 and #23 for authorization. Before editing, check the open PRs, current CI, `AGENTS.md`, and `docs/PARALLEL_EXECUTION.md`. Review status in GitHub takes precedence over this dated summary.

## Tenant Control Center Run 1 checkpoint — 20 November 2026

- [#720](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/720) is merged as the RED checkpoint. A valid Super Admin session reached Create Business in local Workerd/D1, and the existing route returned HTTP 400 for a valid business name and Owner Gmail. Continue the implementation in [draft #722](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/722) on `integration/control-center-resumable-green`.
- The M03 backend at `4ccb5b40` passes the merged RED test. Create Business records one durable reservation and Gmail intent per operation, returns the same shop on replay, and rejects changed intent. Status and Resume require a current Super Admin session. Resume reconciles an interrupted allocation using the original attempt, verifies the actual disposable Shop D1 binding before DDL, then checks Shop identity and pinned migration receipts. A guarded Control D1 transition publishes readiness and one local Gmail approval together.
- Local tests covered concurrent Create Business and Resume, a lost allocation response, a swapped blank binding, a skipped readiness write, and session revocation before approval. The focused Workerd tests passed, along with the existing local Access release suite and both existing Control Center and Owner Chromium tests. GitHub exact-head status is in [#722 Checks](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/722/checks). Independent re-review found no remaining high-severity issue in the reviewed backend.
- **UI GREEN continuation:** The owner explicitly authorized the scoped M03/M01 UI integration in [M01 handoff comment #7030386265](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/25#issuecomment-7030386265). The existing Control Center HTML/JavaScript now exposes Owner Gmail only in the server-declared local mode, keeps the legacy name-only reservation unchanged, shows safe setup/failure stages, and can Resume the same saved operation after reload or a lost allocation response. Browser regression `qa/m03-control-center-provisioning-page.spec.mjs` uses actual disposable Workerd/D1 bindings and deposits 390px recovery/ready and 1440px ready Chromium screenshots under `test-results/m01-browser/`. M01 Chromium CI imports the test after installing the pinned Workerd runtime. The original Platform/Owner browser tests passed locally alongside the new UI test; full exact-head CI and independent M01/Super QA/Super Review remain prerequisites to merging #722. [M03 assignment](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/22#issuecomment-7030088112) · [File reservation](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456#issuecomment-7030092096)
- An ambiguous allocation stays pending until the provider can attribute it to the original attempt or an operator reconciles it. Hosted provisioning, remote migrations, real Owner access, public RPC, and financial posting remain gated separately.

## Run 2 resume checkpoint

- PR #706 merged on GitHub main at `6325c83d0d1f088996e2ed0c107695e27a246efb`. It completed the private Owner grant lifecycle and left the flag disabled in checked-in deployment profiles.
- Run 2 belongs to M03 with M01 browser verification under #690. The isolated branch is `integration/owner-first-product`, initially created in `/tmp/shererp-run2-product`. Check the branch and PR status on GitHub before resuming. If opening a new chat on the owner's machine through Remote Desktop Commander, use the worktree path only if it still exists. GitHub is the canonical branch and evidence.
- RED evidence on the Run 2 branch. The private product POST returned 404 before route integration. The original Add Product button was still hidden in Chromium when the browser test first ran through the private Worker.
- GREEN evidence. The private Owner Worker now creates a Standard product with zero opening stock and reads it from the operational catalog. The Shop D1 grant, product row, receipt, and source-format PRD sequence are checked or written in the same database transaction. The browser keeps the operation ID after a lost save response and reloads the committed row.
- Local verification passed for the affected D1 and Chromium tests. Follow the Run 2 PR's Checks tab for results on the published commit. Merge only after review and full CI. No remote migration or deployment activation was performed.
- Private staging prerequisite after separate approval. Apply the reviewed operational product and Owner grant migrations, then `staging-migrations/shop-owner-write/0003_owner_product_create_receipts.sql` on a verified empty Shop D1. Enable `OWNER_CLEAN_PRODUCTS_ENABLED` with the existing Owner catalog and grant flags only for that candidate. Confirm the browser flow before staging sign-off. To pause product creation, turn off the clean-products flag and retain the operational rows and receipts.
- Next implementation gate is Run 3 under #690 and #456. Use the existing purchase Workerd proof to verify supplier obligations, lot and movement IDs, exact cost, authenticated receipts and reversal lineage on the reviewed schema. Ask for separate approval before any staging activation. If a fresh chat is opened through Remote Desktop Commander, paste this checkpoint and continue from the GitHub branch or merged SHA.

## Earlier pilot evidence

The table below records pilot evidence through `7ff6050` (#704). The [clean business milestone #690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690) remains open.

| Area | Status |
| --- | --- |
| Owner staging | Google sign-in and read-only Products are live. The #687 release imported and verified 481 canonical pilot products. #689 merged the saved purchase price and stock-at-backup display. Verify the deployed Worker version before claiming #689 is live. Stock valuation, Add Product, and transaction saves remain unavailable. |
| First product in an empty database | #691 proved isolation and retry safety across two local Shop D1 databases. #692 used the existing browser form with local Workerd D1, including a lost response, retry, and reload. The form integration is test-only. |
| Owner write authority | #695 and #698 proved guard checks at insert time, safe sign-out retry, and resistance to stale grants. #701 added the disabled Shop D1 grant schema candidate. #702 added identity-bound grant publication and withdrawal. #703 added Control D1 session generations. #704 added internal publication for the exact current session, verified locally in Workerd and Chromium. None of these auth write candidates has been activated on staging. |
| New-business setup | Super Admin can reserve a business identity. Automatically creating and linking a Shop D1, applying its schema, and approving the Owner for that shop remain open. Empty businesses need no historical import. |

## Next visible milestone

**An Owner signs in and saves the first real product for one empty staging shop.** Reuse the original form and operational `products` table. Start with a standard product and zero opening stock. The original sequence was:

1. Connect live-candidate Owner sign-in, sign-out, and access removal to the Shop D1 grant. Keep the permission check inside the product mutation. Control D1 and Shop D1 do not share a transaction, so prove that interrupted or reordered grant updates cannot restore write access after revocation. See `M04_ATOMIC_AUTHORITY_BOUNDARY.md` and `M03_G1_INTEGRATION_HANDOFF.md`.
2. Connect the form to a real Product ID and operation receipt. Verify one save on retry, changed-payload rejection, cross-shop denial, refusal after revocation, and no committed row on failure. Reuse the #692 browser flow against the actual release candidate.
3. After current CI, review, and staging release approval, verify the first product save in the browser on the approved empty shop. Keep the existing pilot and historical archive separate from this test.

## Release order

1. Connect Add Product for verified empty shops. Prove a purchase, a POS sale, and a return against expected stock, FIFO cost, cash, and customer balances.
2. Complete Super Admin setup with business name and Owner Gmail. Create the database, apply the reviewed schema, verify the binding, and allow safe retries. Prove two shops stay isolated.
3. Resume historical imports only after the clean shop workflow works. Require per-import backup, exact reconciliation and the approved cutover process.

## Opening the next chat

> Continue SherERP Cloud issue #690. Read `docs/CLEAN_SHOP_HANDOFF.md`, `AGENTS.md`, and `docs/PARALLEL_EXECUTION.md` from the latest GitHub main. Verify open PRs and what is deployed, then make a high-level plan to get a new empty business working. Keep the setup simple for Super Admin, reuse the existing ERP screens, and put historical imports after the clean business workflow works end to end.
