# M02-P Identity import post-write readback reconciliation — design (2026-11-15)

**Workstream:** M02-P, independent Party identity verification lane.
**Source:** pinned Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Dependencies:** `AGENTS.md`, ADR-007, `src/party/party-import-plan.js`, `migrations/0002_party_identity.sql`, approved PR #59.
**Owner/impact:** `src/party/import-readback-reconciliation.js` and isolated tests; no `src/db`, SQL migration, Worker/RPC/auth, source UI or environment edits.

## Problem
A synthetic local D1 rehearsal proves constraints but does not compare *every* staged Party/role/link value to the original deterministic proposal. The approved plan carries `approvalRef`, while the existing `party_legacy_links` D1 schema has no persisted approval reference. Counting inserted rows does not establish identity parity or durable human-review evidence.

## Minimal contract
`reconcilePartyImportReadback({plan,readback})` is a pure, no-write comparison. `readback` contains fixed D1-shaped arrays `parties`, `party_roles`, `party_legacy_links`. It compares rows by stable Party ID, (Party ID,role), and (source group,source ID), **not names/phones**. Compare name/phone only as data fields, never merge candidates. Check exact role and link memberships, identity type/status, original physical sheet row, link status/basis, reviewer identity/time, and persisted approval reference.

Return deterministic **redacted** issue objects with code/table/field only: never echo names, phone numbers, original IDs, amounts, secrets or raw D1 rows. Report expected/actual row counts, `identityRowsMatch`, `approvalEvidencePersistent`. A missing `approval_ref` on a HUMAN_VERIFIED link is an explicit blocking `APPROVAL_REF_NOT_PERSISTED`; missing reference on ORIGINAL_RECORD (expected null) is benign. Extra or duplicate rows, missing rows, changed source ID even with equal counts, inexact values, quarantined/ambiguous source and tampered plan counts fail closed.

The current schema necessarily fails approval-reference parity for reviewed joins. **Do not change the schema in this PR**; the M03/M02 schema owner must review a versioned migration and M04-authenticated reviewer evidence later. `identityRowsMatch` is not `readyForProduction` and never authorizes a write/cutover or settlement.

## Test-first acceptance
1. Write tests importing the missing new verifier, observe RED (module not found).
2. Clean synthetic readback with explicit `approval_ref` passes 1:1; array order does not matter.
3. Current schema's missing `approval_ref` blocks reviewed joins without leaking reviewer/phone.
4. Missing/extra source ID, duplicate role/link, changed physical row, role/status/reviewer/name/phone mismatch block even when row counts align.
5. Pending review and quarantined rows independently block parity; malformed payload fails closed.
6. Original plans and readback remain unmodified. No SQL, auth, Worker, CSS, source, financial ledger or cash/bank write effects.
7. Run full `npm test`, source pin verification, preserved frontend build and GitHub Actions; scoped PR review before merging.

## Limitations
This verifier takes supplied readback; it is not a D1 query adapter, authenticated approval workflow, production importer, integrity attestation of live data, or transaction/money reconciliation. Any consumer must obtain an authoritative consistent D1 snapshot and authenticate review evidence separately.
