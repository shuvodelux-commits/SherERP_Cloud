# M03 — Stabilize real-D1 Expense Categories read-only proof

**Evidence:** PR #376 M03 Worker-runtime real D1 job 133396634052, run 43895169243; 485 of 486 tests passed, with the only failure in `tests/integration/m03-expense-category-read-workerd.spec.mjs:61`. Original source remains frozen at `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Follow `AGENTS.md`, `docs/WORKSTREAMS.md`, Superpowers root-cause debugging and RED→GREEN.

## Review and implementation overview (12 sentences)
1. This issue is isolated to the M03 read-only Expense Categories local Workerd/D1 integration test.
2. The test reads identical stored rows before and after two adapter operations.
3. Its existing full-response deep equality unintentionally also compares D1 query timing metadata.
4. Real D1 reports nondeterministic `meta.duration` and `meta.timings.sql_duration_ms` values even when the rows do not change.
5. The observed RED failure compared 1ms against 0ms, with no returned row difference.
6. This is a test assertion defect and does not establish an expense accounting or database integrity failure.
7. We will retain the test's original before-and-after SQL queries and original adapter calls.
8. The assertion will compare `sourceBefore.results` to `sourceAfter.results` exactly, preserving physical sheet row order and every stored column.
9. The test will still require D1's read-only response metadata to report no writes for its post-read SELECT.
10. The existing denied public RPC/health routes, forbidden registry checks and no remote D1 binding remain unchanged.
11. No production adapter, SQL migration, business data, Cloudflare deployment configuration or unrelated workstream will be modified.
12. The existing failing real-D1 test is accepted as RED evidence and the change requires a fresh M03 exact-head GREEN result plus all applicable repository CI before owner merge.

## TDD steps and release gates
- RED: [existing failing M03 job](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/43895169243/job/133396634052): `not ok 3 - new read is D1 read-only` where D1 `duration:1` vs `0` and `sql_duration_ms:1` vs `0`; all 485 other integration tests passed.
- GREEN: one test-only assertion change in `tests/integration/m03-expense-category-read-workerd.spec.mjs`.
- Retain deterministic provenance, source row comparisons and public API isolation.
- New isolated GitHub branch and PR, with no direct main commit. Require current-head CI for merge.
- On owner merge, refresh PR #376 to include the fix, then verify its own current-head CI. Never merge #376 based on stale old-head runs.
