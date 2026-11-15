# Superpowers TDD — M03 transitive async call graph

**Design:** `docs/superpowers/specs/2026-11-15-m03-transitive-async-graph-design.md`. 
**Branch:** `feat/m03-transitive-async-call-graph-20261115`, based on `main`.
**Source:** frozen Mohim_ERP SHA `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; 47 original `.gs` files.

1. Inspect `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/M03_PARALLEL_READINESS.md`, existing direct inventory and `package.json` Acorn. No changes to shared runtime/DB.
2. **RED:** Add `tests/m03-transitive-async-graph.test.mjs` asserting parsed graph, direct vs indirect shortest path, cross-file dependencies, no member false edge, cycles, duplicate global names, stable ordering/source hash, source parsing errors, and full 47-file frozen read with `completeSale` coverage. Commit before creating the scanner, then confirm the expected missing-module `ERR_MODULE_NOT_FOUND` on GitHub Foundation.
3. **GREEN:** Add only `scripts/audit-m03-async-graph.mjs`. Use Acorn AST, deterministic traversal with a conservative definition/name index and BFS. Implement import-safe CLI `--summary`, `--check` (pinned digest), full JSON output. Fail loudly on syntax errors and malformed source. Don't modify existing inventory or original source.
4. Verify exact-head Foundation Node/source/frontend, M01 Chromium, M02/M03/M04 local Workerd D1 regressions and Cloudflare PR safety. Inspect new graph tests for false positives and syntax incompatibility. Minimal refinements to tests/implementation only with evidence.
5. Open/update narrow draft PR documenting RED/GREEN run links, exact file inventory, whether full source parse passed, representative source graph findings, known limitations, no production changes, rollout/rollback. Compare latest `main` for overlap and leave merge gated on all checks.

**Files:** two new docs, new Node test and new scanner. No changes to existing runtime or build config. 
