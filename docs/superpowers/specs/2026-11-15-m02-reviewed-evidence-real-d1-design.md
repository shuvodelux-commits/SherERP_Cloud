# M02-P — Internal, Source-Gated Real Local D1 Party Evidence Readback

Date: 2026-11-15. Frozen source: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Authority: `AGENTS.md`, approved ADR-007, `docs/WORKSTREAMS.md`, and `docs/M03_PARALLEL_READINESS.md`.

## Existing proof and gap

Merged #162 composes two original-source export validations and identity evidence; merged #164 adds a readback evidence gate that consumes *supplied* D1-shaped rows. Existing `src/party/d1-identity-readback.js` reads a real D1 batch, but only knows a supplied plan, not whether the plan's source export and human-review claim are complete/unchanged. Consequently there is no single internal path that gates actual D1 reads on validated reviewed exports.

PR #161 independently owns **future `approval_ref`-aware readback using a test-only ALTER TABLE**. PR #174 owns human-link binding proof in `import-readback-reconciliation.js`. Do not edit or duplicate those files or schemas.

## Design

Introduce `reconcileReviewedPartyIdentityD1({DB,reviewedRows,reviewedHeaders,candidateRows,candidateHeaders,approvedGroups})` in new `src/party/d1-reviewed-import-evidence.js`:
1. Reuse `validatePartyImportCandidate` first and **return a redacted skipped report** with `readbackChecked:false`, `readbackMatches:null`, `approvalEvidencePersistent:null` and `counts.readback:null` if either export/header/identity review is incomplete. Do not touch `DB.prepare` or `DB.batch` on that path, even when DB is missing/throws.
2. For valid reviewed and candidate original exports, require a D1 binding with `prepare` and `batch`. Execute **exactly one** D1 `DB.batch` with three fixed `SELECT` queries from the **existing 0002 schema**: `parties`, `party_roles`, `party_legacy_links`. The current schema does NOT have `approval_ref`; never pretend it does, infer it, or dynamically test for columns. Result envelopes must have three entries, each with `success===true` and `results` array. No user-supplied table names, filters, account IDs or SQL; no writes.
3. Pass the resulting in-memory D1-shaped readback through the existing `reconcileReviewedPartyImport` gate (#164) to generate **fixed vocabulary redacted** evidence. Because current D1 0002 cannot store `approval_ref`, a `HUMAN_VERIFIED` cross-source link must be reported as `APPROVAL_REF_NOT_PERSISTED`, and `offlineEvidenceMatches` must remain `false`. Non-merged original records (where no human proof is required) may pass on exact parity; no auto-merge.
4. Any D1 failure, malformed batch, or unexpected source exception becomes fixed `Party reviewed D1 evidence unavailable` without leaking SQL, names, phone, raw identity IDs, finance figures, approvals or source row contents. Return no raw D1 rows.
5. Prove the code with a **new independent PR-only local Workerd/D1 regression** using the existing non-deployable `wrangler.m02-plan-test.jsonc` Worker config, actual existing two migrations, synthetic Party import fixture and a dedicated new GitHub Action workflow. Test real D1 readback, exact SQL/read count, no mutation, original-source header and balance drift skip-before-DB, malformed D1 results, error redaction, nonexposed HTTP endpoints. The test setup may write to **isolated ephemeral local D1 only**; the production helper is read-only.

## Non-goals and safety

No schema, migration, tenant auth, actual identity approval, public Worker/RPC, staging or production Cloudflare D1, settlement, cash/bank, stock, source UI/GAS, account netting or posting. Reuse existing source checks and D1 driver; KISS. This is a new internal helper, NOT release/import/cutover approval. `PARALLEL-MODULE-READY=false` remains. Five new files only: spec, plan, module, real-Workerd test and isolated PR-only workflow; no modifications to existing files. Revert PR for rollback (no persistent data migration).
