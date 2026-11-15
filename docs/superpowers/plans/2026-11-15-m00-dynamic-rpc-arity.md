# M00 — Dynamic browser RPC positional-argument parity (2026-11-15)

**Original source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**References:** repository `AGENTS.md`, M00 section of `docs/WORKSTREAMS.md`, `scripts/audit-m00-rpc.mjs`, `scripts/audit-m00-dynamic-rpc.mjs` and their checked-in snapshots.

## Owner and immutable boundaries
Single M00 source audit branch; add `scripts/audit-m00-dynamic-rpc-arity.mjs`, `tests/m00-dynamic-rpc-arity.test.mjs`, `docs/baseline/m00-dynamic-rpc-arity.json`, this plan and the matching design spec. Do **not** edit original GAS/HTML, `src/db`, SQL, Worker, public RPC registry, auth, backend business modules, frontend UI, or deployment/CI. No external dependencies.

## RED → GREEN tasks
1. [ ] RED: Commit tests importing the absent arity auditor. Actual GitHub Foundation CI must fail with `ERR_MODULE_NOT_FOUND`.
2. [ ] GREEN: Implement an Acorn AST **read-only** audit that first calls existing `auditM00DynamicRpc` (and checks its reviewed snapshot), then matches each of its four source line/selector sites to exactly one actual `serverCall` AST call, counts arguments after the method, and compares with **each** original target GAS function's simple positional formal parameters. Reject spread, missing/ambiguous sites, destructured/default/rest parameters, or any argument count mismatch. No permissions or endpoint activation.
3. [ ] Add the reviewed deterministic JSON snapshot with 4 dynamic sites and 16 matching targets (site arities **2, 3, 2, 3**). Implement `--check` and `--write` CLI matching existing M00 audits.
4. [ ] Verify source mutations on both client and backend produce an explicit regression failure, checked-in inventory drift fails, and all original 84 files stay unchanged.
5. [ ] Run targeted tests, GitHub full `npm test`, `verify:source`, frontend build, local Worker D1 and Chromium CI. Verify final PR paths and CI before offering merge.

## Limitations
A signature's positional arity **does not prove types, permissions, authentication, optional runtime behavior or business logic parity**. This is strictly a source contract for the four currently reviewed dynamic browser calls. The other 172 literal calls are outside scope. `PARALLEL-MODULE-READY` remains false.
