# M03 Async Caller Closure Audit — Design (2026-11-15)

## Objective
Give the exclusive M03 repository adapter owner a **source-faithful, non-executable** review map of functions that directly or transitively depend on legacy read/write primitives. A direct call count by file already exists in `scripts/audit-m03-callers.mjs`, but does not show which upstream code needs conversion to `await`.

## Source / scope
- Frozen source: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, exactly 47 `legacy/source/*.gs` files.
- Do not change GAS source, shared `src/db`, migrations, actual Worker modules, `src/rpc`, M04 auth, financial postings, or remote staging D1.
- Do not treat the graph as a complete proof of asynchronous safety. The scanner is an **Acorn syntax-tree analysis**, but the resulting named-function dependency graph remains deliberately conservative and is not a complete runtime analysis. It records calls between named, column-zero GAS functions only; callback timing, function-valued variables, shadowed names, runtime dynamic calls, property dispatch and generated code are not fully resolved.

## Approach
Existing options: (a) keep filename-only direct counts (insufficient upstream visibility); (b) convert repo data access now (would conflict with M03 exclusive ownership); (c) **selected** independent reverse-call graph of frozen GAS sources with shortest source-to-primitive paths.

For each top-level `function name(...){...}`:
1. Parse source with pinned Acorn 8.19.0 (syntax-only; never executes GAS). Only root-level FunctionDeclaration nodes define globally named functions, and real CallExpression nodes are counted. Regex literals, comments and string text are not calls.
2. Collect calls to other named top-level GAS functions; treat duplicate names as an error instead of arbitrarily resolving cross-file collisions.
3. Use direct calls to legacy sheet primitives as **seed points**. Propagate their presence backwards through known named call edges. Track read vs write separately, including a deterministic shortest path to each seed.
4. Emit pinned, alphabetically sorted JSON with source SHA, total top-level functions, direct-read/write seed names, affected function count, per-function source file, direct vs transitive reachability and shortest path. No source values or runtime customer/financial data.
5. `--write` explicitly regenerates `docs/baseline/m03-async-caller-closure.json`; `--check` rejects drift against current frozen files.

## Constraints / anti-claims
- A seed describes dependence on legacy I/O; audit/error logging may create a transitive write path even for read-only reports, **not** a recommendation to mechanically make all functions async, nor an approved transaction boundary.
- A caller with no path can still depend on D1 indirectly via dynamic dispatch, callbacks, inline functions or unscanned GAS services.
- `getSheet_/getRange`, `SpreadsheetApp`, `LockService`, `CacheService` and other GAS services require separate review via existing direct-call inventory; this is focused on known repository-helper dependency graph.
- No public RPC added, no SQL, no auth bypass; no financial readiness flag altered.

## Verification
Synthetic tests and a full 47-file frozen-source regression must show transitive chains and shortest paths, direct/indirect write propagation, recursion without infinite traversal, comments/strings ignored, missing function definition preservation, duplicate function rejection, and snapshot drift. Run full `npm test`, pinned-source verification, frontend build, snapshot check and CI. If merged, M03 owner consumes this artifact to plan awaited D1 call-chain conversion, with real D1 write/rollback and M04-auth gates still independent.

## CI dependency integrity
The pinned Acorn parser is a development-only package, but `npm test` imports the new audit. Existing validation workflows must run `npm ci` from the committed lockfile before tests. This includes the manual staging workflow solely to keep its local tests reproducible; no workflow triggers, credentials, D1 bindings, remote operations or deployment ownership change.