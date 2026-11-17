# M03 Run 2 — Private Async/D1 Acceptance and Source-Migration Boundary

**Status:** The *private M03 repository/RPC asynchronous terminal audit* is ready for acceptance after exact-head full CI. **The original source's full 394-function async conversion is not yet complete.** This is a gated engineering handoff, not a release authorization or a renamed “all-done” milestone.

**Source of truth:** `shuvodelux-commits/SherERP_Cloud` GitHub `main`; frozen read-only `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Coordination issue #456, owner issue #22, `AGENTS.md`, `docs/PARALLEL_EXECUTION.md`, `docs/M03_PARALLEL_READINESS.md`, ADR-007. Never write to old GAS deployment/Sheets or promote isolated synthetic D1 tests to production.

## M03 Run 2 private migration achievements

1. **Source evidence:** The frozen call inventory covers 47 original GAS files, 614 named functions, and **394 functions whose transitive callgraph crosses Sheet/GAS read/write helpers**. Neither this count nor a renamed `.js` file proves those functions are implemented. Source-aware RPC inventory records blocked original browser callers.
2. **Private source contracts:** Reviewed, awaited master/legacy catalog adapters, Expense Categories status/rename CAS, PRODUCT snapshot and supplementary conversion readers, exact original Party ID/source-row provenance checks, immutable 49-group sealed synthetic source readback, and six archived historical read adapters. These are **narrow reviewed slices**, not 49 live master/financial tables or a fully migrated ERP.
3. **No leaked D1 promises in audited runtime:** `node scripts/audit-m03-run2-acceptance.mjs --check` AST-scans **all current `src/db/**/*.js` and `src/rpc/**/*.js`**, not just a hand-picked sample. Every recognized D1 `.all()`, `.first()`, `.run()`, `.batch()`, and `.exec()` must be awaited in its **own async function** or directly returned by that async function. Unknown terminal aliases and computed D1 dispatch fail closed, including deferred-callback Promise leaks. The older precise 12-file/51-site reviewed await-chain gate remains separately enforced.
4. **Private RPC value safety:** `src/rpc/awaited-response-boundary.js` rejects nested Promise/thenable/JSON value leaks from trusted internal envelopes. Do not confuse successful private bridge tests with a public RPC grant.
5. **Tests and merge rule:** Tests must precede implementation (RED→GREEN); run all GitHub checks including the six local Workerd/D1 shards and aggregate, Node source/SQLite regressions and CI authority checks. No merge with failed, missing, pending, skipped or conflicted exact-head checks. Recheck latest main before an expected-SHA squash merge.

## What is NOT completed or authorized

| Gate | Current decision | Evidence needed to unlock |
| --- | --- | --- |
| Private M03 D1 terminal await audit | **VERIFIED only after full exact-head CI** | Automated exhaustive AST check and mutation-negative tests |
| Full 394 original-source function conversion | **BLOCKED / not port-verified** | Endpoint-by-endpoint source oracle, source-shaped D1 adapter, awaited transitive callers, real local Workerd/D1 parity and honest coverage ledger |
| M02 real source identity and historical-data import | **BLOCKED** | Verified 49-group column/row mapping, separate Party roles/accounts, dry-run replay/reconciliation, backup/cutover approval |
| M04 authenticated client RPC | **BLOCKED** | Server-validated D1 session, trusted permission/actor context and explicit allowlist per named method |
| M03 shared SQL-atomic posting/reversal | **BLOCKED** | Source-valid posting policy, idempotent operation IDs, exactly-once replay/reversal, single integrator, full local D1 rollback/concurrency tests |
| Public Worker database binding and production cutover | **BLOCKED** | M02/M03/M04 dependencies, coordinated M05–M09 acceptance, M10 rehearsal and M11 release authorization |

## Verification

```bash
node scripts/audit-m03-async-closure.mjs --check
node scripts/audit-m03-reviewed-await-chains.mjs --check
node scripts/audit-m03-rpc-readiness.mjs --check
node scripts/audit-m03-forbidden-gas-runtime.mjs --check
node scripts/audit-m03-run2-acceptance.mjs --check
node --test tests/m03-run2-full-private-async-acceptance.test.mjs
```

Do not alter `src/rpc/registry.js` or attach production D1 merely to mark a check green. The public registry stays empty and the Worker continues to report `database:'not-connected'`.

**Handoff:** Run 2's *private repository async barrier* can close after its checks are fully green; the wider **full-source Run 2 conversion and M03 module itself cannot honestly be declared complete** until the explicit blocked gate items are evidenced. Run 3 may advance independent design and local atomic proofs in parallel, but no shared live financial writes until the coordinated M02/M04 approval gate.
