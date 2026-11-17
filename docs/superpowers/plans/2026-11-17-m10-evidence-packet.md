# M10-15 — Offline migration evidence packet and cross-gate consistency

**Owner:** M10, existing issue #312; coordination issue #456.
**Base:** `main@7c81dca09f975fbda37586eb50c2763c7f8506df`.
**Original:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Prerequisite:** PR #490 merged and M10-01, M10-12, M10-13, M10-14 are available on main.

## Approved-scope overview (12 sentences)

1. Independent M10 preflight evaluators now exist for all 49 source group summaries, source-to-backup restore integrity, distinct gross Party accounts and performance budgets.
2. Running each evaluator separately can overlook a contradictory identity-review count or financially late evidence capture in the same proposed rehearsal.
3. This task adds a single offline evidence packet that calls all three reviewed comparison modules without writing or changing shared infrastructure.
4. The packet requires the exact existing `rehearsal`, `restore`, `gross` and `performance` evidence shapes and rejects undocumented top-level fields.
5. The source-to-backup chain must succeed and the performance and gross candidates must also independently succeed before packet-level candidate completeness is true.
6. The private Party identity-review pending count must match the count supplied to the 49-group rehearsal, and must be zero before even synthetic candidate completeness.
7. Original gross source and D1 readbacks may not be captured after the backup they are purported to substantiate, and performance recording cannot precede the restored-readback timestamp.
8. Missing, malformed, stale, unauthorized or internally inconsistent evidence must produce fixed redacted diagnostics or a fixed redacted error.
9. All inputs are treated as supplied, not verified attestations; source hashes, capture IDs, account balances and workload measurements cannot be published in output.
10. The operator receives a deterministic candidate-only checklist and one local-only JSON command, with no network, D1, source Sheets or production deployment access.
11. Test-first synthetic cases validate mismatches across independent green reports, blocked gross balances, p99 regression, chronology, malformed inputs, no raw-data leakage and read-only behavior.
12. Even a positive packet **never** means sanctioned private source provenance, actual 49-group D1 reconciliation, independent security/accounting signoff or permission to import, post, restore or launch.

## File ownership and dependencies

**New M10-only paths:** `src/migration/m10-evidence-packet.js`, `tests/m10-evidence-packet.test.mjs`, `scripts/m10-evidence-packet-check.mjs`, `tests/m10-evidence-packet-cli.test.mjs`, `docs/runbooks/M10_EVIDENCE_PACKET.md`, and this plan.
**Read-only dependencies:** `src/migration/m10-rehearsal-restore-chain.js`, `m10-gross-party-reconcile.js`, `m10-performance-budget-gate.js`, the frozen 49-group inventory, M02 signed gross account contracts.
**Forbidden shared edits:** `src/db/**`, `migrations/**`, `src/rpc/**`, `src/index.js`, numbered D1 migrations, Worker bindings, Cash Session/Party posting/reversal, original frontend, `AGENTS.md`, coordination files, CI workflows and original GAS/Sheets.
**No source ID or table writes, no remote D1, no private export, no access to the user's local computer.**

## Test-first acceptance

- RED: test import of absent M10-only implementation, check actual GitHub failure if workflow completes before supersession; do not claim hosted RED if cancelled.
- GREEN: reuse all three existing M10 contract evaluators unchanged. Evidence shape: own fields `rehearsal`, `restore`, `gross`, `performance`; internally pass only `{rehearsal,restore}` to chain.
- Report `chainCandidate`, `grossCandidate`, `performanceCandidate`, `candidateEvidenceComplete`, fixed issue counts, unconditional `authorizesImport:false`, `authorizesPosting:false`, `authorizesRestore:false`, `authorizesCutover:false`, `productionReady:false`.
- No numerical budget threshold guessed; no conversion of external flags to proof of production approval.
- Full exact-head GitHub CI including existing local real Workerd/D1/Playwright suites, reviewer gate and main-file verification required before merge.
- Rollback: revert six newly added M10-only files; no database/data rollback.
