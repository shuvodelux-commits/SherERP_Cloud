# M02-safe — Validate Party roles against exact original source-group lineage

**Authority:** `AGENTS.md`, `docs/MIGRATION_PLAN.md`, ADR-007 and `src/party/legacy-contracts.js` pinned to `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Defect
The read-only `reconcilePartyImportReadback` rejects orphan Party roles and links, duplicate anchors and inconsistent reviewer proof, but does not check whether a proposed Party role is permitted or required by the source group that gave rise to that Party. A tampered plan with only a Customer legacy source link and an invented Supplier role can compare equal to a matching future-schema readback, even though the original planner could never have produced that role membership. Similarly, a Customer source link whose required Customer role is missing, or a made-up legacy source group, can escape existing graph checks when readback matches.

## Acceptance / source-derived policy
The import-readback preflight checks the **proposed plan only**, before trusting matching D1-shaped data:
- Only the five source groups in `partyLegacyContracts` are valid `sourceGroup` values; never rewrite or trim original `sourceId`.
- For a Party, every static-role group link mandates its corresponding role: CUSTOMERS→Customer, SUPPLIERS→Supplier, VENDORS→Vendor, EXPENSE_PAYEES→Payee. A role outside the union of the Party's linked groups' source-permitted roles is invalid. A Party linked solely to CUSTOMER cannot acquire Supplier/Payee/Finance roles without original source-group evidence.
- FINANCE_PERSONS source links permit Owner/Lender/Borrower, reflecting original FinanceModule roles. The planner always attaches at least one of these; the readback validator must require at least one of those when the Party has FINANCE_PERSONS links. Do **not** guess which exact finance roles were set by the original row without source snapshot.
- A multi-role Party formed from explicitly reviewed links of different source groups remains valid if those roles each have supporting source-group lineage. The review proof tuple and original anchor constraints from merged PRs remain intact.
- Bad plans generate only existing redacted `PLAN_LINKAGE_INVALID` with `identityRowsMatch:false` and `approvalEvidencePersistent:false`, even if readback exactly mirrors the tampered plan. Valid plans, current `APPROVAL_REF_NOT_PERSISTED` blocking and all account separations remain unchanged.

## Scope and safety
Only the offline readback reconciler, local Node contract, isolated Workerd/D1 tests and this doc/plan. No Party planner source rewrites, M03/M04, permissions, SQL schema, postings, cash, bank, cross-role netting, RPC, original GAS/UI, remote D1 or public Worker preview. Not a production import, reviewer authorization, or approval_ref migration. `PARALLEL-MODULE-READY=false`.
