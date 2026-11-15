# M02-P pending identity review queue — Superpowers TDD plan (2026-11-15)

**Original source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Workstream:** M02-P isolated, **read-only internal** review queue summary. `AGENTS.md`, `docs/WORKSTREAMS.md`, ADR-007 and existing `migrations/0002_party_identity.sql` apply.

## Goal
Allow safe migration QA to tell whether OPEN identity review cases remain, grouped by approved reason, using actual D1 data without revealing original identifiers, names, phone numbers or person attributes. No review approval or identity linking.

## Scoped files and boundaries
- New `src/party/d1-review-queue-summary.js`, new `tests/m02-party-review-queue-summary.test.mjs`.
- Extend only `tests/integration/m02-party-plan-workerd.spec.mjs` under existing local-only M02 CI.
- New spec and this plan. No `src/db`, migrations, M03 kernel, M04 auth, RPC, Worker, original UI, financial module, workflow, bindings or production D1 edits.

## TDD sequence
1. [ ] RED: add isolated Node tests and new local **real workerd+D1** tests first; observe GitHub failure for missing module, identify expected cause.
2. [ ] GREEN: add minimal `summarizeOpenPartyIdentityReviews({DB})` using one constant prepared `SELECT reason, COUNT(*)` statement with `status='OPEN'`, grouped and ordered. Do not accept caller SQL or emit raw review IDs. Reject malformed D1 results and sanitize DB error messages.
3. [ ] Real D1: verify no reviews produce zero count; insert ONLY test synthetic OPEN + terminal reviews, assert exact OPEN reason counts and no change to imported Parties/roles/links; separate Worker remains all-404.
4. [ ] Verify Node full suite, source pin 84, frontend build, existing 8 GitHub Actions (including real workerd D1 and Chromium), no missing permissions and no destructive writes.
5. [ ] Reconcile latest main for overlapping files and CI. Open narrow PR for owner review; do not merge automatically.

## Acceptance/limitations
The read model is intended only for trusted internal migration diagnostics; **it does not authenticate a caller** and must not be registered as a public RPC until M04's authorization gate. It does not perform review workflow, approve links or persist missing `approval_ref` evidence. The readiness flag remains false.
