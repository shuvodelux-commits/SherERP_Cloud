# SherERP M02 continuation checkpoint — 2026-11-17

The owner paused because their usage limit was reached. Resume this exact
work; do not restart the audit or claim M02 complete.

## Repository and work

- Repository: shuvodelux-commits/SherERP_Cloud; canonical base main.
- Active branch: `m02/tile-measurement-revisions-0014`.
- Active draft PR: https://github.com/shuvodelux-commits/SherERP_Cloud/pull/439.
- Earlier tiles calculation PR: https://github.com/shuvodelux-commits/SherERP_Cloud/pull/438.
- Refresh both PR statuses and latest main before acting. At last observation
  #438 was unmerged, 35/36 checks passed; only broad M03 Workerd/D1 remained
  running. That workflow intentionally allows 60 minutes. Do not bypass it.
- Last inspected main: c73c333c51ea0e90e8fac73c63efb4e906c43d54.

Read AGENTS.md, docs/MIGRATION_PLAN.md, docs/WORKSTREAMS.md, ADR-007 and:

- docs/superpowers/plans/2026-11-17-m02-tile-measurement-0014.md
- docs/superpowers/specs/2026-11-17-m02-tile-measurement-0014.md

## Already completed before this pause

PR #438 implements exact rational Box/Pcs/Sqft conversion and selected-unit
pricing, immutable measurement/unit/price snapshots, and catalog-bound
product/revision/pack-factor validation. It reuses the original unit resolver
and existing M03 catalog reader. Latest-main Node 22/UTC suite passed 2,525;
27 tiles unit tests and 3 new + 5 existing real D1 catalog tests passed.
Do not duplicate that code in #439. No measurement table was in #438.

PR #439 is an independent SQL slice based on main, not a copy of #438.
Its remote test-first RED commit was
`e4930297135b572422f772c59ce33dd4c16f98bf` (local equivalent
`99e647bca2f97300e02d89a6bedf8aa10cf9956b`). Before production DDL,
Node SQLite reported missing 0014 and actual local D1 reported 13 != 14.

This checkpoint includes the newly implemented candidate:
`migrations/0014_tile_measurement_revisions.sql`.
It adds one STRICT immutable measurement table linked to existing product
and unit revisions, exact decimal-text dimensions/manufacturer coverage,
explicit evidence/policy, whole safe pieces/pack and pricing metadata.
No nominal derived area is redundantly persisted. Pack factor matching is
lexical/exact, never REAL. No new inventory, financial or return engine.

Verified after implementing 0014:

- `node --test tests/m02-tile-measurement-schema.test.mjs`: **6/6 pass**.
- `node --test tests/integration/m02-tile-measurement-workerd.spec.mjs`:
  **5/5 actual local Workerd/D1 pass**, including invalid exact decimals,
  same-revision packs, 25→24 history, concurrent duplicate insert and full
  rollback of a late batch failure.
- Workerd warned that optional Request.cf metadata could not be fetched;
  local D1 migrations and assertions executed and passed.

## Exact next work — not finished

**The schema is only a GREEN candidate for its focused tests. Full suite and
CI are NOT green yet. Do not merge this draft.**

The new test-first schema-inventory expectations already mention 0014, but
production local count/report gates and several older D1 tests still expect
13. Finish these explicit updates; do not weaken checks:

1. `scripts/audit-migration-coverage.mjs`: versioned migration count 13→14;
   canonical source groups stay 49 and fully reconciled stays zero.
2. `scripts/local-d1-schema-check.mjs`: application tables 19→20, migrations
   13→14, require `tile_measurement_guards===3`; update its success message.
3. `.github/workflows/staging-d1-local.yml`: include
   `product_tile_measurement_revisions` in local table evidence and query
   all three new trigger names as `tile_measurement_guards`.
4. Update **only** whole-candidate local migration-count assertions in:
   - tests/integration/m02-gross-parity-workerd.spec.mjs
   - tests/integration/m02-party-workerd.spec.mjs
   - tests/integration/m02-party-approval-evidence-workerd.spec.mjs
   - tests/integration/m02-m04-integrated-auth-workerd.spec.mjs
   - tests/integration/m02-product-catalog-workerd.spec.mjs
5. Search for remaining affected 13/0013 schema gates. Existing RED commit
   already updated tests/local-d1-schema-check.test.mjs,
   tests/m02-m03-migration-coverage.test.mjs, tests/m02-m04-schema-gate.test.mjs
   and tests/m04-provenance-schema-gate.test.mjs. Preserve all old protections.
6. **Do not change** `scripts/guard-remote-staging.mjs` or remote deployment
   workflow: their existing two-migration remote approval gate is intentional.
7. Run full Node 22/UTC suite, source verification, frontend build, migration
   coverage CLI, new real D1 tests and affected real D1 regression tests.
8. Review SQL boundary cases/immutability, capture final evidence in the PR,
   publish scoped commits and verify exact-head GitHub CI against latest main.

## Runtime and publication

Previous cloud checkout (may be transient):
`/workspace/scratch/2f3e8f8d4270/SherERP_Cloud`.
Always prefer a fresh GitHub checkout if that workspace no longer exists.
Runtime: default Node 24.22.1; CI uses Node 22.23.5, UTC. Use for example:

```sh
npm ci --no-audit --no-fund
npm install --no-save --package-lock=false --no-audit --no-fund wrangler@4.161.0
TZ=UTC npx --yes --package=node@22 -- node --test
node --test tests/m02-tile-measurement-schema.test.mjs
node --test tests/integration/m02-tile-measurement-workerd.spec.mjs
npm run verify:source
npm run build:frontend
node scripts/audit-migration-coverage.mjs --check
```

Git HTTPS reads worked, but push lacked CLI credentials. GitHub connector
successfully published branches, trees, commits and PRs. Use the linked
shuvodelux-commits account, not the other connected GitHub account.
Do not request or print secrets. Compare the published Git tree hash with
the tested local tree when using the connector to publish source contents.

## Mandatory boundaries

GitHub-first, KISS, observed RED→GREEN for each further code change. Preserve
all original HTML/CSS/JS and source identifiers. One business per D1; no claim
of shared-tenancy isolation. No live Sheets, private exports, remote D1,
destructive migration, production binding/login/RPC or financial activation.
No shared M03 reader/kernel changes from this branch. No auto-netting Parties
or cross-role settlement. Protected financial schema/production operations
retain owner-review gates. Actual private migration remains M10.

All 49 canonical source groups are inventoried; 30 still lack source-specific
DDL. This tile configuration increment does not complete all M02, M05–M09,
private historical reconciliation or production readiness.
