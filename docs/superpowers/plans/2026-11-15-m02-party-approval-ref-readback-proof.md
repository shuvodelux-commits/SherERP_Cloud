# M02-P: future approval_ref readback proves persisted human-review provenance (isolated local D1)

**2026-11-15.** Owner's `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, `docs/M03_PARALLEL_READINESS.md`, ADR-007 and frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` govern. This is the **M02-safe offline verification lane**, not the exclusively M03-owned SQL migration lane.

## Verified gap and objective

The approved offline Party import plan retains `approvalRef` on each `HUMAN_VERIFIED` legacy link, and `reconcilePartyImportReadback` already enforces reviewer/UTC date/approval reference parity. However production migration `migrations/0002_party_identity.sql` contains no `party_legacy_links.approval_ref` field; current `reconcilePartyIdentityD1` purposely omits that column and must continue to report `APPROVAL_REF_NOT_PERSISTED`. It must not silently start approving joins.

Add **one explicit, separate internal readback opt-in** `reconcilePartyIdentityApprovalD1({DB,plan})` that requires a future schema physically exposing `approval_ref`. Reuse existing redacted `reconcilePartyImportReadback` and the three strict, prepared D1 SELECT-only batch result guards. Do not dynamically inspect arbitrary table names, auto-fallback to the current unversioned schema, accept `success=1` or return raw identity records. Reject with the same generic redacted error on missing column/malformed batch/SQL failure. A missing, altered or empty persisted approval reference must still block identity parity; complete proven evidence can pass **readback**, not authorize an import or merge automatically.

## Superpowers TDD

1. RED: commit this plan and **new** `tests/integration/m02-party-approval-evidence-workerd.spec.mjs` before production code. It exercises actual local Workerd+D1 via existing test-only Worker and frozen synthetic Party rows; first proves schema `0002` does **not** expose `approval_ref`; then executes a **test-only, in-memory-local** `ALTER TABLE party_legacy_links ADD COLUMN approval_ref TEXT` (NOT under `migrations/`), imports synthetic proposal into local D1, confirms pending evidence fails closed, fills only synthetic data with matching proof and confirms strict comparison. Also test changed ref, reviewer, D1 status, missing/ambiguous batch envelope, no writes, no leaks or RPC. Wire new spec into existing M02 Party local Workerd workflow. GitHub job must fail at RED because named export is absent.
2. GREEN: change only `src/party/d1-identity-readback.js` to provide separate explicit future-schema readback function using existing source comparison and existing strict read handler. Keep legacy `reconcilePartyIdentityD1` call and three SELECTs unchanged, so all existing missing-column tests continue to fail closed. No new dependency or SQL abstraction.
3. Verify exact-head GitHub Foundation, M02 Party real local Workerd+D1 (both source schema and overlay), M02 Party import rehearsal, M03 real Workerd/D1, M04 auth, preserved M01 Chromium and Cloudflare preview safety.

## Change scope / ownership

**Exactly four scoped files:** this plan (new); new isolated local Workerd/D1 test; `src/party/d1-identity-readback.js` (one existing M02 read-only adapter, not schema); `.github/workflows/m02-party-workerd.yml` (append spec to established local-only test command). No actual `migrations/`, `src/db`, M03 posting kernel, M04 session or reviewer-authority code, original GAS/Sheets/UI, production Worker RPC, D1 binding/config, Cloudflare deployment or staging/production data. No automatic identity links, customer/supplier/vendor/finance account merger, cash/bank writes or cross-role settlement. CI local D1 is test-only, no remote writes. Rollback: revert PR; no data recovery.

## Remaining release gate

This is **NOT** approval_ref persistence in deployed D1. M03's designated single schema owner must separately approve/version/test the actual `approval_ref` migration and writer under M04 authenticated reviewer authority; historical `HUMAN_VERIFIED` rows with missing provenance must be reviewed/reconciled, never silently backfilled. Source and gross separate Party balances must reconcile before any import. `PARALLEL-MODULE-READY=false`.
