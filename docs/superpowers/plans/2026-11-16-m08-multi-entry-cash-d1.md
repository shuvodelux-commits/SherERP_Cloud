# M08 Multi-entry closing Cash Reconciliation proof: execution plan

**Design:** `docs/superpowers/specs/2026-11-16-m08-multi-entry-cash-d1-design.md` | **Issue:** #389 | **Pinned source:** Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. GitHub-first Superpowers test-first workflow; preserve original UI and financial source.

### Task A — RED (commit tests before implementation)

1. Add `tests/integration/m08-reconciliation-multi-workerd.spec.mjs` importing the **not-yet-created** `tests/fixtures/m08-reconciliation-multi-schema.mjs` and `tests/fixtures/m08-reconciliation-multi-contract.mjs`; use only the existing denied-route worker fixture in a new fake D1 config.
2. Test a two-entry cash-in closing sum, stable idempotent replay including reordered/duplicate JSON/CSV selection, changed intent, wrong direction/total/deleted/synthetic/missing, cross-session/cross-phase prior usage, stale revision, revoked role/session/token, concurrent contenders, late second-link/audit failures, same IDs in another tenant and no public route. Snapshot receipts, links, session, original Cash Book and audit before/after failure; ensure zero partial writes.
3. Add `wrangler.m08-reconciliation-multi-test.jsonc` with fake UUID; add isolated PR-only `.github/workflows/m08-multi-cash-d1.yml` to run actual `node --test tests/integration/m08-reconciliation-multi-workerd.spec.mjs` on local Wrangler. Existing M03 aggregate stays unchanged to minimize shared-file conflicts.
4. Commit test/config/workflow while production fixture missing, open draft PR, inspect explicit GitHub `ERR_MODULE_NOT_FOUND` in failed Actions.

### Task B — GREEN (implementation after verified RED)

1. Add `tests/fixtures/m08-reconciliation-multi-schema.mjs` that imports the merged test-only `M08_RECON_DDL`, provides `M08_MULTI_DDL` and seed function, adds `m08_multi_receipts`, `m08_multi_links`, `m08_multi_audit`, `m08_multi_prior_usage` plus one atomic trigger and immutable guards.
2. Add `tests/fixtures/m08-reconciliation-multi-contract.mjs` using the pinned GAS source's parser via existing `evaluateCashExplanation` (ID parsing only), validating primitive input, canonical operation hash, fixed SQL with `json_each` guarded row cardinality and cent sum, and SQL-time auth/role/session/revision checks. No schema migrations or public Worker/finance import.
3. Verify exact Workerd/D1 result on GitHub, then fix errors without relaxing target financial invariants. Run/inspect Foundation, source digest and build jobs, and update PR body with RED/GREEN links.

### Task C — Review and release boundary

Inspect changed files, mergeability and latest main. Leave PR ready and unmerged. Record that multi-entry *closing* fixture is proved, while real Cash Book schema, session positional calculations, opening corrections, production tenant/RBAC, full migration, backups and cutover remain blocked.
