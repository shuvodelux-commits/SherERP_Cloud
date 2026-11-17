# M03-0021 — shard complete Workerd/D1 regression without skipping tests

**Parent:** draft PR #446 (`fix/m03-workerd-migration-0014-count-0020`) repairs M02 migration 0014's stale broad 13/19 assertion. Branch is a child of #446; no direct main write or deployment.

## Twelve-sentence Superpowers overview

1. The monolithic M03 Workerd job takes over 50 minutes because `m03-workerd.spec.mjs` statically imports 44 independent integration specs before executing ten core tests.
2. Five further integration spec files run sequentially in the same job after the imported group, despite each using isolated test-only Cloudflare D1 data.
3. Split the original aggregator from its ten core tests without changing any tested behavior or test assertion.
4. Keep `m03-workerd.spec.mjs` as an import-only aggregator so existing callers still run the full identical suite.
5. Introduce `m03-workerd-core.spec.mjs` as the exact unchanged ten core tests, with its own imports and local-only Worker fixture.
6. The CI workflow will run all 44 originally imported specs, ten core tests and all five additional specs as six independent local-D1 shards.
7. Each shard uses Node 22, locked npm dependencies, pinned Wrangler 4.161.0 and `node --test --test-concurrency=1` to keep fixture isolation deterministic.
8. An independent policy job continues to run the full `npm test` baseline instead of redundantly performing it on every shard.
9. A final fail-closed aggregate job retains the original protected check name `Test read-only adapters against local workerd and D1` and passes only if source policy and every shard succeed.
10. A new Node test enforces exact once-only suite coverage, intact ten core tests, pinned runner, parallel job matrix, preserved protected check and absence of any skip/bypass controls.
11. Test-first RED must fail with the old monolithic workflow, then GREEN will be verified by actual parallel Workerd/D1 jobs and full GitHub checks.
12. The change is exclusively CI/test orchestration: no runtime Worker, source manifest, migrations, purchase/finance authorization, original UI, remote database or production deployment.

## Implementation order

- RED: commit this plan and the CI suite-coverage test before changing the aggregator/workflow; confirm specific GitHub Foundation failure.
- GREEN: atomically extract unchanged core tests into a file, retain original import-only aggregator, and update only `.github/workflows/m03-d1-workerd.yml` with 6 shards plus fail-closed aggregate.
- Verify `node --test tests/integration/m03-workerd.spec.mjs` remains a supported full-suite manual command. Inspect each shard CI result: no skipped test, no missing imported spec, and entire 14-migration/20-table gate intact. Merge to parent #446 only after exact-head CI green, reviews and branch protection. Then merge #446 safely to main, retarget/retest #447 and #445. Never infer green from old runs; do not generalize owner narrow exceptions for #439/#440.