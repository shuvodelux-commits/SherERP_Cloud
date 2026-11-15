# Superpowers TDD Plan — M02-P Real Workerd/D1 Reviewed Evidence Adapter

Date: 2026-11-15. Spec: `docs/superpowers/specs/2026-11-15-m02-reviewed-evidence-real-d1-design.md`. Source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.

## Task 1 — RED in GitHub, no production code

- Create a dedicated new `tests/integration/m02-reviewed-evidence-workerd.spec.mjs` and PR-only `.github/workflows/m02-reviewed-evidence-workerd.yml`. Use current `wrangler.m02-plan-test.jsonc`, pinned Wrangler 4.161.0, locked app dependencies, and local ephemeral D1.
- Build **complete** source-shaped synthetic master rows from frozen inventory and existing five-record fixture; do not touch or alter pinned original sources. Use existing `compileSyntheticPartyImport` **only in test setup** to populate ephemeral local D1.
- Tests: actual D1 three-table readback through new adapter; exact single `SELECT` batch and no SQL writes; current approvalRef loss reported as blocker; correct source counts; no public test/RPC endpoint; unchanged DB row counts; incomplete source headers, changed balance, unsafe phone and unapproved linkage prevent even one D1 query; invalid results, nontrue success, binding errors, thrown source errors redacted; caller inputs untouched.
- Commit **tests, workflow, spec and plan only** and open draft GitHub PR, record actual expected RED workflow `ERR_MODULE_NOT_FOUND` for missing new module. Do not add implementation until observed.

## Task 2 — Minimal GREEN module

- Create **only** `src/party/d1-reviewed-import-evidence.js`. Use `validatePartyImportCandidate` to check source first; on blocked stage call `reconcileReviewedPartyImport` for its redacted skipped response without touching DB.
- Otherwise call one fixed `DB.batch` of three prepared `SELECT` queries. Require each result `success===true` and array rows. Pass constructed `readback` through `reconcileReviewedPartyImport`; never return private records.
- Treat exceptions as one generic sanitized error. No dynamic identifiers, SQL writes, new dependencies, production deployment or schema changes.

## Task 3 — Verify exact-head and publish proof

- Verify new independent real Workerd/D1 workflow with no network/remote Cloudflare writes, and existing Foundation Node suite/84 frozen GAS/36 source UI includes, M01 Chromium, M02 Party real D1 and synthetic rehearsal, M03 real D1, M04 auth, Cloudflare PR safety.
- Verify exactly **five new files**, no existing shared module changes or conflicts, source provenance, environment gates and rollback. Update PR body with RED/GREEN hashes and exact check conclusions. Leave draft/unmerged pending owner.

Rollback: revert independent PR. Current Party schema still lacks `approval_ref`, reviewer authorization and full account reconciliation.
