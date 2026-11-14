# M02 Config.gs Schema Inventory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans, TDD (RED→GREEN), and verification-before-completion.

**Goal:** Produce a deterministic, reviewable inventory of all sheet names and header columns declared by the frozen `Config.gs`, without changing data types, inventing constraints, executing GAS code or creating a production D1 database.

**Architecture:** A dependency-free Node script statically parses only the known literal `SHEETS` and `HEADERS` configuration blocks. It strips JavaScript comments while preserving string values, checks one-to-one keys and duplicates, and outputs JSON. This is preparatory input for a separately reviewed typed D1 schema design.

**Tech Stack:** Node.js 22, ESM, `node --test`.

**Spec:** `docs/MIGRATION_PLAN.md` P2, `docs/WORKSTREAMS.md` M02.

## Constraints and review focus

- Source: `legacy/source/Config.gs` at SHA `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; it is never modified.
- No `eval`, `vm` execution, generated SQLite schema, SQL writes or deployed Cloudflare resources in this slice.
- Match original column order, spacing, Unicode and case exactly; prohibit fabricated columns.
- Test comments that contain decoy keys, mismatched SHEETS/HEADERS keys, malformed arrays, duplicate sheet keys and missing source file.
- Every table must later have human-reviewed data type, amount precision, indexes, IDs, foreign keys, deleted-state and migration strategy. `TEXT`-for-everything is unacceptable.

### Task 1: Static schema map generator

**Create:** `scripts/inventory-schema.mjs` and `tests/inventory-schema.test.mjs`.  
**Modify:** `package.json` (add `inventory:schema`) and CI command.

**Interface:** `inventorySchema(sourceText): {formatVersion:1,tables:[{sheetKey,sheetName,columns:string[]}]}`. CLI `node scripts/inventory-schema.mjs legacy/source/Config.gs` prints JSON and exits nonzero on invalid key matching, duplicate columns or malformed literal headers.

- [ ] Write failing test with two sheet groups, comments containing decoy keys, Unicode/space in header and source order expectation.
- [ ] Verify RED on nonfunctional stub.
- [ ] Implement comment stripping and strict parsing of the two known literal blocks.
- [ ] Verify GREEN; additional tests catch missing keys, duplicates, malformed arrays, and no source file.
- [ ] Run full `npm test`; confirm results.
- [ ] Verify on pinned original Config.gs in CI and assert **49** configured groups.
- [ ] Save generated machine-readable schema inventory as CI artifact or `docs/baseline/schema-inventory.json`; exact source comparison required.
- [ ] Commit, open draft stacked PR against M00, no production D1 activity.

### Task 2: Typed D1 SQL proposal (later separate PR)

- [ ] Classify and review all 49 groups by domain and column type (money, quantities, IDs, timestamps, soft deletion).
- [ ] Propose an explicit SQLite schema with constraints/indexes, stable row identity, and migration order.
- [ ] Define source-to-target mapping for history, audit, ID counters and opening balances.
- [ ] Test deterministic dry-run importer with sanitized fake data, missing/duplicate/foreign-key mismatch handling and reconciliation before deploying any DB.

## Definition of done for this initial slice

Schema group/header inventory reproducible from the exact frozen `Config.gs`, tests pass and output matches source mapping. The D1 schema/importer and runtime migration remain outstanding; no claim of full M02 completion.
