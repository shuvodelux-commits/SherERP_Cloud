# M09 — HisabIQ Dashboard Source Evidence Gate (Read-Only, Internal)

**Date:** 2026-11-17  
**Issue:** [Dashboard #567](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/567), [M09 source gate #431](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/431), [parallel coordination #456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456).  
**Starting main:** `5290a06abda5a0e42192b8bfbcc2f83e59495647`; open PRs: none at intake.  
**Original source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (frozen).  
**Scope:** M09-owned `src/modules/m09-dashboard-read-model-evidence.js` and `tests/m09-dashboard-read-model-evidence.test.mjs`, this plan, review matrix.  
**Not owned here:** `src/db/**`, `src/rpc/**`, `src/index.js`, Cloudflare Worker, `legacy/source/**`, M01 Dashboard HTML, auth/session, finance/stock/Cash posting, production D1.

## 12-sentence implementation overview

1. M01 Dashboard Steps 1–3 are merged, but dashboard summaries and details cannot become live merely because their UI navigates.
2. M09 must define each widget's exact source groups and source-reconciliation prerequisites before any financial read is activated.
3. The 15 currently shipped dashboard widget IDs are the fixed contract instead of inventing a different dashboard component.
4. Every widget requires authenticated tenant and shop-local source snapshot evidence; this boolean receipt is a *proposal*, not authorization.
5. A missing source group differs from a legitimate reviewed zero-row group and must never silently display zero.
6. Source row counts, source IDs/provenance and source deletion-state audits must independently pass before any positive pre-activation summary decision.
7. Summary evidence and record-level/point-level detail evidence are evaluated separately, with extra source items and permission/filter reviews for details.
8. Today's Sales and Sales Trend require return-lineage and economic-return-pricing reviews, while Gross Profit also requires FIFO cost and settlement-discount reviews.
9. Customer and supplier dues and finance-person roles require gross account reconciliation and reviewed source links, never a combined or auto-netted Party due.
10. Missing/invalid receipts, inherited records, accessors, Promise values and malformed counts must fail closed without evaluating getters or echoing secrets.
11. The evaluator returns only fixed diagnostic state codes, required group names and review keys, with `ready:false` for *all* outcomes, and does not read D1 or expose a public RPC.
12. Once RED→GREEN tests and full GitHub CI pass, the scoped PR is reviewed as an internal evidence contract; M03/M04/M09 later implement an independently authorized real D1 read only after source/accounting reconciliation.

## RED→GREEN ledger and verification

- RED: committed `tests/m09-dashboard-read-model-evidence.test.mjs` before implementation; initial missing module failed, then an intentional unimplemented export produced **7/7 expected failing** contract cases at commit `f1fcaf847b95d93ae32ab59e85740c98630be5e2`.
- GREEN: `src/modules/m09-dashboard-read-model-evidence.js` implements only pure, non-authorizing source receipt inspection. The focused test command `node --test tests/m09-dashboard-read-model-evidence.test.mjs` passed **7/7** at commit `d35d645ef890087f09e618c003d2c33a5d29f242`.
- End-to-end gates: full `npm test`, pinned `npm run verify:source`, `npm run build:frontend`, and mandatory full exact-head GitHub CI; **do not merge on focused tests alone**.

## Acceptance / downstream handoff

- [x] All 15 M01 widget keys mapped, including five optional original operational metrics.
- [x] Separate summary vs detail source groups; missing Sales items can block recent invoice detail while the Sales list summary remains eligible for later authenticated review.
- [x] Missing group, unreviewed source ID, deleted-row state and count drift fail closed; complete zero-row receipts are distinguishable from absent groups.
- [x] No cross-role Party netting, incomplete return-lineage or fake gross profit readiness.
- [x] Invalid untrusted objects and accessor-bearing receipts are handled without executing source getters.
- [x] `ready:false` unconditionally, even for a fully reviewed synthetic manifest; no financial values or source rows returned.
- [ ] M09 actual source-ID & row-level discrepancy ledger reconciled to original GAS and imported D1 per shop, including cancelled/deleted states and source row signatures.
- [ ] M03 awaited, tenant-bound D1 snapshot and SQL-fenced contracts reviewed; M04 session/RBAC backend permission proof accepted.
- [ ] M05–M08 source lots, returns, cash/ledger and Party role gross-account parity accepted; M10 rehearsal and M11 production gates remain separate.
- [ ] Public `getDashboardStats`/chart/point/Party detail read activation reviewed by M09/M03/M04 owners; **not in this PR**.

**Rollback:** revert this pure M09 module, test and docs; no schema migration or financial rollback.

## Relationship to existing source proof

Existing `src/modules/dashboard-contract.js` and `tests/m09-dashboard-contract.test.mjs` independently prove eleven original `Dashboard.gs::getDashboardStats` output keys against synthetic frozen-GAS fixtures. Existing `m09-reports-source-eligibility.js` gates six Reports sources. Neither attests that a tenant's imported real D1 source rows/IDs and historical return/Party financial reconciliation are complete. This new gate adds the widget-to-detail *pre-activation evidence matrix*, not a second authoritative ledger or read endpoint.
