# M02-safe — Verify Party/link status lineage in read-only D1 reconciliation

**Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Authority:** `AGENTS.md`, ADR-007, existing M02 Party planner and import-readback reconciler.

## Evidence and defect
The offline `planPartyImport` creates a Party status from its exact linked legacy source records: if any source link is `ACTIVE`, the Party is `ACTIVE`; otherwise all are `RETIRED` and the Party is `INACTIVE`. Individual legacy links only use `ACTIVE` / `RETIRED`. Proposed Party-role status uses `ACTIVE` / `INACTIVE`. Merged PRs #178–#210 protect reviewer proof, role lineage and summary counts, but do not reject an altered plan where all links are `RETIRED` and Party status is `ACTIVE`, or where a link/role has a fabricated status. A fabricated D1-shaped snapshot matching those tampered fields could report identity parity.

## Behavior
Add fail-closed *structural* status checks to the existing pure `validPlanLinkage`:
- Every proposed Party and role status belongs to `ACTIVE` / `INACTIVE`.
- Every proposed original source link status belongs to `ACTIVE` / `RETIRED`.
- A Party is `ACTIVE` **iff** it has at least one `ACTIVE` legacy link; a Party with only `RETIRED` links is `INACTIVE`.
- A Party without source-linked anchors remains invalid as before. Neither source order nor Party identity is inferred from names/phones.
- Preserve valid mixed active/inactive cross-role plans, including the frozen inactive Expense Payee. Do **not** infer each Finance role's individual status from group links, since the exact original Finance row's role list is unavailable to this readback; this change makes no new claim about source-finance role assignment.
- A tampered self-consistent plan and matching future-schema snapshot produce the existing fixed privacy-safe `PLAN_LINKAGE_INVALID` issue, with `identityRowsMatch:false` and `approvalEvidencePersistent:false`. The current M02 D1 schema still cannot persist `approval_ref`; no auth conclusion or production import authorization is implied.

## Out of scope
No source planner changes, no SQL/DB migrations, no source ID normalization, financial posting, role-account netting, original GAS/UI, M04 authenticated reviewer permission, Worker RPC, Cloudflare preview bindings or remote D1 reads/writes. Only the existing readback reconciler, its Node and Workerd/D1 tests, spec and plan. `PARALLEL-MODULE-READY=false`.
