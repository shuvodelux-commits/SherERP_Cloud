# M00 Frozen Client RPC → Backend Definition Inventory (2026-11-15)

## Intent
Make the legacy browser-to-backend RPC surface explicit for M03's async-port and M04's later per-method authenticated allowlist work, without routing any RPC. The current `scripts/audit-source.mjs` records literal RPC names only and cannot tell whether they resolve to original backend functions or are dispatched through variables.

## Original source and constraints
- Original GAS source is pinned to `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` in `docs/baseline/source-manifest.json`.
- Read only `legacy/source/*.html` and `*.gs`; no writes, imports, auth endpoints, D1 access, or contact with legacy Sheets.
- No changes to `src/rpc`, `src/db`, financial SQL, migrations, original HTML/JS, Cloudflare preview/deployment.
- An original GAS function being present is **never** authority to expose it in Worker RPC; actual allowlisting, permission, input-validation and D1 tests remain M04 gates.

## Alternatives
1. Reuse original `auditSource().rpcNames` — lists only literal names, misses dynamic dispatch and definition gaps.
2. Build an executable RPC registry now — unsafe because M03 async and M04 secure authenticated endpoints are not yet ready.
3. **Selected:** a standalone read-only cross-reference from client callsite to original backend function plus separately reported dynamic callsites. Emits pinned deterministic JSON, with `--write` for reviewed regeneration and `--check` for CI drift.

## Interface
`auditM00RpcContracts({sources,sourceCommit})` accepts a map of source filename to frozen text. It returns:
- `formatVersion`, `sourceCommit`, `methodology`
- `counts`: frontend files, backend files, literal callsites, dynamic callsites, unresolved names
- `rpcs`: sorted unique literal RPC names, source HTML files and call counts, located original `.gs` owner (if unique), `status: DEFINED/UNRESOLVED`
- `dynamicCallsites`: sorted HTML filename and line only. Never invent dynamic handler names or assume they are safe.
- Duplicate backend definitions for a literal RPC: fail closed on collisions instead of arbitrarily picking an owner.

The scanner masks JS comments/string bodies when finding `serverCall(` invocations but peeks into the original source to parse an immediately supplied quoted literal name. It excludes the function definition `function serverCall(fnName)` itself. It scans only root-level source files and top-level `function name(` GAS declarations. It is intentionally a conservative lexical audit, not an AST, complete callgraph, runtime guarantee or authorization policy.

## Acceptance and limitations
Six or more node tests cover literal/dynamic/comment/string/reformatted invocations, missing definitions, duplicate definitions, source-drift detection and CLI arguments. `npm run verify:source` independently guarantees pinned original contents. The generated mapping is informational to M03/M04; no backend RPC endpoints become callable, and `PARALLEL-MODULE-READY` remains false.