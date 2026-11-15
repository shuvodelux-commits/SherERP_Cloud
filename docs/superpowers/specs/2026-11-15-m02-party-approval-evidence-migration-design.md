# M02-P / M03 — Authenticated Party Link Approval Evidence Design (PROPOSED)

**Decision status:** Proposal for owner and exclusive M03 schema owner review. **No executable schema or importer is authorized by this document.**
**Source of truth:** \`Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2\`; \`AGENTS.md\`, ADR-007, \`docs/WORKSTREAMS.md\`, Issue #163.
**Date:** 2026-11-15
**Owners:** M03-exclusive schema/migration integrator for D1, M04 auth owner for reviewer authority, M02-P for private source/evidence parity; business owner signs off on schema, migration and cutover.

## 1. Current facts and problem

- \`migrations/0002_party_identity.sql\` creates \`parties\`, \`party_roles\`, \`party_legacy_links\`, \`party_identity_review\`. Historical \`party_legacy_links\` has \`reviewed_by\` and \`reviewed_at\`, but **no \`approval_ref\`**. No Party accounts/journals exist; these are **not** in scope here.
- The pure \`planPartyImport\` builds one \`ORIGINAL_RECORD\` anchor per Party and \`HUMAN_VERIFIED\` links containing \`reviewedBy\`, \`reviewedAt\`, \`approvalRef\`. Multiple secondary members of one reviewed group legitimately share the **same approval reference**.
- The old \`reconcilePartyIdentityD1()\` intentionally omits \`approval_ref\` and fails reviewed links closed. \`reconcilePartyIdentityApprovalD1()\` is an explicit **read-only, future-schema** adapter proven against test-only local Workerd+D1 overlays (#161), not a production migrator or approval writer. \`reconcileReviewedPartyIdentityD1()\` also remains current-schema gated.
- \`party_identity_review\` tracks candidate review status and reviewer attribution; it does **not** currently prove that a server-authenticated principal consented to one exact multi-source group or that the D1 links persist one immutable decision.
- The current local gross checkpoint integration (#213) uses **ephemeral test-only tables** and is not the future Party money schema. No financial account merge, Cash/Bank transaction, reconciliation cutover or public importer is allowed as part of approval evidence.

## 2. Options considered

**A. Add only \`party_legacy_links.approval_ref\`.** Simple migration and replay comparisons, but a caller could supply arbitrary reviewer/ref text and two unrelated Parties could reuse a reference. A global unique constraint on link rows is *wrong*: one approved decision may legitimately cover more than one HUMAN_VERIFIED link.

**B. Add the nullable link column plus an immutable decision record (recommended, subject to review).** One decision key per approved *group*, reused by its secondary links; decision contains Party target, authenticated reviewer, UTC time and stable canonical source-set digest. SQL guards check that each new verified link agrees with a **confirmed** decision, and deny evidence mutation. This is an additional small table but avoids broken per-link uniqueness and provides an audit boundary.

**C. Rebuild all Party identity tables and review queue.** More invasive than the immediate proof gap and risks changing historical IDs/FKs. Not recommended.

**Proposed selection: B**, with SQL design owned exclusively by M03. This is an approval recommendation, not implementation consent.

## 3. Proposed data contract

After M03 design sign-off, prepare a separately reviewed **additive numbered migration** (suggested \`0003_party_approval_evidence.sql\`; number subject to exclusive owner coordination):

1. Add \`party_legacy_links.approval_ref TEXT\` as **nullable**. Existing rows stay unchanged; historical HUMAN_VERIFIED rows with a null reference stay **UNVERIFIED**. Do **not** backfill a guessed reference, infer proof from reviewer text or coerce phone/name matches. Check compatibility with current SQLite/D1 foreign-key and ALTER TABLE semantics in an actual local Workerd/D1 upgrade test before finalizing SQL.
2. Add a suggested STRICT \`party_link_review_decisions\` table with one **unique canonical approval_ref** per *decision*, \`party_id\` FK to \`parties\`, \`reviewer_id\` (authenticated actor), UTC \`reviewed_at\`, \`source_members_digest\` (full reviewed source group; SHA-256 of deterministic literal group/source IDs and physical row provenance), \`status='CONFIRMED'\`, UTC creation metadata, and a stable immutable decision/audit ID if owner policy requires one. No source name/phone or money in approval reference. Future tenant scoping must be evaluated; do not invent a tenant column without the approved tenancy model.
3. The digest input must contain the **entire reviewed set**, including the original anchor plus each human-verified member, sorted by exact \`(source_group, source_id, legacy_sheet_row)\`. The digest is not proof of authorization; the immutable decision and trusted reviewer identity supply that. Reordering source exports cannot change the digest; a changed ID/row/group must invalidate the old decision. No trimming or rewriting of original source IDs.
4. One decision may cover multiple \`HUMAN_VERIFIED\` link rows for the **same Party**; each carries the same \`approval_ref\`, \`reviewed_by\`, \`reviewed_at\`. Different decisions must have different approval refs. **Never create a global unique index on \`party_legacy_links.approval_ref\`.** A decision reference must not be reused for different Parties or unrelated reviewed source sets.
5. \`ORIGINAL_RECORD\` links require all of \`approval_ref\`, \`reviewed_by\`, \`reviewed_at\` to be null. The original source anchor remains a single immutable record and is not automatically a human approval.
6. SQL write constraints/triggers for **new** verified links should reject missing/canonical-invalid refs and refs whose confirmed decision does not match the link Party, reviewer, UTC timestamp or reviewed source set. Separate writes to a decision row must also require a trusted server-authenticated path. D1 triggers validate data consistency but **cannot authenticate the user**: that is M04's job.
7. SQL immutability constraints prevent changes to \`approval_ref\`, \`reviewed_by\`, \`reviewed_at\`, \`link_basis\`, the source identity/Party mapping and its bound physical provenance after insertion. Existing restrictive identity/delete triggers in \`0002\` must stay in force. Corrections use a reviewed append-only dispute/supersession workflow, not in-place mutation or deletion. Decide whether \`status\` updates are permitted only through an authorized route.
8. Existing historical HUMAN_VERIFIED links with missing proof remain readback-blocked. Their reconciliation requires an **explicit, individually authorized** legacy evidence review under a separate backfill procedure; never broadly declare them approved from historical text.

**Implementation detail requiring M03 review:** The final schema may use a decision FK on \`party_legacy_links.approval_ref\` or a fixed trigger lookup into the decision table; use whichever is proven by Workerd/SQLite tests without destructive table rebuild. An FK alone cannot verify reviewer/time/Party equivalence or membership digest; trusted atomic writer plus SQLite checks must supply those invariants.

## 4. Authenticated decision and write boundary (M04 + M03)

1. An application session is resolved **server-side** by M04; the actor is active, not revoked/disabled, and has an explicit reviewed capability such as \`party.identity.review.approve\`. This capability is unrelated to Customer/Supplier/Vendor/Owner/Lender/Borrower/Payee relationship roles. Never honor client-provided \`reviewedBy\`, \`approvalRef\`, \`status=CONFIRMED\` or \`isApproved\`.
2. Validate complete original Party export, literal source IDs and physical rows; check identity review queue state, selected candidate Party, legal ambiguity, and exact membership while the decision is fresh. A shared phone/name is only a suggestion and cannot be sufficient evidence.
3. Determine and record maker/approver separation and audit evidence policy (reason/reference, possible threshold or second approver) **before** final write implementation. A client-supplied timestamp is not trusted. Generate the immutable reference and UTC time from the authorized server action, not from untrusted request payload.
4. A single **atomic, replay-safe D1 operation** must commit the decision and related links together, validating current queue status and source version at the mutation boundary. Stale review, duplicate/competing approval, mismatched existing legacy link, conditional zero-row write or failure-injected SQL error must result in **no partially approved graph**. Replays return the prior committed result only for an exact matching idempotency key and same authorized decision; otherwise conflict.
5. Never expose decision rows, source IDs, phone/names or proof details through a public generic D1 read endpoint. Approved readback stays internal and returns **fixed-code counts**; strict one-batch evidence checks must not fallback from future-schema SELECTs to the old missing-column query and falsely signal approval.
6. An authorized actor may review relationships only, not silently post receivable/payable offsets, opening balances, cash/bank movements, loan/equity entries or settlements.

## 5. Proof required before any remote/staging schema apply

Run real ephemeral Workerd+D1 against **unchanged \`0001\` and \`0002\` migrations, then proposed \`0003\`** after review. Required acceptance matrix:

| Case | Expected outcome |
| --- | --- |
| Upgrade historical \`ORIGINAL_RECORD\` links | Link IDs, literal source keys/positions, Party IDs and statuses preserved; null approval reference |
| Upgrade historical \`HUMAN_VERIFIED\` with no proof | Rows retained but **UNVERIFIED** and readback fails closed; no mass backfill |
| Valid confirmed decision for reviewed group with 2+ secondary links | One decision ref shared by same Party's links; exact tuple and source-set digest; strict future-schema D1 readback matches |
| Same \`approval_ref\` on another Party or changed original set | Reject; no duplicate decision or automatic cross-role identity association |
| Missing ref/reviewer/timestamp, null on verified insert, proof on original anchor | Reject before persistence, no data change |
| Tamper reviewer, timestamp, ref, basis, original IDs or physical row | SQL UPDATE forbidden; strict readback reports mismatch |
| Unauthorized, disabled or stale session; forged client reviewer | Deny without creating decision/links; audit only authorized server actor |
| Two approvals racing, replayed request, stale reviewed snapshot | Exactly one valid result or conflict; no partial membership/stranded decision |
| Failure midway through decision+link write | Rollback entire operation; row counts/links/decisions unchanged |
| Seven roles on one reviewed Party | No duplicate or missing role; no current/historical per-account netting or money moves |
| Old schema / missing approval column | Explicit future readback fails closed; never downgrade to success |

**Test categories:** pure offline planner/role provenance; synthetic local real Workerd+D1 SQL migration, trigger, rollback and concurrent replay; M04 session/role authority on local D1; source-to-readback tuple parity; gross per-account reconciliation; M01 original Chromium print/mobile/navigation; Cloudflare secret-free PR preview safety. Don't label a test-only column overlay as an actual production migration.

## 6. Migration sequence, deployment and rollback gates

- **Gate A (owner):** Approve Option B or choose an alternative, reviewer capability/separation-of-duties policy, decision lifecycle, source-set digest protocol, historical unverified reconciliation policy and M03-exclusive file owner. Record explicit sign-off on Issue #163. **This document does not grant sign-off.**
- **Gate B (M03 TDD):** Add failing real local D1 tests first (RED) with the reviewed expected SQL contract, then add the smallest numbered migration and immutable constraints (GREEN). M04 implements independently reviewed actor/permission path with real local D1 authorization tests; keep importer feature flag OFF.
- **Gate C (staging by owner):** Complete full CI and independent gross Customer/Supplier/Vendor/Finance per-account parity. Backup staging D1 and test forward restore/time-travel/roll-forward procedure. Explicit owner authorization before any remote staging migration. Confirm existing link totals and old app compatibility; do not silently rewrite historical rows.
- **Gate D (production):** New authorization gate, approved import writer and readback must all pass concurrent/failure-injected actual local D1 tests, staged migration, original UI parity and accounting reconciliation. Separate written owner approval for production schema apply, cutover and fallback. No background deployments from this proposal.
- **Rollback:** For a **new** remote schema with emitted decisions, reverting a code PR cannot remove the columns safely. Prefer feature-flag OFF and forward-only corrective migration; use approved backup/Time Travel restoration only under maintenance/recovery plan. Never drop historical links/decisions or undo migrations blindly. Reverting this **documentation-only PR** requires no data action.

## 7. Questions for owner sign-off (blocking)

1. **Reviewer authority:** Which authenticated staff permission and maker-checker rule may confirm Party links? Must the same person who proposed a group be prohibited from approving it?
2. **Decision model:** Accept proposed one immutable decision per reviewed Party group with reusable \`approval_ref\` (recommended), or require a different legally auditable evidence model?
3. **Historic missing proof:** Should all currently unverified links remain blocked until an individual review (recommended)? What existing evidence can the reviewer attach to resolve each?
4. **Source digest:** Confirm exact source group/member/physical-row provenance digest contract; should human approval additionally bind to a captured full-export snapshot/version?
5. **M03 exclusive owner and rollout:** Name the schema file owner and approve *local test implementation only* first; separately authorize staging and production apply after evidence.

**Standing status:** \`PARALLEL-MODULE-READY=false\`. This is a proposal, NOT source-system modification, D1 migration, import permission, reviewer implementation, or financial posting authorization.
