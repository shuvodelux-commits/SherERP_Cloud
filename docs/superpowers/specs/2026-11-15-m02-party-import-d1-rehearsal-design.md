# M02-P3 Synthetic Party Import → Local D1 Rehearsal Design (2026-11-15)

## Goal and constraints
Proof that the **existing** approved-offline `planPartyImport` proposal can be materialized in actual local Cloudflare D1, preserving original source group/ID/row, roles, statuses, and reviewer evidence. This is deliberately **test-only**, not the production importer, no new schemas, endpoints, secrets, user data, remote D1, or production application writes.

Depends on `AGENTS.md`, approved ADR-007, `migrations/0002_party_identity.sql`, `src/party/party-import-plan.js`, original Mohim_ERP pinned `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Source contract and decisions
- Input five frozen source master group shapes, generated **synthetic** fixtures only.
- Run unchanged `planPartyImport(sourceRows,approvedGroups)`.
- Reject a preflight with quarantined rows or pending review candidates; do **not** write even the unambiguous subset. A shared name/phone is a review candidate, never an identity approval.
- Reviewed links in the fixture are **unverified human review claims**, not server-validated M04 authorization. Do not use this proof for production data.
- Deterministic write ordering: all Party rows, then role rows, then per-Party `ORIGINAL_RECORD` first and `HUMAN_VERIFIED` second. Avoid depending on sorted source-group order for the D1 cross-source verification trigger. All statements passed as **one D1 batch**, a single atomic transaction only for this bounded synthetic fixture.
- Preserve `source_group`, `source_id`, `legacy_sheet_row`, `status`, original role statuses, `reviewed_by`, `reviewed_at`; reject duplicates/replays at SQL unique constraints, never overwrite or net.
- **Known schema gap:** `approvalRef` exists in the dry-run plan, but `party_legacy_links` currently has no approval-reference column. Do not misrepresent this as complete approval evidence. Real import is **blocked pending an owner-reviewed schema/authorization solution**.
- No user-facing data in test logs. Synthetic data only. Test-only compiler is `tests/fixtures/m02-party-plan-batch.mjs`, not used by Worker production code.
- Dedicated local harness `wrangler.m02-plan-test.jsonc` with a synthetic D1 identifier, test-only Worker that responds 404 to all requests; migrations unchanged.
- Local-only CI workflow `.github/workflows/m02-plan-local-d1.yml` uses `pull_request` trigger, Node 22, Wrangler pinned 4.161.0, no deployment, no D1 cloud writes or secrets.

## Test plan (TDD)
1. RED on absent compiler/harness.
2. Unit: unreviewed same-name/phone, missing ID/duplicate quarantine, invalid approval evidence cannot compile any writes.
3. Real D1: clean reviewed 5-row source → 4 distinct Parties, 7 separate roles, 5 exact legacy links, no identity-review rows, no financial accounts, original status and sheet row preserved.
4. Real D1: repeated identical import fails *without any additional Party/role/link writes*. The test is rejection safety, **not a production idempotency protocol**.
5. Real D1: failed second statement in a prepared batch rolls back an earlier synthetic insert; distinct row and no side effects.
6. Deterministic unmerged identity plan with two distinct same-phone parties is blocked when human review remains open. No phone/name merge.
7. Source immutability and readback (D1 projection), no automatic cross-role account offset, no Cash/Bank table.
8. Full Node test/source integrity/frontend build, local workerd suite, GitHub CI. PR is a strictly isolated test addition; no backend feature toggle or `PARALLEL-MODULE-READY` update.

## Explicit limitations
The real ERP identity import still needs authenticated reviewer decisions, import staging/recovery process, batch-size/resume journal, full source-id reconciliation and approvalRef persistence. Financial accounts/transactions are *not migrated*, M03/M04/transaction kernel gates remain. Never call a test-only batch compiler from production.