# M04 authentication real-Workerd CI gate

**Date:** 2026-11-15
**Workstream:** M04 authentication; test infrastructure only. **Source:** pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Applicable instructions:** `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/M04_AUTH_SOURCE_CONTRACT.md`, `docs/WORKSTREAMS.md`.

## Problem

PRs #55, #60, #70 and #73 introduced real local Workerd/D1 authentication tests (modern password/session, authority-version revocation, native RPC response contract and legacy first-login PBKDF2 upgrade). The existing PR workflows verify source/preview safety and M03's D1 suite, but they do **not** execute M04's separate local Workerd tests automatically. Thus existing green checks did not demonstrate M04 integration correctness on GitHub CI.

## Decision and acceptance

Add one PR-only workflow at `.github/workflows/m04-auth-workerd.yml`, matching the existing M03 Workerd pattern and the pinned `wrangler@4.161.0` installed in a disposable GitHub runner. Invoke all four existing M04 integration suites together with Node 22 `node --test`, without secrets or cloud credentials.

Acceptance: on this PR, the new `Verify legacy and modern login against isolated local D1` check is registered and green; it reports Workerd/D1 tests, not mocks. The original source manifest, Node tests, build, static assets and existing PR checks remain unaffected. If failures reveal new incompatibility, fix a narrowly scoped test/fixture with RED/GREEN evidence rather than weakening the tests or skipping them.

## Contract / impact inventory

- **Added:** `.github/workflows/m04-auth-workerd.yml` — CI safety gate, pull_request only, `permissions: contents: read`. No push/deploy/manual dispatch trigger.
- **Added:** this plan.
- **Unchanged:** all 84 pinned source files, `src/**`, `migrations/**`, test source, `src/rpc/registry.js`, frontend, Wrangler deployment configs, real D1 bindings and tenant data.
- **Tests invoked:** `m04-auth-workerd.spec.mjs`, `m04-auth-authority-version-workerd.spec.mjs`, `m04-legacy-rpc-workerd.spec.mjs`, `m04-legacy-upgrade-workerd.spec.mjs` via isolated Wrangler emulator and local D1 only.
- **Real D1 import/production impact:** none.

## Safety and next work

This workflow is **not** permission to activate login. Public PR Preview and main Worker remain D1-free, so login stays HTTP 503. Staging requires M03-exclusive auth SQL promotion, owner-reviewed legacy staff import/phone collision preflight (open #39/#42), first Administrator provisioning, protected D1 staging rollout, complete server authorization and genuine UI login verification. Do not copy secrets, migrate data, or alter the Cloudflare Workers Builds deployment owner.

## Evidence

- Before this branch, there was no GitHub PR job explicitly executing the four M04 Workerd integration suites; original PR #73 relied on locally recorded Workerd results.
- On this branch, GitHub Actions must show the new M04 check passing, alongside the existing source/preview CI gates. No artificial RED test is appropriate for a CI-only addition; the acceptance proof is an actually executed GitHub workflow.
