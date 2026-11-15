# M03 — Source-faithful transitive async conversion graph (no runtime change)

**Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/*.gs`, existing lexical `scripts/audit-m03-callers.mjs` and `docs/baseline/m03-direct-call-inventory.json`. **Workstream:** M03-core preparatory audit; no separate schema owner or real RPC needed.

## Problem

The existing M03 direct-call inventory counts text patterns at file level. It does **not** identify a transitive path from a business function such as `completeSale` through another helper to a synchronous Sheet API, GAS service, LockService or mutable request cache. Converting only direct calls leaves `Promise` values silently escaping to code that expects arrays or objects. We need a deterministic source graph with parse/ambiguity failures visible, not a false claim that async propagation is done.

## Scope

- New pure script `scripts/audit-m03-async-graph.mjs` with `buildLegacyAsyncCallGraph(files)` and a CLI reading all frozen `.gs` files from `legacy/source`. Parse with the already installed `acorn@8.19.0`; no dependency updates.
- Extract **top-level** named function declarations and top-level variables whose initializers are arrow functions or function expressions. Each definition is identified by `file:functionName`, not name alone.
- Traverse AST CallExpressions, NewExpressions, nested callbacks/function bodies and member expressions to record direct `getAllRows_`/`find...`/`append...`/`update...`/`delete...`/`getSheet_`, sheet range method calls, and GAS service references. Property/member calls are **never** mistaken for a global function of the same name. Strings, template text and comments are ignored by AST parsing.
- Construct directed edges to all original global names resolved in the source map; never silently pick one of multiple definitions with the same function name. Report duplicate names separately, and conservatively traverse **all** candidate definitions if called. A source with a real syntax error must fail the audit; do not skip files or silently continue.
- Compute a stable short **path to direct boundary** via BFS for each named function. Direct functions get a single-node path; indirect callers get `[file:name, ..., file:directHelper]`, and pure functions return `null`. Sort files, function IDs, edges and paths for reproducibility; cycles must terminate and cannot leak `Promise` into graph computation. This graph only says **needs async review**, not proof that migration is complete or safe.
- Preserve existing `scripts/audit-m03-callers.mjs` and exact direct inventory. Compare full source digest to the already-pinned SHA-256 in the direct baseline; no source byte modifications. Runtime scanner output is JSON with counts, duplicate warnings, functions with direct/indirect paths, and an honest note that dynamic/property-dispatched calls, shadowed names, injected globals and callback scheduling require manual inspection.
- Add Node tests against synthetic cross-file functions, multiline syntax/comment/string false positives, arrow functions, member dispatch, duplicate definitions, recursion/cycles, invalid source and deterministic order, plus the **real 47-file source pin** and a `completeSale` route to some direct GAS/Sheet dependency. Run via existing Foundation `npm test`; no workflow edits required.
- CLI supports `--summary` to report a small human-readable totals object, and full JSON by default. `--check` checks source digest against existing direct-call inventory instead of writing a second manually maintained huge baseline.

## Non-goals and gates

This does **not** port an ERP module, transform code, implement any D1 access, mark M03 ready, replace the AST with heuristic regex, or register live RPC. No `src/db`, migrations, Worker, frontend, original source files or deployment changes. The graph is static and must not be treated as an exact runtime call graph; nested callback analysis intentionally errs toward over-reporting. Later M03 work must verify all call sites and async boundaries with source/Workerd D1 and Promise-leak tests.

**Rollback:** revert this read-only tooling PR.
