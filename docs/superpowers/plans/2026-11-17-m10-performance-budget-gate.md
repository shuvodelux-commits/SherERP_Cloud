# M10-13 — Offline performance and D1 resource-budget evidence gate

**Module:** M10; **issue:** #312; **parallel board:** #456; **base:** `main@1f068fc3c30c625446c560364fb872ae68cb8bc1`; **original:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Implementation overview (12 sentences)
1. M10 still lacks the independently checked p95/p99 latency, Workers CPU and D1 query-budget evidence required before production consideration.
2. The next isolated slice will assess supplied synthetic or explicitly authorized private-stage measurements without measuring or connecting to Cloudflare itself.
3. No arbitrary performance targets will be invented or silently treated as approved.
4. The caller must provide an explicit reviewed-target manifest with a fixed workload set and numerical limits for p95/p99 latency, p95 CPU and p95 D1 queries and rows read.
5. Each measured workload must carry at least 100 paired request samples so an observed p99 is not inferred from a handful of calls.
6. The evaluator will calculate nearest-rank percentiles independently from those samples rather than trusting supplied p95 figures.
7. Source pin, environment/dataset provenance, distinct workload IDs and exact coverage will be validated.
8. Missing evidence, too few samples, unreviewed thresholds, duplicate or unexpected workloads and any exceeded resource budget will fail closed with fixed diagnostic codes.
9. Accessor-backed, inherited, unknown or malformed values will be rejected without revealing caller-supplied exceptions.
10. Output will include only redacted aggregate issue counts and a candidate-only budget status, never raw samples, workload identifiers, private business data or approval references.
11. Superpowers RED tests will be committed before the minimal implementation, and exact-head full GitHub CI will be mandatory before merge.
12. Even successful synthetic evidence will not prove an actual representative private Workers/D1 benchmark, owner approval, source migration or permission to launch.

## Impact and ownership
- **M10 exclusive new paths:** `docs/superpowers/plans/2026-11-17-m10-performance-budget-gate.md`, `tests/m10-performance-budget-gate.test.mjs`, `src/migration/m10-performance-budget-gate.js`.
- **Read-only contracts:** `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, `AGENTS.md`, `docs/PARALLEL_EXECUTION.md`, issue #312.
- **No shared edits:** `src/db/**`, `migrations/**`, `src/rpc/**`, `src/index.js`, auth, posting, Cash Session, Workers bindings, workflows, original UI, original GAS/Sheets and private exports.
- **RPC/SQL IDs:** none; pure metadata evaluator; no original source code copied/transformed.
- **Dependencies:** M10 #467 integrated into main, no M03 shared path, M11 production remains independently gated.
- **Merge order:** test-first RED → minimal GREEN → full exact-head CI/review → main, never stack on another unmerged branch. No automatic production activation.
- **Rollback:** revert three new M10-only files; no schema/data rollback.

## Acceptance
1. Supply policy `formatVersion:1,reviewRef,reviewed,workloads` and recording `sourceCommit,environment,datasetRef,captureId,capturedAt,workloads` as strictly shaped own-data objects.
2. Workload policy explicitly supplies `latencyP95MaxMs,latencyP99MaxMs,cpuP95MaxMs,d1QueriesP95Max,d1RowsReadP95Max` for each named workload; no built-in business limits.
3. Recording uses individual latency, CPU, D1-query and D1-rows-read observations; independently compute nearest-rank percentiles from 100–5000 samples per workload.
4. Reject absent policy/data, unreviewed policy, missing/extra/duplicate workloads, too few samples, invalid shapes, invalid timestamps/source pin, negative/NaN/Infinity and budget exceedances.
5. Two identical 100-sample synthetic workloads pass **candidate** parity, but `authorizesImport:false`, `authorizesCutover:false`, `productionReady:false` always.
6. RED test failure and GREEN tests must be evidenced honestly; GitHub full source/build/Node/D1/UI checks remain required, while the new pure helper itself performs **no real D1 operation**.

**Readiness:** Issue #312 remains open. No private/staging import, real benchmark, production cutover or owner approval is implied.
