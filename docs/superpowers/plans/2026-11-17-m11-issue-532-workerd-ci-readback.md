# M11 #532 — Execute the unsharded private 49-group M03 D1 readback spec in required CI

**Workstream:** M11 shared CI owner; **issue:** [#532](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/532); M03 owner/coordinator: [#22](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/22), parallel board [#456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456).  
**Base:** `main@319ea3ef688af60069036eb5d67b4d56d52dd2a2` (2026-11-17).  
**Original business source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (frozen, read-only).  
**Upstream:** merged M03 PR #523 introduced `tests/integration/m03-frozen-source-readback-workerd.spec.mjs`; this is on main but not in the existing six-shard required M03 Workerd CI matrix.

## Implementation overview (12 sentences)

1. M03 PR #523 added four local Workerd/D1 test cases for frozen 49-group source readback and tampering.
2. The six-shard required M03 CI workflow does not currently enumerate that test file.
3. The current sharding membership oracle combines 45 aggregator imports with five explicit independent tests.
4. A green M03 workflow can therefore report success even though this newly added high-risk Workerd test is never executed.
5. This task is owned by M11 as a shared CI coverage fix, while M03 remains the exclusive owner of source readback logic and the common database schema.
6. First, the M11 branch will update the Node sharding test oracle to require the frozen-source readback test exactly once, while leaving the workflow unchanged.
7. Running that RED test against the existing workflow should fail for the missing required filename, with the observed failure recorded honestly.
8. Second, the minimal GREEN implementation will insert the Workerd test filename into exactly one of the six existing shard lists, without adding a new shard or changing isolation.
9. The original specification must still test exact 49-group readback, unchanged private archive and unavailable public route, rejection of forged price rows, and rejection of unsealed data.
10. The workflow must retain no-secrets pull-request-only triggers, pinned test runner, isolated Workerd/D1, serial per-shard execution, and its fail-closed aggregator.
11. Run the exact-head complete GitHub Actions matrix and inspect the new shard logs for actual four-case execution before proposing a merge.
12. A successful fix closes this CI test selection gap only, and does not authorize production D1 import, any public financial RPC, or M10/M11 cutover.

## Exact file ownership / risk and rollback

- **M11-owned shared CI paths (approved specifically in #532):** `.github/workflows/m03-d1-workerd.yml`, `tests/m03-workerd-ci-sharding.test.mjs`.
- **M11 plan path:** this document.
- **Do not edit:** `src/db/**`, `migrations/**`, `src/rpc/**`, `src/index.js`, `src/modules/**`, actual source readback adapter, `tests/integration/m03-frozen-source-readback-workerd.spec.mjs`, `wrangler*.jsonc`, original front-end or source GAS/Sheets.
- **Data access:** synthetic test-only local Workerd/D1, no actual private source rows, remote D1 import, Worker deployment, secrets or admin policies.
- **Expected functional impact:** one exact CI matrix filename, one Node membership oracle extension; zero business logic, database shape, accounting balances, original IDs or UI effect.
- **Superpowers proof:** commit RED test-only first; preserve/redact actual GitHub failure evidence; commit minimal GREEN matrix change; run full current-head workflows, review and merge to main only after all required checks and owner protection review.
- **Rollback:** revert two CI/test changes and this plan. However doing so restores a known mandatory-test-coverage blind spot; review before reverting.

**Release:** M03 parallel-shared-transaction-writes **BLOCKED**; M10/M11 production **NO-GO** independently of this issue.
