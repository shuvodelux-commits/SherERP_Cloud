# M01 real-browser smoke QA implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reproducible real Chromium browser/print smoke gate to SherERP Cloud's preserved UI, without enabling the ERP backend.

**Architecture:** Build the frozen original HTML in a temporary directory and serve it via a loopback HTTP fixture that always denies RPC. Exercise browser behaviors with Playwright, run from a separate PR-only GitHub Action, and save only synthetic evidence.

**Tech Stack:** Node.js >=22 ESM, Playwright 1.65.1 Chromium, existing frontend builder and RPC patcher.

**Spec:** `docs/superpowers/specs/2026-11-15-m01-browser-smoke-design.md`

## Global constraints
- Do not modify `legacy/source`, `src/db`, `src/rpc`, migrations or Cloudflare deployment.
- Fail closed for every backend RPC; no real data, credentials, D1 bindings or fake login success.
- Independent M01 browser lane; do not alter pending PR #26.
- Distinguish synthetic A4 styling test from actual invoice pagination.

## Task 1 — Minimal runtime browser harness
- [x] Add Playwright as a pinned dev dependency with lockfile.
- [x] Write initial browser test that loads a compiled shell, waits for login, checks protected app hidden and runtime JS errors.
- [x] Run test against stub `serveCompiledUi`; observe expected missing-server failure.
- [x] Implement minimal loopback fixture that builds and patches original HTML, denies all RPC (501), cleans up.
- [x] Re-run initial browser check in installed Chromium and see it pass.

## Task 2 — Touch and print regression checks
- [x] Add 375px touch login bounding box, unauthenticated rejected login, and real Chromium print-media/PDF tests.
- [x] Run tests while artifact helpers are missing; observe two expected missing-helper failures.
- [x] Add screenshot/PDF capture to ignored `test-results/m01-browser/`.
- [x] Run all four Chromium tests locally; zero failures.
- [x] Add `npm run test:m01:browser`, first verifying a missing-script failure then green run.

## Task 3 — PR-only automation and release verification
- [x] Add `.github/workflows/m01-browser-qa.yml` (no secrets/deploys, evidence upload).
- [x] `npm ci` from lockfile and `npm test`.
- [x] `npm run verify:source`, `npm run build:frontend`, explicit real Chromium smoke suite.
- [x] `node --check`, `git diff --check`, inspect only intended changed files.
- [ ] Create PR on independent branch, inspect CI (including browser) and remaining M01/M03/M04 gates; no auto-merge.

## Interfaces and impact
- New test-only `serveCompiledUi(): Promise<{url: string,close: ()=>Promise<void>}>`.
- New script `npm run test:m01:browser`; default `npm test` remains browser-independent.
- No user data, SQL tables, RPC contracts, financial transactions, UI source or deployed Worker changes.