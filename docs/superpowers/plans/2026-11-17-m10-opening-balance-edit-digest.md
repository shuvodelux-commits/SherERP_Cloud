# M10-10 — original opening-balance audit ID and historical amounts parity

**Requirements:** GitHub-first Superpowers test-first TDD, KISS, no auto-merge. Frozen source pin `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Spec:** `docs/superpowers/specs/2026-11-17-m10-opening-balance-edit-digest-design.md`. **Gate:** #312.

**Dependency:** merged M02 `src/db/opening-balance-edit-audit-mapping.js`, `src/db/opening-balance-edit-audit-import.js`, `migrations/0010_legacy_opening_balance_edit_audit.sql`, `wrangler.m02-opening-balance-edit-audit-test.jsonc`.

## Task 1 — RED
1. Create `tests/m10-opening-balance-edit-digest.test.mjs` with independent SHA-256 canonical row + original-ID expectations, source negative-zero/precision/Unicode/date fidelity, original Audit ID changes, content drift without ID drift, truncated snapshot, missing/duplicate rows, extra/symbol/accessor fields and frozen 49-inventory protection.
2. Create `tests/integration/m10-opening-balance-edit-digest-workerd.spec.mjs` using actual local Workerd/D1 and the merged M02 offline importer; SQL SELECT persisted values and independently project to source-shaped rows; confirm hash equality, immutable UPDATE/DELETE refusal, tampered readback copies and replay denial. Never mutate stored history for test tampering.
3. Add standalone PR-only `.github/workflows/m10-opening-balance-edit-digest-local-d1.yml` so the tests run in GitHub with Node 22, `npm ci`, pinned Wrangler only on CI and isolated D1. Commit tests and CI without implementation; open owner-reviewed draft PR; verify `ERR_MODULE_NOT_FOUND` expected RED from GitHub Actions.

## Task 2 — GREEN
1. Create **only** `src/migration/m10-opening-balance-edit-digest.js` using existing frozen M02 source validation and canonical `M10-ROW-v1` / `M10-ID-v1` domain-separated SHA256. No D1 calls, network, credentials, balance calculations, ledgers or public routes.
2. Run fresh GitHub exact-head Foundation suite, dedicated unit/isolated D1 Workerd tests, existing migration workflows, preview safety and regression CI. Diagnose any non-RED failures from actual logs before code edits.
3. Check changed files against latest `main`, no overlap, update draft PR with RED/GREEN job evidence, and do **not** merge.

## Task 3 — review
Only six M10-owned files (spec, plan, pure helper, two tests, independent PR-only workflow). Synthetic offline proof, not the owner-authorized private Sheets export or 49-group real D1 import. M10-09 existing six-group reviewer remains deliberately unchanged, as do source/finance/accounting and production D1. Revert PR to rollback. Owner must approve the PR merge and eventually a separate backup/cutover.
