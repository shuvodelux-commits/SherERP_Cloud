# M02-P Finance Sparse Header Evidence — Superpowers TDD Plan

> **Agent execution:** Follow Superpowers executing-plans + test-driven-development: commit failing tests before production change, observe RED in GitHub Actions, implement minimal GREEN, verify exact head.

**Goal:** Offline Finance transaction export completeness cannot pass when any captured original header position is a sparse-array hole.
**Architecture:** Verify captured `sourceHeaders[i]` by iterating the existing fixed and dense 20-column `columns` manifest, rather than iterating the possibly sparse header evidence.
**Tech:** Node.js ESM `node:test`, pinned schema inventory, GitHub Actions.
**Spec:** `docs/superpowers/specs/2026-11-15-m02-finance-sparse-header-coverage-design.md`.

### Preconditions / safety

`AGENTS.md`, frozen original SHA `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, ADR-007; all changes GitHub-based and no Remote Desktop Commander unless needed for PC. No customer data, D1 remote import/schema, public Worker endpoints, finance/stock/cash/ledger posting, cross-role netting or existing UI changes. Workstream M02-P is still gated, not production-ready.

### Task 1 — Test-first dense header comparison

**Files:** `src/party/finance-export-coverage.js`; new `tests/m02-finance-export-sparse-headers.test.mjs`; this spec and plan.

1. **RED:** write test for holes at first/middle/last original Finance headers using `delete array[index]`, assert source count/row fields remain complete but header mismatch blocks offline clearance; assert redacted report and input immutability. Add dense manifest, explicit undefined, swapped and extra header controls. Commit tests without production change.
2. **Observe RED:** create draft PR; obtain actual GitHub Foundation red test results for new cases, distinguish unrelated failures.
3. **GREEN:** one expression change: replace `sourceHeaders.some((field,i)=>field!==columns[i])` with `columns.some((field,i)=>sourceHeaders[i]!==field)`. Keep original `length` guard.
4. **Verify:** full exact-head GitHub Foundation Node tests, original source 84-file audit, preserved UI 36 includes, Party local Workerd/D1 and synthetic importer, M03 local Workerd/D1, M04 auth D1, M01 Chromium, Cloudflare PR safety. Review exact four-file diff.
5. **Review:** document red/green SHAs, run IDs, CI successes or pending statuses, rollback and boundaries; leave PR draft until owner review and merge approval.
