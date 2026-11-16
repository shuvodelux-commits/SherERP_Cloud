# M06 Saved Drafts duplicate ID list — Superpowers TDD plan

**Goal:** Prevent a duplicate Draft ID in an authenticated tenant snapshot from becoming an apparently selectable item in the POS Saved Drafts list. The individual Draft Detail read already fails closed on duplicates.

**Stack:** Node ESM `node:test`; `src/modules/sale-draft-list.js`; no dependencies, schema or public endpoint.

**Requirements:** `docs/superpowers/specs/2026-11-16-m06-draft-list-duplicate-id-integrity.md`; `AGENTS.md`; pinned `legacy/source/DraftSales.gs`; `tests/m06-draft-list.test.mjs`.

## Test-first task
1. Extend `tests/m06-draft-list.test.mjs` with a duplicate exact Draft ID in trusted tenant rows for two different staff owners; assert `NEEDS_REVIEW: duplicate Sales Draft ID in tenant snapshot` for both a privileged manager and a regular owner whose view would otherwise hide the collision. Check two distinct IDs with the same Draft No/Customer remain valid, preserving original source output.
2. Commit only tests. Observe GitHub Node RED with `Missing expected exception`, while unique-ID parity tests pass. Log real run URL/count. Never mark a fixture error as successful RED proof.
3. In `src/modules/sale-draft-list.js`, scan **all tenant rows** for repeated nonempty exact `Draft ID` values before owner filtering; reject with one deterministic Needs Review error. Do not trim/collapse values, auto-merge, mutate, or change source-list return shape.
4. Commit GREEN. Confirm exact-head full Foundation and sibling GitHub Actions: Node regression, local Workerd/D1, Chromium and Cloudflare safety checks. Fix any introduced failures, never auto-merge.
5. Draft PR description records source, test evidence, changed-file inventory, isolation, deployment impact, rollback and remaining M06 production gates.

**Parallel ownership:** This task touches only `sale-draft-list.js`, its existing regression test, and two new docs. It must not change open PR #380 (`sales-management-list-read.js`), #388 (`sale-update-read-model.js`), #333 (synthetic posting fixture), or #313 (multi-unit conversion core). Branch/PR remain draft until owner review.
