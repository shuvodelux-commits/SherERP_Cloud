# M10-09 — mixed authentic-ID/position-only digest comparison

> Superpowers TDD: tests first → expected RED in GitHub Actions → minimal GREEN → full exact-head CI → owner-reviewed draft PR.

**Goal:** Add explicitly limited, redacted six-group digest comparison that cannot mislabel source-row provenance as a genuine source ID and cannot certify 49-group migration readiness.

**Dependencies:** reviewed and merged M10 digest helpers for 3 catalog groups, DELETE_LOG, SALES_DRAFT_AUDIT, ID-less LOGS; reviewed frozen inventory `docs/baseline/schema-inventory.json`; M10-01 fail-closed 49-group gate.

## TDD Task 1 — RED
- [ ] Add `tests/m10-reviewed-group-parity.test.mjs` exercising exact six known groups, five original `idDigest`, single LOGS `positionDigest`, independent mismatch categories, no unknown/duplicate groups or unsafe input access, redacted only, no input mutation.
- [ ] Add new PR-only `.github/workflows/m10-reviewed-group-parity.yml`, npm CI and `node --test tests/m10-reviewed-group-parity.test.mjs`. No Wrangler install needed: comparator is pure and existing M10 D1 workflows already test the source digest producers against isolated D1.
- [ ] Commit tests and workflow **without** `src/migration/m10-reviewed-group-parity.js`, open draft PR and verify expected `ERR_MODULE_NOT_FOUND` GitHub RED.

## TDD Task 2 — minimal GREEN
- [ ] Implement pure `assessM10ReviewedGroupParity({inventory,sourceSummaries,d1Summaries})`: exact 6 reviewed headers/groups using existing M02 mapping verifiers; exact per-class summary shapes; duplicate/unreviewed detection; fixed counts, zero source details, permanent `authorizesImport:false`/`productionReady:false`.
- [ ] Run exact-head Foundation and dedicated PR-only CI test. Re-check existing M10 source-to-real-D1 jobs and public preview safety, review GitHub changed-file inventory, independent workstream status.
- [ ] Document remaining 43 unreviewed groups, no independently captured source snapshots, NO-GO full rehearsal #312 and owner review. Do not silently equate a six-group match to a live data migration.

## Scope
One new helper, unit test, workflow, spec and plan (five new M10-owned files). No shared files, no parallel PR interference, no financial posting or production migration. Revert PR for rollback.
