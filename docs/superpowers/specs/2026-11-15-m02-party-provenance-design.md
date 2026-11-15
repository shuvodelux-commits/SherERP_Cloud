# M02-P3 Party Import Provenance Validation — Design

**Date:** 2026-11-15
**Status:** Narrow source-integrity hardening of already approved M02-P dry-run. No database importer or live migration.

## Intent
An offline Party planner must not claim lossless, deterministic identity review when two records from the same legacy sheet claim the same physical source row, or when distinct unresolved rows generate the same proposed review ID. Preserve the original approved Unified Party identity separation and never infer identity from shared names or phones.

## Boundaries and requirements
- Keep `planPartyImport(sourceRows, approvedGroups=[])` signature and current output shape.
- If a source row has `_rowIndex`, it must be an integer at least 2 and unique **within its source group**, including quarantined/missing-ID rows.
- Allow the same physical row number across different groups. Do **not** require contiguous Party source positions: deleted/blank sheet rows may create gaps.
- Keep `_rowIndex` optional for older synthetic/authorized exports. When missing provenance makes two review records indistinguishable (same `reviewId`), fail closed rather than emit duplicate actionable IDs.
- Valid plans remain deterministic under JSON row reordering, do not mutate source input and retain explicit human-reviewed group links.
- Do not add matching, credentials, financial accounts, balance netting, D1 writes/migrations or public RPC. CLI must still redact sensitive input details.

## Alternatives
1. **Strict contiguous provenance:** rejected: the Party source may contain empty historical Sheet rows and the existing planner permits reordering.
2. **Ignore collisions:** rejected: could produce two mutually conflicting original records or duplicate review actions with one identifier.
3. **Per-sheet unique physical position + global review-ID uniqueness (selected):** narrow backward-compatible preflight; rejects ambiguous input before persistence while retaining valid gapped and position-free exports.

## Acceptance
- New focused tests first fail on the existing implementation (RED).
- Duplicate physical positions, including blank-ID rows, are rejected; cross-group positions and same-group gaps are accepted.
- Repeated, unpositioned missing-ID rows cannot produce duplicate review IDs.
- Existing approved Party-role link behavior and the complete Node suite remain green.
- `npm run verify:source`, `npm run build:frontend`, `git diff --check` pass.
- No SQL, deployment, source snapshot, Worker, RPC, or shared DB file changes.

**Sources:** `AGENTS.md`, `docs/M03_PARALLEL_READINESS.md`, `docs/architecture/ADR-007-unified-party-relationships.md`, `src/party/party-import-plan.js`.
