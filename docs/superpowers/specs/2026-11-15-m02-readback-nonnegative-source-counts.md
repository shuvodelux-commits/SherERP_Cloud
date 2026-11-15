# M02-safe — Reject invalid source-row count arithmetic in offline Party readback

**Authority:** AGENTS.md, docs/MIGRATION_PLAN.md, ADR-007. **Pinned original source:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.

## Defect
`reconcilePartyImportReadback` compares `summary.sourceRows === plan.links.length + summary.quarantinedRows`, but never validates either count as a nonnegative safe integer. A fabricated future-schema readback and altered reviewed Party plan with `quarantinedRows=-1`, `sourceRows=links.length-1` satisfy the equality and skip the positive quarantine check. Fractional counts can similarly satisfy it while evading the explicit `PLAN_COUNT_MISMATCH` diagnostic. A parity report must not certify an impossible source snapshot.

## Decision
Require both `summary.sourceRows` and `summary.quarantinedRows` to be nonnegative JavaScript **safe integers**, in addition to existing exact count relationships. When invalid, append the existing privacy-safe `PLAN_COUNT_MISMATCH` issue with `table:'plan'` and set `identityRowsMatch:false`. Do not echo count values or source details in diagnostics; leave `approvalEvidencePersistent` semantics unchanged because it describes readback persistence, not overall import readiness. Valid zero and positive quarantined row counts continue to report their existing `QUARANTINED_SOURCE_ROWS` safety issue.

Use a future-schema synthetic snapshot that exactly mirrors the invalid in-memory plan; negative and fractional counts must fail specifically with `PLAN_COUNT_MISMATCH` (not only unrelated issues). Verify normal zero and positive quarantine behavior. Actual local Workerd/D1 data remains read-only; assert plan summary tampering is caught and no D1 records change.

## Boundaries
Only the M02 pure readback reconciler, its Node contract and local Workerd/D1 regression suite, spec and plan. No changes to source ID logic, original GAS/HTML UI, M03, M04, finance, SQL, migrations, Cloudflare bindings, staging/production D1, cutover policy or account posting. Existing approval_ref persistence and authenticated-review blockers remain. PARALLEL-MODULE-READY=false.
