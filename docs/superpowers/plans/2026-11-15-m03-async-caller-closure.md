# M03 Async Caller Closure Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin a conservative, transitive named-function caller inventory to the original GAS source so M03 async conversion can be reviewed without code changes.

**Architecture:** New isolated Node ESM tool parses real GAS syntax trees using pinned Acorn 8.19.0, builds a reverse dependency graph to legacy DB helper seed calls, records shortest transitive paths, writes a locked JSON snapshot, and unit-tests every failure gate.

**Tech Stack:** Node.js >=22, Acorn 8.19.0 (dev-only syntax parser), node:test, frozen `.gs` source files.

**Spec:** `docs/superpowers/specs/2026-11-15-m03-async-caller-closure-design.md`

## Task 1 — Source-grounded behavior tests
- [x] Add `tests/m03-async-closure.test.mjs` covering direct reads, transitive callers, shortest named call path, write propagation and recursive cycles.
- [x] Assert comments/strings are ignored, duplicate declarations fail, deterministic source snapshot matches, stale snapshots fail.
- [x] Run RED against a stub to prove these tests fail as intended.

## Task 2 — Analyzer
- [x] Add `scripts/audit-m03-async-closure.mjs` with pure `buildM03AsyncClosure({sources,sourceCommit})` and snapshot verifier.
- [x] Parse root-level FunctionDeclaration and CallExpression syntax nodes; build sorted caller edges and shortest paths to read/write seeds. Represent known limitations explicitly.
- [x] Add `--write` and `--check` CLI without reading or writing live D1.
- [x] Generate `docs/baseline/m03-async-caller-closure.json`; verify GREEN tests.

## Task 3 — Release verification
- [x] Run `npm test`, `npm run verify:source`, `npm run build:frontend`, `node scripts/audit-m03-async-closure.mjs --check`, two `node --check` and `git diff --check`.
- [x] Fast-forward to latest main and repeat validation if main changes.
- [ ] Publish narrow M03 source-audit-only PR, verify CI, leave unmerged for owner review.

## Ownership / impact
- Only new `scripts/audit-m03-async-closure.mjs`, `tests/m03-async-closure.test.mjs`, JSON baseline and these design/plan docs.
- `src/db` stays exclusively with M03 kernel owner; M04 authentication and all D1/SQL/financial writes untouched.

Parser is a pinned development-only dependency (`package.json` and `package-lock.json` modified for CI `npm ci`); no production runtime dependency.

## CI regression correction
- [x] Diagnose GitHub failures: the fresh runner lacked Acorn because workflows ran `npm test` without `npm ci`.
- [x] Add `npm ci` before tests in five existing validation workflows, preserving triggers and deployment gates.
- [ ] Verify all GitHub PR workflows pass from a fresh checkout.