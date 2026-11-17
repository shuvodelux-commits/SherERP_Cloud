# Gate-0 Run 1 — Source, Authority and Review Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use Superpowers executing-plans or subagent-driven-development. Steps use checkboxes for durable state. This is a **review-only** Run 1: no production code, D1 or cloud deployment changes are authorized.

**Goal:** Establish the proposed M02 49-group source/Party contract, M03/M04 internal integration interface and M11 security PR gate; prepare for owner review before Run 2.

**Architecture:** Reuse existing `scripts/dry-run-source-mapping.mjs` / `scripts/audit-migration-coverage.mjs` as the machine-readable authority. M02 owns source semantics, M04 owns actor authority, M03 alone owns shared migrations/SQL/RPC. This branch changes only new docs.

**Tech Stack:** Original GAS source inventory + ESM Node scripts and tests, GitHub Actions, Cloudflare Workers/Workerd/D1 local-only for later code runs.

**Spec:** `docs/superpowers/specs/2026-11-17-shererp-gate0-integration-design.md` (draft, not yet approved).

## Global constraints

- Source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; baseline GitHub `SherERP_Cloud/main@5290a06abda5a0e42192b8bfbcc2f83e59495647`.
- No edit to `src/db/**`, `migrations/**`, `src/rpc/**`, `src/auth/**`, Worker entry, UI, original source, CI workflows or remote D1.
- All proposed gross Party roles/accounts remain distinct. No source-private data, credentials or identifying exports in GitHub.
- Human review approval, exact-head full CI and issue #594 independent security review required before merge. Keep PR draft while approvals/required checks are incomplete.

## Task 1: ownership and proposed spec

**Files created:** `docs/superpowers/specs/2026-11-17-shererp-gate0-integration-design.md`.

- [x] Enumerate open PRs #603, #604, #606, #607, #608, #609, #610; inspect changed paths and confirm new docs-only scope does not overlap.
- [x] Read `AGENTS.md`, parallel rules, M03 readiness, M04 authority handoff, issues #22/#24/#23/#252/#456/#594.
- [x] Write a proposed private Product master contract, source ID review boundary, SQL current-authority predicate and public-off guarantee.
- [ ] Record independent M02, M03 and M04 reviewer decisions on the spec, with exact PR head.
- [ ] Obtain owner's separate spec approval before Run 2 implementation.

## Task 2: M02 mapping evidence gap matrix

**Files created:** `docs/reviews/2026-11-17-m02-operational-gap-matrix.md`.

- [x] Verify existing source inventory and mapping tooling covers exactly 49 groups and 49 distinct logical proposals.
- [x] Extract a static, human-readable 49-row metadata matrix from the existing source file/schema inventory and audit labels; 19 partial DDL / 30 unmapped / 0 reconciled.
- [x] Preserve original source-text/physical-position obligations; flag all proposed models as NOT operational D1 tables; avoid duplicate parser/test code.
- [ ] Execute `node scripts/audit-migration-coverage.mjs --check`, `node scripts/dry-run-source-mapping.mjs --check`, `node --test tests/m02-source-mapping-import.test.mjs` on the exact PR head or approved independent CI runner; record commands and outputs.
- [ ] M02 source and accounting reviewer signs row/group obligations; M03 integrator reserves next shared-schema scope.

**TDD ruling:** This Run 1 matrix is a documentation-only extract from existing already-tested code, so inventing new failing tests for a second map generator violates KISS. The preexisting read-only mapping test suite is the executable contract. A future behavioral change must use RED→GREEN.

## Task 3: M11 governance enforcement review

**Files created:** `docs/reviews/2026-11-17-gate0-pr-security-enforcement.md`.

- [x] Inspect active ruleset #27454206 (one reviewer, three required checks, no CODEOWNERS enforcement) and issue #594.
- [x] Propose a stable fail-closed aggregate full-CI context, path-aware security review and negative enforcement tests.
- [ ] M11 and security owners review/implement the aggregator on their own branch, RED→GREEN, current head full CI; no cross-workstream shared-workflow edit in this PR.
- [ ] Authorized GitHub admin applies reviewed ruleset update and independently verifies fail-closed test PR scenarios.
- [ ] Close #594 only with verified exact-head QA/reviewer enforcement, not docs alone.

## PR merge and handoff

- [ ] Attach this plan, source pin, full human-readable matrix, ruleset audit and issue links to one **draft, docs-only** GitHub PR against main.
- [ ] Require complete exact-head Actions (including source, Node, local D1, auth, Chromium and preview safety) with no pending/failures; do not treat subset green as complete.
- [ ] Obtain separate Super QA, Super Review and human approval; only then request merge.
- [ ] After approved merge, verify files on latest `main`, update coordination #456 and relevant M02/M03/M04/M11 issues. **Do not automatically start Run 2** until owner approves the spec.

## Review focus

1. A source group that has one D1 table might still have zero historical import/reconciliation: never upgrade it to completed.
2. Positional-only child rows with duplicate parent IDs must remain physically distinguishable.
3. Party role-link identity and separate gross account direction cannot be collapsed into one balance.
4. A current-head CI suite with a failed/missing Workerd or browser check cannot be merged just because protected three checks passed.
5. Source/public runtime boundaries must remain inert; no hidden DB exposure in PR previews.
