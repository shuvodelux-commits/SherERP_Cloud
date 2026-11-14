# M01 Static Frontend Assembly — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task by task. Steps use checkboxes and RED→GREEN test evidence.

**Goal:** Serve the original SherERP frontend as assembled static HTML on Workers, preserving the original DOM, CSS, JavaScript and print layout without running GAS HtmlService at request time.

**Architecture:** Keep the pinned `legacy/source/*.html` untouched. An offline Node build recursively expands `<?!= include('name'); ?>` references in the original index.html, verifies all included paths are local `.html` source files, detects cycles, then writes `dist/index.html`. A later task adds the Worker API bridge and actual browser E2E; this first slice is deliberately build-only.

**Tech Stack:** Node.js 22+, pure ESM, Node test runner; no frontend framework conversion.

**Spec:** `docs/MIGRATION_PLAN.md` P1 and `docs/WORKSTREAMS.md` M01.

## Global constraints

- Source snapshot is pinned to Mohim_ERP SHA `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; never alter files in `legacy/source/`.
- Every assembled fragment must preserve its original content and order, with only GAS include instructions replaced.
- Do not silently evaluate arbitrary template expressions, or treat unknown GAS template expressions as plain HTML.
- Build output is not a functioning ERP until RPC transport, auth, Worker routing and D1 endpoints are integrated separately.
- No deployment or Cloudflare production-resource creation.

## Review Focus

- Nested include cycles should error with a useful chain, not hang.
- Missing include should fail closed, not leave a blank element.
- Traversal strings should be rejected before touching the file system.
- Inline CSS and script ordering must remain as original.
- Nested includes with an unexpected GAS scriptlet remaining should cause failure.

### Task 1: Offline include expander

**Create:** `scripts/build-frontend.mjs`  
**Test:** `tests/build-frontend.test.mjs`  
**Modify:** `package.json` (new `build:frontend` command)

**Interface:** `buildFrontend({sourceDir, outputDir}): Promise<{outputPath, includeCount}>`. Reads `index.html` from `sourceDir`, writes `index.html` under `outputDir`; error on invalid include, missing source, cyclic include, unknown `<? ... ?>` scriptlet.

- [ ] Step 1 RED test: fixture with nested `include('style')`, `include('javascript')`; assert resulting HTML is in expected order and contains no GAS scriptlet.
- [ ] Step 2: Run `node --test tests/build-frontend.test.mjs`; confirm failure because implementation is absent.
- [ ] Step 3: Implement minimal offline include expansion with strict filename validation and cycle detection.
- [ ] Step 4 GREEN tests: valid assembly, missing fragment, directory traversal, cycle and unsupported scriptlet; verify full `npm test`.
- [ ] Step 5: Build from actual pinned `legacy/source` in GitHub Actions and assert `dist/index.html` exists with no GAS includes.
- [ ] Step 6: Commit and report proof; do not claim frontend boot/visual parity without browser runtime tests.

### Task 2: Worker static serving and RPC transport (follow-up PR)

**Create:** `src/index.js`, `wrangler.jsonc`, `src/rpc/registry.js`; optionally `frontend/rpc-bridge.js`.  
**Test:** `tests/rpc-bridge.test.mjs`, Worker integration tests, Playwright.

- [ ] Define explicit method-aware and allowlisted Worker RPC contract, fail closed if backend not ported.
- [ ] Convert the centralized `serverCall` transport or use a tightly scoped `google.script.run` bridge without changing business page call sites; verify browser behavior.
- [ ] Serve built frontend via Workers Static Assets only, with API routing preserved.
- [ ] Add real preview browser tests for current navigation, POS V2 input, mobile breakpoints and invoice printing.
- [ ] Treat as **not done** until actual Worker smoke tests pass.

## Definition of done for this PR

A tested, reproducible static HTML assembly from the frozen originals, with zero source UI edits and explicit refusal of unsupported GAS templating. This is *part* of M01, not the whole Cloudflare Worker/frontend migration.
