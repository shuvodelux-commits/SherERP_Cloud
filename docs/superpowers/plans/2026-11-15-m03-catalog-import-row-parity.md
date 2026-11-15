# M03 — Source-row parity gate for catalog dry-run importer

## Context and authority

- Continue the owner-approved M03 read-adapter work from PR #17, based on the pinned original `legacy/source/Database.gs` and `Config.gs`.
- `createLegacyCatalogReadAdapter` requires every imported `PRODUCT_CATEGORIES` and `PRODUCT_UNITS` row to have contiguous `legacy_sheet_row` values 2..N+1, with no more than 1,000 rows.
- `prepareCatalogImport` currently allows missing row positions, gaps and oversized catalog groups, creating a dry-run success that cannot be read by M03.
- This PR is a safe preflight-only, no schema, no write, no RPC, no remote D1 change.

## Tasks (RED → GREEN → verification)

### Task 1 — Source-aware failing tests

- Add tests in `tests/catalog-import.test.mjs` for missing `_rowIndex`, first-row gap, interior gap, reversed physical order and 1,001 rows for either of the two reviewed catalogs.
- Explicitly preserve a valid 2,3 import, an empty catalog, and Settings' existing standalone behavior.
- Run `node --test tests/catalog-import.test.mjs` and observe intentional assertion failures caused by missing validation.

### Task 2 — Narrow validation

- Add bounded, contiguous source position checks **only** for `PRODUCT_CATEGORIES` and `PRODUCT_UNITS` in `src/db/catalog-import.js`, after record conversion and existing duplicate validation.
- No auto-renumbering, no fuzzy identity matching, no read adapter changes.
- Run targeted tests, then `npm test`. Expected: all pass, zero failures.

### Task 3 — Contract documentation, branch review and handoff

- Document fail-closed dry-run behavior and limitation: owner-authorized export must include physical Sheet row positions for the two catalogs.
- Re-run full tests, original source check and frontend build. `git diff --check` zero failures.
- Review all changed files for data leaks, insecure SQL, altered financial/Party semantics and accidental deployment modifications.
- Create a reviewable stacked PR targeting the PR #17 branch; **do not merge**, deploy, or touch staging/production D1.

## Review focus

- A valid Sheets export with no gaps must continue to import deterministically.
- Invalid physical positions must fail before any migration can be attempted, without changing original IDs.
- Settings values must not leak into summaries or errors; no financial or secret data is emitted.
- This is not full M03 and not permission for production database writes.
