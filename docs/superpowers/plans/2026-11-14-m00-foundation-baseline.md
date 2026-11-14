# M00 Source Baseline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a frozen, inspectable, safe Mohim_ERP source baseline in SherERP_Cloud, including full original app HTML/GS inputs, manifest, and reproducible source-audit tooling.

**Architecture:** Use an immutable Git commit pin and copied raw source under `legacy/source/`. Do not execute GAS code or transform it during M00. Analyze it locally with a dependency-free Node script, with deterministic JSON output and observable CI assertions. Later M01 consumes raw HTML; M02 consumes the pinned schema in Config.gs.

**Tech Stack:** Node.js 22+ test runner, JavaScript ES modules, GitHub Actions and GitHub API for source import. **Spec:** `docs/MIGRATION_PLAN.md` and `docs/WORKSTREAMS.md` M00 sections.

## Global Constraints

- Source full commit SHA: `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
- Original source and live GAS + Google Sheets are never mutated.
- Destination `SherERP_Cloud` is a different repo; import only source app code (.gs/.html), excluding .clasp.json, credentials, live data and exports.
- Import raw files byte-for-byte under `legacy/source/`; no rename to .js yet, no redesign, no accidental deployment.
- No production Cloudflare credentials or D1 resource creation in M00.
- Use targeted tests for the source-audit parser; source inventory must come from pinned code, not hand-retyped assumptions.

## Review Focus

- A filename containing a space or Unicode should be preserved exactly.
- A .gs file that mentions a Google service only in comments must not be overstated as an actual call without qualification.
- Test files with `.test.js` must not be counted as backend .gs; ensure CLI scopes are explicit.
- An unexpected source commit or missing file must be detected before declaring the copied baseline complete.
- Import must not silently include sensitive source files outside the approved .gs/.html allowlist.

---

### Task 1: Pin source, import a read-only raw snapshot

**Files:**
- Create `legacy/source/*.gs`, `legacy/source/*.html`
- Create `docs/baseline/SOURCE_PIN.md`
- Create `docs/baseline/source-manifest.json`

**Interfaces:** Source tree Git objects at pinned SHA; manifest contains `source.repository`, `source.commit`, `source.tree`, `files[]` with path, blobSha and byteSize; a total count.

- [ ] Step 1: Read pinned tree; enumerate all root-level .gs/.html files and their Git SHA and size.
- [ ] Step 2: Copy file contents to legacy/source, retaining raw filenames; do not include .clasp.json or user data.
- [ ] Step 3: Compare imported path list and SHA metadata to pinned source inventory; fail closed if mismatched.
- [ ] Step 4: Commit in destination foundation feature branch only; do not touch main or original repo.

### Task 2: Build a deterministic audit CLI

**Files:**
- Create `scripts/audit-source.mjs`
- Create `tests/audit-source.test.mjs`
- Create `package.json`

**Interfaces:** `node scripts/audit-source.mjs [source-dir]` prints machine-readable JSON on stdout, scans root-level *.gs/*.html, counts backend/frontend files, identifies HTML include references, RPC call names, Google service identifiers, and direct getSheet_/getRange usage. Prints no file contents or secrets.

- [ ] Step 1: Add Node test fixture with 2 .gs and 2 .html files; invoke CLI and expect exact file counts, call sites, includes, and stable sorted output. Also expect error for missing directory.
- [ ] Step 2: Run `node --test tests/audit-source.test.mjs` and confirm RED (missing CLI).
- [ ] Step 3: Implement using fs/promises and regular expression heuristics explicitly labeled static scan (not full parser). Capture lines for review; no false assertion of runtime verification.
- [ ] Step 4: Run focused test and full `node --test`; confirm GREEN. Audit pinned snapshot and save `docs/baseline/static-audit.json`.
- [ ] Step 5: Commit tests, CLI and reports on the foundation branch only.

### Task 3: Foundation verification gate

**Files:**
- Create `.github/workflows/foundation-checks.yml`
- Update `README.md` with baseline state and local commands

**Interfaces:** `npm test`, `npm run audit`; no external secrets required.

- [ ] Step 1: Verify source snapshot matches manifest file paths and byte sizes and audit has expected scope.
- [ ] Step 2: Run tests in clean isolated checkout and capture results in PR body.
- [ ] Step 3: Add CI workflow (build-free in M00) that runs tests and audit.
- [ ] Step 4: Open **draft** M00 PR targeting docs/cloudflare-d1-migration-plan while PR #1 is open. Rebase onto main only after PR #1 is merged; do not merge automatically.

## Definition of DONE for M00

- Full, pinned raw frontend/backend app snapshot copied; source SHA and manifest explicit.
- Reproducible audit script and passing tests; exact baseline inventory and proof in a reviewable PR.
- No Cloudflare production resources, no D1 schema, and no converted business logic claimed as finished.

## M01 and M02 handoff (not part of this PR)

M01 reads `legacy/source/index.html` and safely assembles it with included HTML/CSS/JS without changing DOM; TDD for include replacement, cycles/missing files, booting with stub RPC, and browser screenshots.

M02 reads `legacy/source/Config.gs` and generates a reviewed schema mapping for 49 groups, with tests for column quoting/typing and deterministic imports. No blind CREATE TABLE of all TEXT columns.

## Rulings

- PR #1 remains open: M00 branches from PR #1's documentation branch to preserve parent guidance and avoid bypassing review.
- No source test suite is executed *within* M00 until dependencies and a runtime harness are selected; the existing GAS test suite is inventoried, not falsely reported as passing.
