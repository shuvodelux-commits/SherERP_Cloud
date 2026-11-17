# M03 broad local Workerd/D1 migration gate repair — 2026-11-17

**Problem:** M02 migration `0014_tile_measurement_revisions.sql` landed in main via #439, adding the immutable tile table. The repository's `scripts/local-d1-schema-check.mjs` correctly expects **14 applied migrations and 20 application tables**; the broad `tests/integration/m03-workerd.spec.mjs` retained its obsolete thirteen/nineteen expectation.

**Observed RED:** The exact-head [PR #441 broad integration run 44011818952](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44011818952) reported 565/566 Workerd tests passed, exactly one failed: `workerd applies all thirteen M02/core migrations`. Earlier pipeline #439 updated focused counts but not this broad assertion. The old test started before merge and completed failed after merge; that historical failure must remain visible and must not be rewritten as a pass.

**Minimal GREEN:** Update the existing M03 assertion to include `product_tile_measurement_revisions` in its explicit table list, expect 14 migrations and 20 application tables, and preserve every other test and original Worker route. No blanket skip, no timeout increase, no migrations, no changed runtime, no original source or UI changes.

**Verification:** Full Node test suite/source manifest/UI build and exact-head local Workerd/D1 workflow, then all review and GitHub protection gates before merging. The broad Workerd suite may have a long 60-minute budget; do not cancel, bypass or infer pass. The module remains internal and no production/staging D1 access is authorized.