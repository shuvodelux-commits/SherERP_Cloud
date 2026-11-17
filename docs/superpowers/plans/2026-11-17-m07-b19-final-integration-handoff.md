# M07-B19 — Final Returns & Corrections Integration Handoff

**Date:** 2026-11-17. **Source:** `main@59b0e2e4b7184acf2f3645aca32da1cb1c6d5cb3`. **Own lane:** M07. **Coordination:** issue #456, module issue #314. **Merged dependency:** M07-B18 PR #554 (merge `f3538ee3fb50b7f46fafd9bfb2f691aefe179a51`).

## Implementation overview — 12 sentences
1. M07 has progressed through isolated return calculation, original-lot protection, batch reservation, purchase correction evidence and source-level tests.
2. These contracts are deliberately read-only and do not authorize a production financial posting operation.
3. B19 will publish a single M07-owned integration manifest naming the actual exported functions, source files, test suites and safety classifications.
4. The handoff will distinguish original Sales Return Edit/Delete support from the frozen Purchase Return create/view-only behavior.
5. The M03 owner must use the handoff to implement one shared SQL-atomic posting and reversal boundary, not another M07-specific writer.
6. The M04 owner must establish trusted tenant, actor, session, permission and backdate authority within that boundary.
7. The M05 owner must supply historical lot and immutable unit/factor/price source snapshots while retaining source IDs.
8. The M06 owner must supply original sale consumption, vendor/negative/Bundle source attribution and payment/return provenance.
9. The M08 owner must reconcile Cash/Bank and gross Customer, Supplier and Vendor role accounts without any automatic cross-role settlement.
10. M10 must compare real original records and each historical lot/account state before enabling deployment.
11. B19 will add a targeted, read-only manifest integrity test to prevent handoff references silently drifting from existing GitHub modules.
12. Completion of B19 will mean the M07 preparatory artifact is review-ready, not that returns, correction RPC or exact-once production reversal is deployed.

## Exclusive files
- `docs/m07/INTEGRATION_HANDOFF.md`
- `docs/m07/contracts.json` (read-only manifest, not runtime config or a feature flag)
- `tests/m07-integration-handoff-manifest.test.mjs` (manifest/source integrity proof)
- `docs/superpowers/plans/2026-11-17-m07-b19-final-integration-handoff.md`

**No other edits:** no `src/db`, migrations, `src/rpc`, Worker entry/config, shared posting/receipt kernel, `src/modules` runtime, authorization, original GAS, frontend, or M05/M06/M08 modules. This is a documentation + test-only change; a contrived RED assertion for absent docs is not required. Full existing CI on the exact final SHA and owner review still apply.

## Acceptance
- A documented machine-readable list of every M07 integration surface with exact existing repo paths and exact named exports.
- All manifest exports resolve to actual JavaScript module exports (no invented RPC route or writer).
- Manifest names its evidence as **isolated**, and declares `productionIntegrationReady:false`, `publicRpcEnabled:false`, `livePostingVerified:false`, `sharedReversalReady:false`.
- The original source function names are checked against frozen `SalesReturn.gs` and `PurchaseReturn.gs`; absence of native purchase edit/delete is explicitly asserted, not misrepresented as a source migration.
- The test validates that source, test and integration fixture file references exist, and the handoff never marks a synthetic/local-D1 test as an actual production posting acceptance.
- Full CI and safe preview; no force-green, no direct `main` commit, no production D1 migration.

## Integrator requests, not changes to shared infrastructure
1. M03 must version one posting/reversal interface and provide trusted original row snapshots plus original source ID, actor, tenant and transaction hash; pin applied source-lot IDs, source row identities and cash/account changes in the same SQL transaction.
2. M03 must treat identical retries as `REPLAY` only from the committed immutable journal, competing operation IDs on one original as `CONFLICT`, stale/partially missing histories as `NEEDS_REVIEW`, and injected failures as all-or-none rollback.
3. M04 must validate live session, role permission, locked/inactive account, active Cash Session policy and signed actor identity at the commit boundary (never trust a client permission flag or a read-only preflight result).
4. M05/M06 must freeze original conversion/factor/price snapshots, sales FIFO consumption including vendor/bundle/negative provenance, supplier purchase original lots and original product stock CAS/revision.
5. M08 must identify the correct gross original Customer/Supplier/Vendor account, Cash/Bank leg, credit/advance treatment and any later settlement that blocks reversal.
6. M10 and M11 must require reconciled real source snapshots, branch-safe staging tests, retry/concurrency tests, recovery drill, owner signoff, and separate production launch authorization.

Rollback removes only the four M07-owned documentation/test files. Do not edit the central readiness gate from this lane.
