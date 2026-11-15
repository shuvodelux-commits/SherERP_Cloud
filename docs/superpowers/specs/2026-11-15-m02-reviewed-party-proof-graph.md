# M02-safe — Validate reviewed Party group evidence in offline D1 parity

**Authority:** `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, ADR-007. Original source is frozen at `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Existing behavior and gap
Merged M02 PR #178 rejects an impossible Party graph with missing/multiple original anchors and orphan roles/links. `planPartyImport` already makes each human-approved group from a single evidence tuple (`reviewedBy`, `reviewedAt`, `approvalRef`) and assigns **one Party** to that group. Distinct approved groups require distinct approval references. The read-only `reconcilePartyImportReadback` currently checks only nonempty human-review claims; an altered plan and matching future-schema readback may reuse an approval reference across independent Parties, assign inconsistent proof metadata within one merged Party, or change `summary.reviewedGroups`, yet be labeled `identityRowsMatch:true`.

## Decision
Extend the existing pure `validPlanLinkage(plan)` preflight without a new module or API. Enforce:
1. A given `approvalRef` in `HUMAN_VERIFIED` links belongs to exactly **one** proposed Party. Multiple reviewed members of that same Party **may and must** share one approval reference.
2. All reviewed links of the same Party share the exact same `reviewedBy`, `reviewedAt`, and `approvalRef` tuple. Do not normalize or alter original source IDs, names, phones or finance account associations.
3. The number of distinct Parties with reviewed links equals `plan.summary.reviewedGroups`. A genuine zero-review proposal must remain valid.
4. Invalid self-consistent plans produce one privacy-safe `PLAN_LINKAGE_INVALID` diagnostic, with `identityRowsMatch:false` and `approvalEvidencePersistent:false`. The legacy D1 table still lacks approval reference persistence, so actual reviewed readback must continue reporting `APPROVAL_REF_NOT_PERSISTED`. All evidence in offline plans is **unverified reviewer attribution**, not an M04 authorization statement.

Tests cover two separate reviewed groups sharing a forged ref, a three-member reviewed Party whose proof members disagree, a tampered reviewed group count, and valid multi-member shared evidence. Actual Workerd/D1 tests tamper only the read-only in-memory plan after synthetic import, proving no D1 mutation or public route.

## Boundaries
Only `src/party/import-readback-reconciliation.js`, existing Node and actual Workerd/D1 M02 tests, and design/plan docs. No `src/db`, `migrations`, M04 auth, legacy source changes, Cash/Bank/account postings, remote D1 writes, Worker RPC or UI. The further production approval_ref schema/auth cutover requires separate owner review and remains blocked; `PARALLEL-MODULE-READY=false`.
