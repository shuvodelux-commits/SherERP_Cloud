# M10-07 — Draft invoice audit ID/row digest implementation plan

> **Execution:** Superpowers RED → verify CI failure → minimal GREEN → all exact-head GitHub CI → owner review, no auto-merge.

**Goal:** Independently compare original frozen SALES_DRAFT_AUDIT source with actual isolated D1 persisted records using authentic Audit ID and eleven-column row SHA-256.

**Dependencies:** M02 `sales-draft-audit-mapping.js`, `sales-draft-audit-import.js`, `0008_legacy_sales_draft_audit.sql`, local-only `wrangler.m02-sales-draft-audit-test.jsonc`.

**Source pin:** `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Design:** `docs/superpowers/specs/2026-11-16-m10-sales-draft-audit-digest-design.md`.

## Task 1 — RED tests
- New `tests/m10-sales-draft-audit-digest.test.mjs`: independent expected hash, authentic source Audit ID semantics, source Timestamp Date/text, Version '02' fidelity, Unicode, rekeying invariance, duplicate IDs/invalid action/extra field/accessors, truncated snapshot differences and fixed redacted errors.
- New `tests/integration/m10-sales-draft-audit-digest-workerd.spec.mjs`: existing M02 importer into local actual Workerd/D1, independently SQL query readback, hash match, D1 UPDATE/DELETE immutability, audit content/ID drift via changed readback copies, denied replay/HTTP route.
- Add PR-only step in existing `.github/workflows/m10-catalog-digest-local-d1.yml`. Commit before implementation, verify expected `ERR_MODULE_NOT_FOUND` in GitHub Actions; draft PR.

## Task 2 — GREEN
- Add only `src/migration/m10-sales-draft-audit-digest.js`, using M02 preflight and reviewed frozen header mapping, canonical M10 row/id domain separation and no source/remote data access.
- Verify dedicated local real D1 integration and full Foundation `npm test`, fix unexpected test failure before status claims.
- Record RED/GREEN exact job links/results in draft PR. Inspect current main and changed-file overlap.

## Task 3 — Owner handoff
- No M02, SQL/schema, original GAS, live Sheets, production D1, frontend, RPC, auth, finance, Party, sale-draft writer, preview binding changes. Keep M10-01/03 49-group release blocks unconditional; reversible scoped PR.
- Do not merge. Owner reviews checks and approves integration.
