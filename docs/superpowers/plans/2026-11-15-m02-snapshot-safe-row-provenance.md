# M02-P: Exact Source Row Provenance in Snapshot Drift Guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, with GitHub RED evidence before source edits.

**Goal:** Reject unsafe original Sheet row positions in the standalone offline Party snapshot-drift guard before identity planning and human-review replay.

**Architecture:** `src/party/import-snapshot-guard.js::inspect()` currently uses `Number.isInteger(row._rowIndex)`; values like `2 ** 53` or `Number.MAX_VALUE` pass this early provenance check, then the separately invoked `planPartyImport()` rejects them with a later generic review-evidence error. Align this source-drift guard with merged `#197` export coverage and `party-import-plan.js` using `Number.isSafeInteger`. Preserve raw original IDs, row locators, review claims and report shapes; no new API or SQL.

**Tech Stack:** JavaScript ESM, Node 22 native `node:test`, GitHub Actions, frozen GAS Party master source.

**Spec:** `AGENTS.md`, `docs/WORKSTREAMS.md` M02-P, `docs/architecture/ADR-007-unified-party-relationships.md`, `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, and existing merged `tests/m02-party-export-rowindex-safe-integer.test.mjs`.

## Global Constraints

- GitHub-only isolated branch/PR and exact-head CI. RED → GREEN verified against actual GitHub Actions before claiming success. KISS.
- `_rowIndex` is optional export provenance; when present must be a **safe JavaScript integer >= 2**, with original ID text preserved byte-for-byte.
- Direct `validatePartyImportSnapshot()` must raise generic, redacted `Invalid Party source row provenance` for unsafe physical positions **before** attempting owner-reviewed identity mapping.
- Valid `2`, `Number.MAX_SAFE_INTEGER`, omitted `_rowIndex`, distinct original IDs including whitespace, and all existing drift counts remain unchanged.
- No data/approval/Party merge, finance cash/bank/ledger posting, remote D1, schema, source GAS, Worker RPC or frontend modification.

## Review Focus

- Both original and candidate source snapshots reject row numbers beyond safe integer range.
- Rows with large **safe** provenance stay eligible for offline comparison without numeric aliasing.
- Existing duplicate physical positions and blank identity behavior remain fail-closed.
- Error diagnostics never contain source identities, phone, cash figures or reviewer references.
- No authorization to import or automatically merge Parties is introduced.

### Task 1 — Test-first row provenance contract

**Files:** `tests/m02-party-snapshot-safe-row-provenance.test.mjs` (new), `src/party/import-snapshot-guard.js` (one predicate after RED), this plan (new).

- [ ] Commit plan to GitHub dedicated M02 branch.
- [ ] Commit synthetic tests first: unsafe reviewed and candidate `2**53` and enormous finite integers must fail as source provenance; valid `2`, `Number.MAX_SAFE_INTEGER`, omitted provenance and original ID behavior must remain; check immutable inputs and redacted error.
- [ ] Confirm **RED** in actual Foundation GitHub job for specific early-provenance assertions, not missing imports or unrelated failures.
- [ ] Replace only `Number.isInteger(row._rowIndex)` with `Number.isSafeInteger(row._rowIndex)` in the standalone snapshot guard.
- [ ] Confirm **GREEN** full Node suite, original-source checks, M02 real Workerd/D1 identity and synthetic import, M03 D1 integration, M04 auth, M01 Chromium, Cloudflare preview safety.
- [ ] Review diff exactly three files; PR with actual RED/GREEN commit hashes, CI links, risks and release gates. No production schema, D1 or financial writes.

**Rollback:** revert PR; no database rollback or live data touched. `PARALLEL-MODULE-READY=false`.
