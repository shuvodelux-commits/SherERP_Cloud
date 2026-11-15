# M02-P — Persisted Human-Reviewed Party Link Binding

**Authority:** `AGENTS.md`, owner-approved `docs/architecture/ADR-007-unified-party-relationships.md`, `docs/WORKSTREAMS.md`, frozen source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Defect

The offline readback validator `reconcilePartyImportReadback({plan,readback})` sets `approvalEvidencePersistent=false` when a human-reviewed link's `link_basis`, `reviewed_by`, `reviewed_at` or `approval_ref` differs. But if D1 retains those four strings while its human-reviewed link's `party_id` points to another Party (or its `legacy_sheet_row` identifies a different source row), it reports a `FIELD_MISMATCH` and `identityRowsMatch:false` **while still asserting `approvalEvidencePersistent:true`**. Human review authorizes this particular legacy source's link to this particular Party and source-row provenance, not just a detached proof tuple.

## Decision

When an expected `HUMAN_VERIFIED` link is found by its preserved `(source_group,source_id)`, any discrepancy in `party_id` or `legacy_sheet_row` must also set `approvalEvidencePersistent=false`. Retain the existing fixed-vocabulary `FIELD_MISMATCH` diagnostic and `identityRowsMatch:false`; do not add source IDs or proof data to reports. Keep `status` orthogonal to review evidence (e.g. records may subsequently be retired); mismatches on unreviewed `ORIGINAL_RECORD` links do not assert loss of *human approval* evidence. Keep existing approvalRef persistence checks as-is.

## Acceptance / safety

- Human-reviewed `party_id` altered with exact evidence tuple retained ⇒ no positive approval-evidence persistence claim.
- Human-reviewed `legacy_sheet_row` altered with exact evidence tuple retained ⇒ no positive claim.
- Genuine exact synthetic readback ⇒ both flags true.
- Unreviewed link identity mismatch ⇒ `identityRowsMatch:false` but human evidence flag unchanged.
- Reviewed-link status change ⇒ identity mismatch but review proof remains separate.
- Report redacts all source identifiers, Party IDs, names, phones, reviewer IDs and approval refs; source and readback unmodified.

Only `src/party/import-readback-reconciliation.js`, dedicated new Node test, plan and spec. No D1 writes, SQL/schema, `src/db`, `src/rpc`, auth, original source UI/GAS, Cloudflare config or finance; no public approval activation. This is an **offline evidence diagnostic only**. `PARALLEL-MODULE-READY=false`. Rollback is isolated PR revert.
