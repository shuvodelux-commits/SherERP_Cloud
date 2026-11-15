# M02-safe — Fail closed on internally invalid Party identity proposal graphs

**Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `AGENTS.md`, `docs/MIGRATION_PLAN.md`, ADR-007.

## Problem and source contract
The offline `reconcilePartyImportReadback({plan,readback})` checks that supplied D1-shaped rows equal an import proposal and that aggregate counts match. If a corrupted import proposal assigns a role or source link to an absent Party ID, or marks multiple source records on one Party as `ORIGINAL_RECORD` without reviewed cross-source lineage, and the supplied snapshot mirrors that corrupted plan, the verifier may return `identityRowsMatch:true`. A matching snapshot must not by itself certify an internally contradictory identity plan.

Important source invariant discovered during PR #175: literal legacy source IDs, even with padding, are authoritative and distinct. They must NOT be normalized, merged, or quarantined solely because `trim()` matches. This patch does not change the import planner or source IDs.

## Decision / acceptance
Before declaring readback identity parity, validate the internally proposed identity graph **without using names, phone numbers or whitespace-normalized source IDs**:
- Every `party_roles.partyId` and `party_legacy_links.partyId` references a declared proposed Party.
- Every declared proposed Party has **exactly one** `ORIGINAL_RECORD` anchor from the source lineage, regardless of how many additional `HUMAN_VERIFIED` links it has. Multiple original anchors or no anchor fail closed.
- Every `HUMAN_VERIFIED` source link has nonempty `reviewedBy`, `reviewedAt` and `approvalRef` claims. These are untrusted documentary claims, **not** proof of M04 staff permissions; existing schema still lacks approval-ref persistence.
- Never rewrite input plan or readback. Report one fixed-vocabulary, privacy-safe `PLAN_LINKAGE_INVALID` issue on the `plan` table and mark `identityRowsMatch:false`, `approvalEvidencePersistent:false` for an internally invalid plan. Do not include Party IDs, reviewer IDs, names, phones, balances or raw source values in the report.

Pure readback test supplies an intentionally self-consistent malformed plan and snapshot, which must be rejected even when all table counts and rows match. Real local Workerd/D1 test uses a valid persisted synthetic Party dataset and a tampered in-memory proposed plan to require the same diagnostic, without any additional D1 SQL writes. Existing genuine plans and the known `APPROVAL_REF_NOT_PERSISTED` blocker continue unchanged.

## Boundaries
Only `src/party/import-readback-reconciliation.js`, existing Node/Workerd Party import regression files, spec and plan. No `src/db`, `migrations`, M04 auth, original GAS/HTML, cash/bank/ledger, review approval, Cloudflare production/staging migration or public RPC. Other M02 open PRs address distinct money/approval evidence files. `PARALLEL-MODULE-READY=false`.
