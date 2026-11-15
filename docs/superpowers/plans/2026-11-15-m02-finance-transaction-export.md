# Superpowers TDD plan — Finance Transaction Original Export Coverage

**Date:** 2026-11-15. **Spec:** `docs/superpowers/specs/2026-11-15-m02-finance-transaction-export-design.md`.
**Frozen source:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2. **GitHub-first, TDD RED→GREEN, KISS; owner merge separate.**

## Task 1 — RED: tests before implementation

Create this plan/spec and `tests/m02-finance-transaction-export.test.mjs` only. Source header fixture comes from checked-in frozen `docs/baseline/schema-inventory.json`, not from an implementation-generated list. Generate synthetic rows with all 20 original columns, including one soft-deleted transaction. Unit cases:
- Exact source headers and count, physical row provenance and source row order invariance; explicit zero-row export succeeds only when count is 0.
- Dropped/reordered/duplicate/extra original Finance header; row missing its original Amount, Person ID, Finance ID, soft-delete audit field; extra row property.
- Truncated export despite otherwise full rows, impossible/missing declared source count.
- Duplicate original Finance ID including deleted row; unique IDs across separate rows; blank ID; numeric original Finance ID and numeric Person ID, leading-zero string retention; malformed or repeated physical rows.
- Active transaction Amount missing, zero, negative, over-precision and unsafe amount vs exact valid two-decimal and soft-deleted zero; bad nested/nonfinite cell values.
- No input mutation, fixed-code redaction, unknown shape failures; source FinanceModule remains pinned.
Commit RED and **observe GitHub Foundation failure on missing module** before producing source code.

## Task 2 — GREEN: minimal pure module

Add **only** `src/party/finance-export-coverage.js` implementing exact frozen 20-column comparison, required source count, row-level own-field checks and fixed-code counts. Do not modify any existing module, import finance preflight, or D1. Small readable implementation, no new framework or dependencies. Avoid source identifier values in errors/reports. Commit GREEN.

## Task 3 — GitHub verification and PR

Verify actual Foundation full Node test suite/84 frozen GAS files/36 original UI includes and M02 Party local Workerd D1, M02 synthetic and staging, M03 real local D1, M04 auth, M01 Chromium, Cloudflare PR safety on **exact HEAD**. Document RED/GREEN hashes and real run outcomes, impacted four-new-file inventory, source SHA and safe rollback. Check no overlap with open PR #178 (D1 readback plan validation) and that production Party/account data is untouched. Leave PR draft and unmerged.

**Rollback:** revert new-only PR. No D1 migration or data effects. `PARALLEL-MODULE-READY=false`.
