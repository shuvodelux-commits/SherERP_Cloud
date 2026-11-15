# M02-P: actual D1 readback adapter design (2026-11-15)

## Goal
Wire the merged `reconcilePartyImportReadback` pure verifier (PR #86) to real Cloudflare D1 rows, **without exposing a public RPC**, changing shared SQL schema or production Worker, or modifying the original Mohim_ERP source. This is an internal adapter for migration checks, not permission to execute an import.

## Source/authority
- Target repo `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/M03_PARALLEL_READINESS.md`, `docs/MIGRATION_PLAN.md`, approved ADR-007.
- Original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
- Existing local schema `migrations/0002_party_identity.sql` and synthetic Party-import plan/batch from PR #59.
- Internal readback verifier `src/party/import-readback-reconciliation.js` from PR #86.

## Scope and ownership
Add `src/party/d1-identity-readback.js` exporting `reconcilePartyIdentityD1({DB,plan})`; extend only `tests/integration/m02-party-plan-workerd.spec.mjs` under the existing PR-only M02 synthetic local-D1 CI workflow; add this design and execution plan. **No edits** to `src/db/`, migrations, M04 auth, M03 posting kernel, `src/index.js`, `src/rpc`, legacy source, or workflows.

## Contract
1. Validate DB binding and call `DB.batch` **once** with exactly three *constant* prepared read-only SELECT statements for `parties`, `party_roles`, `party_legacy_links`, selecting relevant columns. No user-provided identifiers/table names, no full uncontrolled application query.
2. Consume only returned D1 `results` arrays; missing/malformed batches fail closed with a generic non-sensitive exception. No names/phones/IDs in error output or logs.
3. Forward D1-shaped results only to `reconcilePartyImportReadback({plan,readback})`; return **only** its counts/boolean/issue-code report. Never expose raw rows.
4. Current D1 migration **does not have `approval_ref`**, so a reviewed link must produce `APPROVAL_REF_NOT_PERSISTED` even though original IDs, statuses and reviewer/time match. This is the correct fail-closed result. Do not falsely mark production readiness.
5. Add RED/GREEN tests on **real local workerd/D1**: initial reviewed 4-Party/7-role/5-link import; unchanged database after read, known approval gap, precisely one SELECT-only batch; modified role and unexpected Party drift; sanitized read failures.
6. No real data, staging/production SQL, migrations, live user access, financial transactions, or automatic approvals.

## Accepted limitations
A single D1 `batch` supplies one transactionally grouped read; it is **not** an authenticated, signed export or full source-to-D1 provenance attestation. The adapter assumes an already reviewed import plan and authorized use in a local/offline migration gate. D1 row limits and pagination for production-scale snapshots need owner-reviewed follow-up. Approval reference schema persistence and M04 reviewer authorization remain blocking.
