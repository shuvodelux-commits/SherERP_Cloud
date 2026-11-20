# M10 Run 6 — three-group real local Workerd/D1 cross-packet readback

**Issue:** #312 · **coordination board:** #456 · **draft PR:** #753  
**Base:** `main@5583170342c392e51d889d6f22f91c164ba160cc` after verified merge #746.  
**Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Twelve-sentence scoped implementation overview

1. Previous M10 runs proved synthetic SQLite recovery but did not demonstrate a combined, independent Workerd/D1 readback using existing ERP migrations.
2. M02 already has approved source-shaped importers for PRODUCT_CATEGORIES, PRODUCT_UNITS and EXPENSE_CATEGORIES on the present local D1 schema.
3. This run introduces a dedicated read-only M10 comparator for exactly those three groups, not a new operational table or a second importer.
4. It validates the frozen 49-group schema inventory and source physical positions through existing M02 preflights before accessing D1.
5. It constructs one fixed three-SELECT D1 batch, each result bounded to 1,000 rows and ordered by original physical sheet position.
6. The independently persisted D1 rows are compared with their original source IDs, per-row positions, original labels, status, descriptions and text dates.
7. Missing, extra, duplicated, incorrect original ID and ordinary field changes produce deterministic aggregate discrepancy codes, without outputting original ID values.
8. A synthetic interruption where only two groups were imported must not pass as three-group parity, and a duplicate replay must not insert extra records.
9. Invalid supplied source shapes and failed, ambiguous or malformed D1 result envelopes must fail closed without leaking SQL, source labels or driver exceptions.
10. An M10-owned PR-only, secret-free workflow runs the integration tests with actual local Workerd/D1, pinned Wrangler, and the existing fourteen D1 migration scripts.
11. Test-first RED, smallest GREEN, complete current-head GitHub CI, M11 workflow-owner review and independent Super QA/Review must precede any human-approved merge.
12. Passing is **three of forty-nine groups using fabricated inputs**, not a real historical import, cross-role accounting reconciliation, authenticated private backup or authorization for production cutover.

## Exclusive file ownership and safe parallelism

- **New M10-only implementation:** `src/migration/m10-local-d1-three-group-audit.js`.
- **New M10-only test:** `tests/integration/m10-three-group-audit-workerd.spec.mjs`.
- **New M10 PR-only workflow:** `.github/workflows/m10-three-group-local-d1.yml` (M11 CI-owner review required; no Cloudflare deploy, network/secret or remote D1).
- **This plan:** `docs/superpowers/plans/2026-11-20-m10-three-group-local-d1.md`.
- **Read only:** existing `wrangler.m02-party-test.jsonc`, `migrations/**`, `docs/baseline/schema-inventory.json`, and M02 source import/readback modules.
- **Not edited:** `src/db/**`, shared SQL, `src/rpc/**`, `src/index.js`, Worker bindings, existing GitHub workflows, auth, finance, UI, legacy GAS/Sheets, actual private exports, cloud or remote D1.
- **Parallel:** independent M02 #748, M03 #751, M04 #745, M05 #750, M01 #749 have disjoint file ownership. No shared runtime changes.
- **Rollback:** revert four entirely new M10 files; no database rollback needed.

## Superpowers TDD + acceptance

- **RED:** `1783cfb4691f7d57ba7b7cbf64bd17d54de7ea3d` test-first module import; PR-only workflow `3eef75205c2b328ae166d776a1460f67a0544e16`. Actual GitHub [M10 three-group run 44687128263](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44687128263) failed with expected `ERR_MODULE_NOT_FOUND` for new M10 helper, not production code.
- **GREEN:** `233f2eeddf47d2bccbe718c3f421e68fbcf67df8` pure read-only comparator that validates source snapshots and queries the real local D1 in one batch.
- **Focused:** `node --test tests/integration/m10-three-group-audit-workerd.spec.mjs` (requires Wrangler, actual D1 test harness).
- **Foundation:** `node --test`, `npm run verify:source`, and all current-head PR workflows.
- **Review:** public Worker returns 404 to write routes, zero real imports/data, fixed SQL, bound LIMIT, no source values in output, exact 3-group schema ownership, normal ID/physical row/field drift, malformed D1 envelope fail-closed, no preflight D1 writes.
- **Release:** This PR must never clear the M10 real 49-group acceptance gate or M11 launch readiness. Owner approval required for merge only after independent QA/review and full exact-head CI.
