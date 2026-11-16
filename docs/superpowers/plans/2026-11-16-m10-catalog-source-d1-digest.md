# M10-02 Catalog Source↔D1 Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans with test-first RED → GREEN and exact-head CI evidence.

**Goal:** Generate deterministic M10-01-compatible SHA-256 evidence from real persisted local D1 readback for the two approved product catalog masters.

**Architecture:** Pure Node-side digest helper reuses `prepareSourceProductCategories`, `prepareSourceProductUnits` and frozen `verifyCatalogMapping`; local-only Workerd test independently loads D1 and the existing source-shaped read adapter. No runtime activation.

**Tech Stack:** Node >=22, built-in `node:crypto` + `node:test`, existing Wrangler Workerd test harness and D1 schema `0001`–`0004`.

**Spec:** `docs/superpowers/specs/2026-11-16-m10-catalog-source-d1-digest-design.md`.

## Global Constraints
- GitHub branch/PR only; no direct main edits and no local machine access.
- Source snapshot pinned at `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
- Scope only `PRODUCT_CATEGORIES` and `PRODUCT_UNITS`; no schema, runtime, RPC, auth, cash or bank changes.
- Confidential bytes, source IDs and digests never written to CI logs, PR output or error messages.
- Do not mistake local synthetic D1 proof for real 49-group migration or production readiness.

## Review Focus
1. Source/target input object field insertion order should not affect digest; test by swapping object key order.
2. Duplicate source IDs and physical row position drift cannot produce accepted summary; negative tests.
3. Original ID modification must affect `idDigest`; test before/after D1 mutation.
4. Content-only mutation must change row digest but not ID digest; real Workerd test.
5. Unsupported group and malformed source fields must not echo private raw content; negative tests.

## Task 1 — RED contracts
**Files:** new `tests/m10-catalog-digest.test.mjs`, new `tests/integration/m10-catalog-digest-workerd.spec.mjs`.

**Interfaces:** `summarizeM10Catalog({inventory,sheetKey,rows}) -> {sheetKey,rowCount,rowDigest,idDigest}`.

- [ ] Create tests using independent source and target fixture rows. Verify paired group equality, blank/date/Unicode/leading-zero fidelity, mutation and validation failures.
- [ ] In integration test use the existing `wrangler.m02-product-units-test.jsonc`, `importSourceProductCategoriesWithD1`, `importSourceProductUnitsWithD1`, `createLegacyCatalogReadAdapter`. Verify persisted D1 distinct from source in-memory records and that actual SQL tamper is detected.
- [ ] Commit RED and open draft PR. Verify GitHub Foundation CI fails with expected `ERR_MODULE_NOT_FOUND` before adding helper.

## Task 2 — GREEN minimal isolated helper
**File:** new `src/migration/m10-catalog-digest.js`.

- [ ] Whitelist only the two reviewed groups; verify the frozen `inventory` with `verifyCatalogMapping`. Reuse M02 preflight to reject unknown/malformed source columns, missing sequential row indices, duplicates and invalid Date.
- [ ] Hash `JSON.stringify(['M10-ROW-v1',sheetKey,[[position, ...original-column-order-values],...]])` and `JSON.stringify(['M10-ID-v1',sheetKey,[[position,sourceId],...]])`, using lower-case SHA-256. Never send raw rows or digest bytes to logs, errors or a public RPC.
- [ ] Run `npm test` in GitHub Actions and check individual Workerd test result; code requires no new dependencies.
- [ ] Record exact RED and GREEN commit SHAs, CI checks, impact and limitations in draft PR, remain unmerged for owner.

## Task 3 — Verification and handoff
- [ ] Confirm the source→D1 test actually queried persisted D1 and caught SQL tamper.
- [ ] Confirm no migration, Worker route, publicly deployed binding or original GAS/Sheets files changed.
- [ ] Recheck PR against latest main; keep M10 full rehearsal as NO-GO until evidence on all 49 groups and financial/recovery gates passes.
