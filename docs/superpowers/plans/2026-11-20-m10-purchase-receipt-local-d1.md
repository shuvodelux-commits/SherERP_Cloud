# M10 Run 8 — independent synthetic M03 purchase receipt conservation on Workerd/D1

**M10** issue #312 · **Coordination** #456 · **Draft PR** #773 · **base** `main@e81e243b94ff7712ae6c42392ae4fc4c763faf8d` · **original source** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## 13-sentence implementation overview
1. M10 Run 7 merged and established combined Party identity/gross source checkpoint proof in fabricated local Workerd/D1.
2. M03 already provides a first-purchase *test-only* SQL harness with sealed receipt lines, lots, stock, split Cash/Bank money books and Supplier Ledger journals.
3. Frozen `Purchase.gs` requires `purchase.add`, while the currently merged synthetic M03 purchase harness tests `pos.add`; M05 #767 owns the failing source-parity handoff and M03 retains SQL owner responsibility.
4. M10 must not override M03's posting SQL or claim production purchase authorization based on a green synthetic D1 receipt.
5. This run audits one independently supplied, fabricated Shop-scoped expected purchase packet against actual persisted local Workerd/D1 rows.
6. It uses exactly nine fixed parameterized, bounded, SELECT-only queries in one D1 batch, with no shared SQL migrations or UI integration.
7. The checks compare exact original-shaped purchase ID, operation ID, Supplier and Party link, receipt financial header and seal.
8. Each purchase line and related stock lot is independently checked for product, quantity, revision, original allocated paisa and stable line identity.
9. Each Cash/Bank tender must equal its money-book leg and its original Supplier-credit ledger entry; the Supplier purchase debit must equal grand total.
10. Shop product-stock delta is checked against original seeded stock plus each purchased product line, and cross-Shop source-ID reuse is intentionally rehearsed.
11. Corruption tests cover one-paisa or same-total reallocation, altered original lot, changed stock, wrong Supplier identity, late rollback, missing seal, replay, missing/duplicate rows and malformed database readback.
12. Expected fixture validation happens before D1 access; reports never reveal raw IDs, phone, SQL, customer fields or payment account values.
13. Even a fully conserved synthetic receipt reports `sourcePurchasePermissionVerified:false`, `returnReversalIntegrated:false`, `realSourceReconciled:false`, `productionReady:false` until separately accepted M03/M04/M05/M07/M08 and historical data approval.

## Ownership and environment

**Four new M10-only paths:** `src/migration/m10-purchase-receipt-local-d1-audit.js`, `tests/integration/m10-purchase-receipt-workerd.spec.mjs`, `docs/superpowers/plans/2026-11-20-m10-purchase-receipt-local-d1.md`, `.github/workflows/m10-purchase-receipt-local-d1.yml` (new PR-only workflow; M11 CI owner review needed). **Read-only dependency:** existing M03 first-purchase fixture, `wrangler.m03-first-purchase-local-test.jsonc` and its local M04 auth migrations, M05 source pinned Purchase.gs. **No modifications** to `src/db/**`, `migrations/**`, M03/M05 fixture SQL, production Worker/RPC, frontend, Cloudflare D1/bindings, source GAS or private Sheets; PR #767 source-permission RED remains independent and unresolved.

## Superpowers TDD / QA / review gates

- **RED first:** test file `85f9cd36a9a69ddd24e1c990818bc7cdb388dadd`, new dedicated no-secret PR-only workflow `471781fe724501c299d43463f454df5680dd98a5`. The missing M10 module is the expected RED failure; confirm actual GitHub run before claiming observed failing test.
- **GREEN implementation:** `da66d9b3ec07bc5191569f01e6e42e06bc4fad27`, new nine-SELECT D1 readback and independent line/lot/money/ledger/stock comparator with fixed nonproduction blockers.
- **Focused:** `node --test tests/integration/m10-purchase-receipt-workerd.spec.mjs` with Node 22, pinned Wrangler 4.161.0. Confirm 17 focused cases and add/repair tests through TDD as needed.
- **Whole repo:** exact current-head GitHub Foundation, source-inventory hash checks and all additional PR workflows; do not waive failed checks due to Cloudflare build-minute limits.
- **Independent review:** verify strict SQL allowlist, tenant/Shop scoping, no fabricated production approval, absence of real M07-return integration and known M03 `pos.add` versus original `purchase.add` source mismatch.
- **Merge:** draft until focused+full exact-head CI green, independent `/super qa → /super review`, M11 workflow-owner inspection and explicit human authorization. No auto merge. Rollback: revert four M10-only files with zero operational data migration.

## Remaining original M10 release blockers

0/49 genuine historical source groups reconciled to production/private staging as one approved migration, unapproved Shop-owned private backup custody, operational transaction writer and exactly-once return reversal, real authorization/permission review, money/FIFO/stock/returns owner financial sign-off and M11 production cutover remain NO-GO.
