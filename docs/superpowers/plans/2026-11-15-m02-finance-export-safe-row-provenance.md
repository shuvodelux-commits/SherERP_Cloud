# M02-P Finance Export Safe Source Row Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Follow test-first failing regression, minimal implementation and exact-head GitHub verification.

**Goal:** Reject unsafe JavaScript integer sheet-row locators in the offline Finance transaction export validator.
**Architecture:** Existing `INVALID_SOURCE_ROW` path, one numeric predicate strengthened to `Number.isSafeInteger`; no new abstractions.
**Tech Stack:** JS ESM, Node `node:test`, GitHub Actions.
**Spec:** `docs/superpowers/specs/2026-11-15-m02-finance-export-safe-row-provenance.md`

## Constraints

GitHub-only isolated branch and reviewed PR; immutable source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; no migrations, D1 writes, finance posting, auth/RPC changes, source ID rewrites or production deployment. KISS; evidence before claims. Existing parallel M02/M03 owners retain their files. `PARALLEL-MODULE-READY=false`.

### Task 1 — Safe physical Finance row provenance

**Files:** `src/party/finance-export-coverage.js` (one guard), `tests/m02-finance-export-safe-row-provenance.test.mjs` (new), this spec and plan.

1. **RED:** commit tests first for unsafe integer sheet rows, valid upper safe bound, existing invalid row types and duplicate positions, report redaction and source immutability; no source change. Observe failing test in GitHub Foundation.
2. **GREEN:** change `Number.isInteger(value)` to `Number.isSafeInteger(value)` in the `_rowIndex` validation branch only.
3. **Verify:** exact-head Foundation Node/source/frontend checks, M02 real local Workerd/D1, M03/M04 local Workerd/D1, M01 Chromium, M02 staging-local no-cloud and Cloudflare PR-only preview safety.
4. **Review:** four-file patch and mergeability; document RED/GREEN SHA, GitHub run IDs, remaining independent M02-P gates, and no production impact. Keep PR draft until owner reviews.
