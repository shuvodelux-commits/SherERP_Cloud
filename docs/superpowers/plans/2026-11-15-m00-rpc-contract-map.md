# M00 Frozen RPC Contract Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enumerate all literal legacy browser RPCs and dynamic callsites against pinned GAS function declarations.

**Architecture:** Independent, source-only Node ESM scanner with deterministic JSON baseline and strict `--check`. No production runtime modifications.

**Tech Stack:** Node.js >=22 built-ins; node:test; frozen GAS sources.

**Spec:** `docs/superpowers/specs/2026-11-15-m00-rpc-contract-map-design.md`

## Task 1 — TDD tests
- [x] Create `tests/m00-rpc-contract-map.test.mjs` with synthetic HTML and GAS source.
- [x] Confirm literal/multiline calls, fake calls in comments/strings skipped, dynamic expressions separately reported, backend owner resolved, missing definitions flagged.
- [x] Confirm duplicate backend declarations fail closed, deterministic ordering, stale snapshot rejected, and CLI check succeeds only for committed inventory.
- [x] Run RED against stub scanner.

## Task 2 — Scanner and checked-in inventory
- [x] Implement pure `auditM00RpcContracts({sources,sourceCommit})` in `scripts/audit-m00-rpc.mjs`.
- [x] Implement `--write` / `--check` CLI using local source-manifest.json and root-level frozen files only.
- [x] Generate `docs/baseline/m00-rpc-contract-inventory.json`; test GREEN.

## Task 3 — Verify and PR
- [x] Run full `npm test`, `npm run verify:source`, `npm run build:frontend`, scanner `--check`, syntax/diff validation.
- [ ] Rebase/fast-forward fresh `origin/main`; retest and publish narrow PR.
- [ ] Check GitHub CI and explicitly report absent security/financial gates.

## File ownership / compatibility
- Create one standalone scanner, its tests, JSON audit and these Superpowers docs only.
- Do not edit `scripts/audit-source.mjs` or pending M04 files.
- Zero changes to GAS UI, RPC registry, Worker endpoints, SQL, D1, Party, auth, stock, finance or production deployment.