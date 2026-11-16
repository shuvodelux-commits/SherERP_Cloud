# M03 — Browser RPC and async backend readiness gate (2026-11-16)

## Scope and implementation overview

1. This increment starts M03 Backend/RPC contract integration without enabling any public business API.
2. The behavioral source remains frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
3. Original 37 HTML files contain `serverCall(...)` references that must be inventoried independently from GAS function definitions.
4. The existing M03 AST closure has 394 source functions impacted directly or transitively by Sheet read/write helpers; impact does **not** prove migration.
5. The existing public `rpcRegistry` is intentionally empty and `/api/rpc` fails closed.
6. Add a Node-only, read-only audit that records literal browser RPC call names and their source files, plus unresolved dynamic calls.
7. Each inventoried literal is annotated only with whether it appears in the frozen async closure and with explicit `blocked` public status.
8. Never infer that a method is migrated or authorized solely from name matching, a synthetic local D1 module or a lexical match.
9. Fail the audit if the frozen source SHA differs, the closure shape is corrupt, or any new public registry handler is detected pending separate M04 review.
10. Preserve the distinction between literal lexical detections, comments/strings, dynamic expressions and verified callable contracts.
11. The audit touches no `src/db`, migrations, `src/rpc`, `src/index.js`, assets, auth or business module logic.
12. The source interface remains `serverCall(fnName,...args)` to same-origin `POST /api/rpc` with `{fnName,args}`; there is **no** release activation.
13. The only changed artifacts are this plan, `scripts/audit-m03-rpc-readiness.mjs`, and `tests/m03-rpc-readiness.test.mjs`.
14. Execute a failing test-only RED commit first, then minimal GREEN implementation, then full Node and browser/Workerd CI on the PR head.

## TDD and acceptance

- RED: the tests import the missing audit module, then fail for the expected missing implementation.
- GREEN: `node --test tests/m03-rpc-readiness.test.mjs` passes with synthetic fixtures and frozen repository source.
- Source scope: `legacy/source/*.html`, `docs/baseline/source-manifest.json`, `docs/baseline/m03-async-caller-closure.json`.
- Repository contract: `src/rpc/registry.js` must remain empty until a separately reviewed M04 authenticated release.
- Input: immutable original HTML, pinned source SHA and audited transitive function list.
- Output: non-sensitive, deterministic readiness JSON; no SQL, staff, customer or product values are read or exposed.
- Invalid source, mismatched SHA, malformed closure and nonempty RPC allowlist fail closed.
- Run `node scripts/audit-m03-rpc-readiness.mjs --check`, `npm test`, and existing real Workerd/D1 checks via GitHub Actions; do not call this full M03 completion.

## Impact / release boundary

| Area | Before | After |
| --- | --- | --- |
| M03 source RPC audit | No deterministic browser-to-async closure report | Generated, lexical, explicitly non-authorizing local audit |
| D1 tables / imports | Four reviewed local versioned migrations, no full source import | Unchanged |
| Public RPC / auth | Empty registry and 501 for business methods | Unchanged |
| Party/stock/cash/bank | Not end-to-end migrated | Unchanged |
| Deployment | DB-free public Worker, no preview D1 | Unchanged |

**Next independent gate:** choose a source-backed, source-ID-reconciled D1 vertical slice and prove its original RPC envelope plus real Workerd/D1 reads, writes, denial and retries before requesting any method activation.
