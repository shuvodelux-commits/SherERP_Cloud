# M03 Run 7 — Correct original purchase.add authorization in local SQL purchase proof

**Repository:** `shuvodelux-commits/SherERP_Cloud` · **M03:** #22 · **M05:** #314 · **M04:** #23 · **M08:** #66 · **Coordination:** #456 · **M11:** #306.
**Main at branch:** `e81e243b94ff7712ae6c42392ae4fc4c763faf8d`; merged M03 #758 and #763 confirmed.
**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` — original `legacy/source/Purchase.gs::createPurchase` checks `requirePermission_(token,'purchase','add')` followed immediately by `requireActiveCashSession_()`.
**M05 independent RED:** [#767](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/767) exposes the test-only first-purchase `pos.add` mismatch and Foundation failing regression [#44691323624](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44691323624). That separate M05 PR owns its own 3 files. Do not edit M05 paths or merge #767 RED before source permission has passed real tests.
**Exclusive M03 files:** this NEW plan, `tests/integration/m03-first-purchase-atomic-workerd.spec.mjs` (append RED+adjust existing role seeding), and `tests/fixtures/m03-first-purchase-atomic-local.mjs` (exact one SQL JSON action literal for GREEN); no shared database/migrations/Worker/RPC/Source, UI, release CI or other module files.
**No operational financial posting/deployment/remote D1.**

## 12-sentence module overview

1. Merged #758 provides a local Workerd+D1 atomic first-purchase proof with actual M04 session tables and synthetic purchase, supplier, stock and payment tables.
2. Independent M05 QA demonstrated the original `createPurchase` requires `purchase.add` rather than the `pos.add` currently used by the M03 fixture.
3. Granting POS sale permission must not permit a supplier purchase or stock acquisition.
4. A user with `purchase.add=true` and `pos.add=false` must be permitted to purchase when all other source requirements pass.
5. The purchase role matrix must be enforced by the SQL authorization predicate at the database operation boundary, not by browser navigation modules or a cached frontend profile.
6. The original always-active Cash Session requirement remains in force in this local proof even for zero-paid and Bank-only purchases.
7. A fully unpaid 1-Pcs 0.335 BDT purchase must create exactly a 34-paisa Supplier Ledger Debit and zero Cash/Bank money rows.
8. A role grant revoked between preflight and the SQL batch must leave purchase, lot, stock and Supplier ledger unchanged.
9. Historical original Cash Session behavior remains unaffected by this synthetic permission correction.
10. The new RED test will be committed and observed in the repository's existing PR-only M03 real Workerd workflow before changing the fixture.
11. The minimal GREEN SQL correction and source-shaped role seed must preserve all existing 23 first-purchase Workerd integration regressions and full GitHub CI.
12. Independent M03/M05/M04/M08/M11 review and explicit owner merge approval remain mandatory, and production posting remains blocked by source identity, numeric maxima, reconciliation and release gates.

## Acceptance and non-goals

- M03 alone edits its local SQL fixture and its own Workerd acceptance suite; M05 #767 remains a separate test owner with an independent PR.
- Actual authorized predicate is exactly `$.purchase.add`, checked inside the `CURRENT_AUTH` SQL reused for preflight, insert and replay.
- Test role metadata can be additive even without purchase.view; Allowed Modules tracks view only and never authorizes purchase independently.
- Keep source `requireActiveCashSession_()` regardless of tender method in existing local model.
- No real Shop schema or operational purchase, no public RPC, no Worker deployment, no remote D1 or historical migration, no merchant money.
- Coordinate M05 rebase and run its independent Workerd two-role suite once the M03 correction is green; do not claim M05 acceptance if not actually run.
- M08 HALF_UP/integer-paisa design approved for NEW shops but upper limits, source Supplier/Party provenance, historical reconciliation and M10/M11 release remain unsigned.
