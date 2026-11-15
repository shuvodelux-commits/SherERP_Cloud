# M02-P / M03 — Party Approval Evidence: Owner-Gated Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans, test-driven-development and verification-before-completion to implement only the owner-approved stages below. RED tests must actually fail before production code, and CI evidence must be tied to the exact GitHub commit.

**Goal:** After explicit owner approval, persist one immutable authenticated Party identity approval per reviewed group in Cloudflare D1, with strict legacy upgrade and readback that never upgrades historical unverified links into approved links.

**Architecture:** Continue source-pinned M02 private planner/readback, add an M03-exclusive additive decision record and nullable link approval reference, then bind the approved group to a trusted M04 reviewer session in one atomic D1 operation. A group decision may legitimately be referenced by multiple HUMAN_VERIFIED source links; don't put a unique constraint on every link's approval_ref. Leave the old data and the current Worker/frontend untouched until verified and approved.

**Tech stack:** JavaScript ESM, Cloudflare Workers + Wrangler local Workerd+D1, SQLite STRICT + triggers, native node:test, original frontend Chromium, GitHub Actions.

**Spec:** \`docs/superpowers/specs/2026-11-15-m02-party-approval-evidence-migration-design.md\`. Issue #163; ADR-007; \`AGENTS.md\`. Original \`Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2\`.

## Global constraints

- **This plan is NOT authorization** to add a migration, run staging/production D1, enable import or change shared files. M03 schema owner and business owner must explicitly approve the proposed decision model and implementation branch first.
- Preserve \`migrations/0001_core_catalog.sql\` and \`migrations/0002_party_identity.sql\`; only a *new* reviewed numbered migration may extend them. No destructive rebuild or blanket backfill of historical links.
- M04 reviewer identity must come from validated server session/permission, never client \`reviewedBy\`, \`approvalRef\` or Party roles.
- Original Party source IDs and sheet-row positions stay byte-exact; one approval can serve multiple secondary links for one group. Every original \`ORIGINAL_RECORD\` anchor has null review proof.
- The production Party importer remains DISABLED; never invent Party account/journal schemas or aggregate/net obligations during identity migration.
- No remote D1 writes, production deployments or automatic schema apply as a side effect of test/PR CI. The Cloudflare PR preview is secret-free.

## Task 0 — decision and exclusive ownership (must happen first)

**Deliverable:** Owner-reviewed design with recorded decisions under Issue #163 and single branch owner for shared schema.

- [ ] Confirm approval decision model: recommended one immutable decision per reviewed group, shared reference for secondary links.
- [ ] Confirm M04 permission, maker-checker/threshold, immutable reviewer proof, dispute policy, timestamp source and historical missing-reference review policy.
- [ ] Confirm literal source-set digest canonicalization and whether approval binds to a frozen full-export version.
- [ ] Assign one M03 integrator for \`migrations/**\` and \`src/db/**\`; coordinate with M04 authentication owner and M02 readback owner.
- [ ] **Stop until explicit approval.** No SQL, public route or remote D1 actions are part of this design PR.

## Task 1 — failing local D1 additive-upgrade and integrity tests (RED)

**Owner:** M03 exclusive schema owner, after Task 0.
**Create/modify:** \`tests/integration/m02-party-approval-migration-workerd.spec.mjs\` (name provisional); test-only synthetic fixtures and isolated workflow if needed.
**Implement only after RED:** \`migrations/0003_party_approval_evidence.sql\` (name/number reserved by M03 after coordination).

- [ ] RED: Test Workerd+D1 applying unchanged 0001 and 0002 plus a yet-nonexistent 0003. Expected fail specifically on missing approval schema, not on unavailable test runner/dependencies.
- [ ] RED: Seed synthetic historical ORIGINAL_RECORD and HUMAN_VERIFIED with no approval_ref. Assert row counts, source group/ID/physical provenance and Party FKs preserved after upgrade, and historical HUMAN_VERIFIED remains unverified.
- [ ] RED: Accept new confirmed decision for one Party group covering two additional source links; same approval_ref reused in link rows, unique once in decisions. Reject global link uniqueness and decision-ref reuse across different Parties.
- [ ] RED: Reject new verified links with null/missing/canonical-invalid reference or mismatched Party/reviewer/UTC timestamp. ORIGINAL_RECORD cannot receive proof.
- [ ] RED: Reject update/delete of stored decision or link proof; cannot modify source key, anchor or physical provenance through approval workflow.
- [ ] GREEN: After seeing expected RED, write the minimal additive STRICT table/nullable column and defensive triggers in the numbered migration. Test all cases against ephemeral real Workerd/D1; do **not** apply remotely.
- [ ] GREEN: Rerun upgrade twice in disposable DB via documented migration runner and prove clean apply/idempotence according to migration framework, without silently rerunning raw SQL incorrectly. Preserve 0002 compatibility and original table counts.

## Task 2 — server-authorized review decision boundary (separate M04/M03 review)

**Owner:** M04 authenticated review authority + M03 transaction kernel integrator.
**Files:** owner-selected private M04 auth policy and M03 writer only; **no speculative public RPC**.

- [ ] RED: Permissionless, forged, disabled or stale session cannot confirm a decision; a Party relationship role grants no staff approval permission.
- [ ] RED: Client-provided actor/timestamp/approvalRef is never accepted as the trusted review identity. Exact full source set and queue status must still match the approved snapshot at write time.
- [ ] RED: Competing reviewers, repeated idempotency key with altered source group, concurrent link insert and failure-injected second write cannot leave any partial approved graph; conditional zero-row update is conflict, not success.
- [ ] GREEN: Implement minimal M04 permission+actor resolution and M03 **single atomic** conditional writer, generating approval reference/UTC time server-side and binding the decision and all linked rows. Do not add UI until separately authorized.
- [ ] Confirm no Cash/Bank/bookkeeping, historical opening, stock, sales or loan/owner equity writes.

## Task 3 — strict readback and gross-account parity (GREEN only after Tasks 1–2)

**Owner:** M02-P adapter with M03 review, plus M08 financial-account contract owner where applicable.
**Current adapters:** \`reconcilePartyIdentityApprovalD1\` (opt-in future schema) and \`reconcilePartyIdentityD1\` (legacy schema, must remain fail-closed).

- [ ] RED tests: Missing approval_ref column or mismatched decision/review tuple cannot become \`approvalEvidencePersistent=true\`; old schema must not silently fallback or report green.
- [ ] RED tests: Invalid source-set digest, reused cross-Party reference, tampered review date/actor, omitted anchor, missing second member, stale reviewer session all fail closed with fixed-code redacted diagnostics.
- [ ] GREEN: Route internal authenticated review readback explicitly through the approved future-schema adapter; no PII-bearing readback response. Keep old adapter and review queue semantics fail-closed.
- [ ] Run synthetic separate **gross** per-account parity before any proposed balance migration: Customer AR/advance, Supplier AP/advance, Vendor payable/receivable, Owner equity/drawings, Lender loan payable and Borrower loan receivable. Payee is not an automatic liability. No cross-role netting.

## Task 4 — CI, release evidence and owner-approved cutover (not automatic)

- [ ] Exact-head GitHub Foundation, original GAS source pin/build, real local M02 Party Workerd/D1, M03 Workerd/D1, M04 auth Workerd/D1, M01 Chromium and Cloudflare PR safety workflows all succeed; report exact tests and failed/skipped jobs without guessing.
- [ ] Source mapping audit: frozen IDs, source row positions, historical links, review queue records and source counts identical before/after additive migration except **explicit authorized new review data**.
- [ ] Test real local concurrency, replay, rollback, crash recovery, missing column, current 0002 backward compatibility and malformed stored proof, with zero production/remote database mutation.
- [ ] Obtain explicit owner permission and backup the remote **staging** D1 before any separately scheduled apply; verify forward recovery and data parity after upgrade. No migration automatically deployed from a PR preview.
- [ ] Require independent owner signoff for production migration/cutover after reconciliation; keep importer feature flag OFF and \`PARALLEL-MODULE-READY=false\` until M02/M03/M04 and shared posting gates are evidenced.
- [ ] Plan rollback as feature flag OFF + forward-only fix or authorized restore from backup/Time Travel, not casual DROP COLUMN/table. Do not delete/overwrite historical evidence.

## Review focus

1. A reviewed 3-member Party group stores one approval decision and two HUMAN_VERIFIED links sharing that decision, without violating FK/uniqueness.
2. M04-authenticated actor and immutable UTC time are authoritative; client values cannot self-approve.
3. Existing historical human links with missing approval evidence remain quarantined after an additive upgrade, without guessed approvals.
4. No duplicate/replay/competing review can create half a decision or reassign a source ID between Parties.
5. Original source and money semantics remain separate, without netting, Cash/Bank movement, auth-role confusion, or premature production import.

**Rollback of this documentation-only plan:** revert its PR; no SQL/schema/Worker/database has been changed.
