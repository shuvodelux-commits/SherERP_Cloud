# M03 — Opening Balance Edit Archive Private Reader: RED → GREEN Plan

> Required skills: superpowers:executing-plans, superpowers:test-driven-development and superpowers:verification-before-completion. GitHub-first branches/commits/PR/CI; no local PC required.

**Goal:** Read existing M02 immutable `OPENING_BALANCE_EDIT_LOG` history in original frozen 12-column shape without turning historical edits into financial postings.

**Architecture:** A single private `src/db/opening-balance-edit-audit-read.js` using strict fixed-column, 1000-row bounded D1 reads; independent Node unit tests and isolated Workerd real-D1 importer/readback; narrow PR-only CI. Avoid touching shared workstream files or public RPC.

**Spec:** `docs/superpowers/specs/2026-11-16-m03-opening-balance-edit-audit-read-design.md`.

## 14-sentence overview

1. The original ERP records opening-balance changes in a dedicated audit Sheet.
2. Its source contract has 12 columns and one physical row index.
3. Historical edits may repeat the same Customer or Supplier source ID.
4. Each original Audit ID remains the unique record identity.
5. Signed totals, negative values and `-0.00` must not be recalculated.
6. M02 already has an immutable D1 history table and a whole-snapshot importer.
7. These D1 amounts are preserved as descriptive text.
8. M03 lacks a restricted async source-shaped reader for those records.
9. The proposed reader will use one fixed parameterized SELECT with a 1001 cap.
10. It will preserve all original fields and contiguous physical Sheet row indexes.
11. It will refuse malformed, duplicate-ID or incomplete D1 results.
12. Original source lookups will compare exact string values and retain duplicate entity edit rows.
13. A test-first Node suite and actual isolated Workerd/D1 integration will prove these properties and no public exposure.
14. No live balances, Cash, Party, stock, production D1, browser UI or public RPC are affected.

## RED task — files and tests

- Create `tests/m03-opening-balance-edit-audit-read.test.mjs`: confirm original header inventory; full source shape including duplicate Entity ID, signed negative/zero strings, UTF-8 reason, blank amounts; exact String find methods; expected []/null/-1; unknown sheet/header before SQL; no writer methods; invalid row shape, duplicate Audit ID, missing Entity ID/Type, 1001 cap, D1 errors redacted. Import target module before it exists.
- Create `tests/integration/m03-opening-balance-edit-audit-read-workerd.spec.mjs`: import synthetic original source through M02 `importSourceOpeningBalanceEditAuditWithD1`, read entire actual Workerd/D1 archive, compare M02 textual normalization and physical identity, prove no writes/immutable triggers, deny public route.
- Commit tests only and open draft PR. Observe GitHub Actions Foundation RED `ERR_MODULE_NOT_FOUND` with test pass/fail count. If failure is different, diagnose/fix test-only commit before implementation.

## GREEN task

- Create `src/db/opening-balance-edit-audit-read.js` with `createOpeningBalanceEditAuditReadAdapter(env)`.
- Use `requireD1Binding`, fixed SQL `SELECT legacy_sheet_row,audit_id,changed_at_text,entity_type,entity_id,entity_name,old_opening_balance_text,new_opening_balance_text,delta_text,current_due_before_text,current_due_after_text,reason,changed_by FROM legacy_opening_balance_edit_audit ORDER BY legacy_sheet_row ASC LIMIT ?` and bind `1001`.
- Validate exact 13 own enumerable data fields and text values, unique nonblank Audit ID, nonblank Entity Type/ID, safe contiguous source indexes and no overflow. No SQL errors or sensitive historical details escape.
- Implement six async source helpers, only exact sheet/header names, no general SQL adapter, caching, mutations or HTTP.
- Verify GitHub Foundation exact-head GREEN and tests before claiming any success.

## Isolated real D1/merge gate

- Create `.github/workflows/m03-opening-balance-edit-audit-read.yml`: `pull_request` only, `contents:read`, `npm ci`, pinned `wrangler@4.161.0`, local `node --test tests/integration/m03-opening-balance-edit-audit-read-workerd.spec.mjs`; no secrets, no deploy or remote D1.
- Verify local Workerd/D1 synthetic import/readback, source header fidelity, immutability, no HTTP disclosure, and zero original UI/GAS changes.
- Recheck exact-head all checks, latest main conflict-free, PR file scope. Owner merges after green only; M03/PARALLEL-MODULE-READY remains incomplete.
