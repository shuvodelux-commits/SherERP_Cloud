# M02-P — Safe Integer Original Sheet Row Provenance (Superpowers Plan)

> **For agentic workers:** Required sub-skill: superpowers:executing-plans. Implement step-by-step: plan → test-only failing commit → GitHub RED proof → minimal source patch → GitHub GREEN proof → review.

**Goal:** Fail closed when a Party export provides an `_rowIndex` beyond the exact integer range of JavaScript, before attempting source drift or human-reviewed identity-link validation.

**Architecture:** The current `src/party/export-column-coverage.js::validatePartyExportCompleteness` admits an integer with `Number.isInteger(value)`, including non-safe `2 ** 53`. The downstream `src/party/party-import-plan.js` and `src/party/import-snapshot-guard.js` already require `Number.isSafeInteger(value)` and throw. Align the earlier **read-only source-coverage gate** with those authoritative invariants, using existing fixed `UNSAFE_VALUE` issue counts. No new validation response schema; no source-row or identity modification.

**Tech Stack:** Existing JavaScript ESM, native `node:test`, Cloudflare Worker/D1 GitHub Actions, pinned original GAS schema inventory.

**Spec/authority:** `AGENTS.md`, `docs/WORKSTREAMS.md` M02-P, `docs/architecture/ADR-007-unified-party-relationships.md`, original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` and `docs/baseline/schema-inventory.json`.

## Global constraints
- GitHub branches/PR/CI only; KISS, test-first exact-head RED → GREEN.
- `_rowIndex` is export provenance, not a new original GAS column; it may be absent. When present it must be a **safe integer ≥2**. Preserve valid `2`, `Number.MAX_SAFE_INTEGER` and all unchanged source IDs, financial signs, roles and Phone values.
- Keep original five master export headers and data field validation unchanged; no master row rewriting, normalization, identity merge, financial posting, finance permission or D1 writes.
- Return existing redacted issue structure and `UNSAFE_VALUE` counts for wrong provenance, including huge integers. An unsafe row position must prevent review approval reuse before the snapshot guard tries to parse it.
- Revert-only rollback, no database effects; `PARALLEL-MODULE-READY=false`.

## Task 1 — Proof of lossless provenance validation
**Files:** Create `tests/m02-party-export-rowindex-safe-integer.test.mjs`; modify `src/party/export-column-coverage.js` after RED only; create this plan.

- [ ] Commit plan first.
- [ ] Write test-first synthetic complete master exports using pinned schema headers for all five Party source groups. Assert `2 ** 53` and `Number.MAX_VALUE` are rejected as `UNSAFE_VALUE` and fail `offlineExportComplete`; legitimate `2`, safe upper bound and omitted `_rowIndex` pass unchanged.
- [ ] Assert two **identical** reviewed/candidate exports with unsafe `_rowIndex` fail the initial `validatePartyImportCandidate` export checks with `VALIDATION_SKIPPED`, `identityReviewClear=null` and redacted counts, without trusting approvals. Current code throws only after passing false-positive complete exports, which is inadequate.
- [ ] Verify actual GitHub Foundation **RED** failures on preexisting `Number.isInteger` logic; ensure valid control tests pass.
- [ ] Replace only the existing `Number.isInteger(value)` condition with `Number.isSafeInteger(value)` in `src/party/export-column-coverage.js`. No other production edits.
- [ ] Verify all new tests and entire Node suite GREEN; run original source checks/UI, M02 Party local Workerd/D1, M03 Worker runtime local D1, M04 auth D1, M01 browser and Cloudflare PR safety workflows.
- [ ] Review exactly 3 changed paths; include actual RED/GREEN SHA, run IDs, compatibility scope, no live data or import approval in PR. Leave for owner review.

## Review focus
- No silent 2^53 rounding or integer aliasing on source row identity.
- No inflated approval status when identical unsafe input snapshots appear.
- No disclosure of source IDs, phone or reviewed references in diagnostics.
- No account/role netting or source identity normalization.
- No source-schema evolution or production D1 change.
