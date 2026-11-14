# Staging D1 Isolation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans, superpowers:test-driven-development, and superpowers:verification-before-completion. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Record the owner's staging D1 ID in a separately named Worker configuration, then verify catalog/Party migrations **locally** without remote writes.

**Architecture:** `wrangler.staging.jsonc` uses the separate Worker `shererp-cloud-staging`, a single `DB` binding to `shererp-staging-db`, disabled public routing and original `migrations/`. A strict guard and dedicated no-secrets GitHub CI run tests and Wrangler local migrations. The deployed `shererp-cloud-preview` remains unchanged.

**Tech Stack:** Cloudflare Workers/Wrangler 4.161.0, D1, Node.js 22, GitHub Actions.

## Task 1 — Config and safety tests

**Files:** `wrangler.staging.jsonc`, `scripts/check-staging-d1.mjs`, `tests/staging-config.test.mjs`.
- [x] RED: configuration tests fail when required files and validator are missing.
- [x] GREEN: enforce exact D1 ID, staging name, no public Worker routing, no D1 binding in preview, no extra resources.
- [x] Targeted 4/4 tests passed locally.
- [ ] Verify on GitHub CI.

## Task 2 — Real local Wrangler D1

**Files:** `.github/workflows/staging-d1-local.yml`, `scripts/local-d1-schema-check.mjs`, `tests/local-d1-schema-check.test.mjs`, `tests/staging-workflow-policy.test.mjs`.
- [x] RED: expected CI policy and local-schema proof absent.
- [x] GREEN: create local-only Wrangler migration job and migration evidence checker.
- [x] Eight relevant Node tests passed locally.
- [ ] Confirm real Wrangler local D1 migrations and SQL query in GitHub Actions.
- [ ] Check the Worker dry-run uses staging config only and never deploys.

## Task 3 — Remote staging (separate later operation)

- [ ] Inspect the D1 resource in owner Cloudflare account.
- [ ] Obtain explicit approval for staged remote SQL after backups/rollback review.
- [ ] Implement M03 repository/auth before staging Worker can be exposed.
- [ ] Keep Party ledgers, financial postings, settlement and original Sheets untouched.

**No SQL or data is written to the owner-created remote database by this PR.**
