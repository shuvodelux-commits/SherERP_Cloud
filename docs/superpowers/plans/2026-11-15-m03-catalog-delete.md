# M03 catalog guarded delete — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans and test-driven-development, using fresh verification before PR merge.

**Goal:** Port permanent catalog row deletion with physical source index compaction, atomically and with stale identity preconditions.

**Architecture:** One fixed 3-statement SQLite transaction via Cloudflare D1 `DB.batch`; a separate test-only fixed route; no production mutation exposure.

**Tech Stack:** JS ESM, Node `node:test`/`node:sqlite`, real Wrangler workerd+D1.

**Spec:** `docs/superpowers/specs/2026-11-15-m03-catalog-delete-design.md`.

## Global constraints
- Only Product Categories / Units; no general Sheet writer.
- Return void, preserve remaining legacy physical rows with +header offset.
- Fixed prepared statements, no untrusted SQL identifiers, no public routes, no cloud D1 writes.
- Fail closed on missing actor/role integration; this internal module is not callable via production API.
- Keep original GAS/source byte-for-byte and existing M03 concurrency tests green.

## Task 1 — TDD
- [x] Wrote 8 Node/SQLite tests: category/unit first/middle/last, stale preimages, missing D1 batch, unsupported sheet/inputs, corrupt provenance and trigger-injected rollback.
- [x] Observed RED: module missing, then fixture mismatch corrected to mimic native D1 statement-without-bind behavior.
- [x] Implemented fixed-allowlist three-statement D1.batch delete+compaction; targeted GREEN 8/8.
- [x] No partial writes on conflict/rollback and no silent successful no-op.

## Task 2 — Real Worker/D1
- [x] Added fixed synthetic-only catalog delete paths to the existing local-only write fixture; no caller-provided data.
- [x] Observed real Workerd RED 405, then GREEN including trigger-injected failure rollback and row-index compaction.
- [x] Combined real Worker/D1 integration suite 20/20 passing.

## Task 3 — review, verify, PR
- [x] Documented scope and restricted activation integration in `docs/M03_CATALOG_DELETE.md`.
- [x] Full `npm test` 180/180, actual Workerd/D1 20/20, verify:source 84 files, frontend build, frozen 47-source M03 inventory, syntax and diff check — all passed.
- [ ] Push focused branch, open PR to main, require all four GitHub Actions and Cloudflare Preview on exact head SHA to merge.
