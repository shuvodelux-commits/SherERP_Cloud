# M01 Compiled UI Contract QA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fail CI if critical generated UI/print/mobile contracts drift while preserving the original source and Worker shell.

**Architecture:** A pure, read-only HTML contract inspector plus targeted mutation tests. It consumes the existing M01 build output and does not add runtime dependencies.

**Tech Stack:** Node.js >=22, node:test, existing frontend include builder/RPC patcher.

**Spec:** `docs/superpowers/specs/2026-11-15-m01-ui-contract-qa-design.md`

## Global Constraints
- No changes to `legacy/source`, `src/db`, migrations, `src/rpc`, Worker deployment or accounting behavior.
- CI tests must use generated/ephemeral HTML, never staging D1 or business data.
- Do not describe static checks as Playwright/browser QA.

## Task 1 — Contract detection (RED → GREEN)
- [x] Create `tests/m01-ui-contract.test.mjs` building from the pinned original source to temporary HTML, then applying the existing RPC patch.
- [x] Assert protected DOM IDs are unique and missing/duplicate IDs are reported, while fake IDs inside scripts are ignored.
- [x] Assert mutated 860px breakpoint and repeating invoice table header cause failures.
- [x] Assert broken scrollbar JavaScript references and missing RPC fetch cause failures.
- [x] Run tests against an unimplemented inspector stub; three mutation tests fail for the intended unmet assertions.
- [x] Implement `inspectUiContracts(html)` in `scripts/check-m01-ui.mjs` with read-only checks.
- [x] Run `node --test tests/m01-ui-contract.test.mjs`; four pass.

## Task 2 — CLI / review gates
- [x] Provide CLI usage: `node scripts/check-m01-ui.mjs dist/index.html`; nonzero exit for errors.
- [x] Run `npm test` including existing suite and the new tests.
- [x] Run `npm run verify:source` and `npm run build:frontend`.
- [x] Run compiled CLI check and negative fixture check.
- [x] Review `git diff --check` and changed-file scope.
- [ ] Create isolated M01 PR (no merge), documenting source SHA, affected files, tests and remaining Playwright/print gates.

## Interfaces
- `inspectUiContracts(html: string): string[]` (empty array = no static contract violation).
- CLI reads `dist/index.html` by default and writes diagnostics only to stdout/stderr.
- No SQL tables, RPC signatures, public endpoints, browser markup, business logic or user data changed.