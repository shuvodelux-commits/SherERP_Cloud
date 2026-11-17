# M03 sales draft audit private D1 reader — Superpowers implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development. Steps use checkbox for exact evidence.
>
> **Goal:** Return frozen `SALES_DRAFT_AUDIT` M02 history as private original source-shaped rows via awaited D1 without writes or public RPC.
>
> **Architecture:** One fixed-table M03 adapter + strict bounded provenance and TEXT validation. Original M02 archive and importer are unchanged. Node tests and a private isolated Workerd/D1 import-to-read proof exercise the actual archive.
>
> **Tech stack:** Node >=22 ESM, node:test, node:sqlite or synthetic D1 binding, Cloudflare Wrangler 4.161.0 local-only Workerd, GitHub Actions.
>
> **Spec:** `docs/superpowers/specs/2026-11-17-m03-sales-draft-audit-private-read.md`.

## Global constraints and review focus

- Source pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Main at task start `666dd0ca5e0632dbc5bb3fb75c4584e0433d36ec`.
- M03 #22 owns `src/db/**` and shared runtime. M02 existing migration `0008` is a dependency; M06 active draft features and M04 auth are untouched.
- Do not add a source Draft No allocator, source Sheet write, production D1, service binding, or public RPC.
- Review cases: repeated Draft No, `Version='02'`, signed/whitespace note, >1000 rows, malformed SQLite shape, stale cached D1 data.

## Task 1 — RED source fidelity tests

**Files:** `tests/m03-sales-draft-audit-read.test.mjs`.

- [ ] Commit tests using original headers + two event records; verify exact first matching Draft No/Draft ID and normalized archived Version text.
- [ ] Verify unknown sheet/header rejects before SQL; malformed/extra/getter rows, invalid action/version/identity, gaps/overflows reject with no leaks.
- [ ] Push test-only and verify GitHub Foundation job fails for missing `src/db/sales-draft-audit-read.js`. Record commit, run ID and failure text; diagnose any different failure before implementation.

## Task 2 — Minimal GREEN private adapter

**Files:** `src/db/sales-draft-audit-read.js`.

- [ ] Implement strict fixed SQL 1001 sentinel, complete archive check, original data shape, six awaited source helpers, no write methods or cache.
- [ ] Verify Node suite on GitHub current head (full `npm test`) then refactor only if useful.

## Task 3 — Actual local Workerd D1 evidence

**Files:** `tests/integration/m03-sales-draft-audit-read-workerd.spec.mjs`; `.github/workflows/m03-sales-draft-audit-read.yml` (new isolated workflow; M11 review requested).

- [ ] Use existing M02 isolated `wrangler.m02-sales-draft-audit-test.jsonc` and current migration `0008` with synthetic audit events, await M02 importer then M03 reader.
- [ ] Verify original 11 columns, `'02'`, duplicate Draft No history, unchanged D1 rows, SQL UPDATE/DELETE denied, source gap denied, public RPC 501 and fixture Worker 404.
- [ ] Workerd workflow PR-only, no secrets, no remote migrations, pinned `wrangler@4.161.0`; do not weaken shared M03 six-shard coverage or modify it.
- [ ] Verify exact latest head all workflow checks success, no merge conflicts, no overlapping file owner claims; record complete evidence in PR #22 and #456 if appropriate.

## PR handoff

- [ ] Open exactly one PR to main using `.github/pull_request_template.md`, specify issue #22, M03 file owner, M02 0008 dependency, M06 unaffected, base SHA, source pin, read-only scope, affected table, no public RPC, and rollback as feature-branch revert only.
- [ ] Do not merge until owner/file-owner and M11 CI review, full current-head CI and safeguards succeed.
