# M02-safe — Source-linked static Party role status parity

**Authority:** `AGENTS.md`, ADR-007 Unified Party, frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `src/party/legacy-contracts.js`, and current `planPartyImport()`.

## Observed defect
The source-only M02 planner derives Party status from all original linked source records and role status from just the source records that supply that role. PR #225 already rejects an impossible overall Party status, but `validPlanLinkage` still allows an individual Customer, Supplier, Vendor, or Payee role to have `INACTIVE` when its legacy link is `ACTIVE`, or `ACTIVE` when all original links supplying that role are `RETIRED`. A mirrored future-D1-shaped readback of such an altered plan can falsely report `identityRowsMatch:true`.

## Accepted invariant
For the statically defined source groups in `partyLegacyContracts` — CUSTOMERS→Customer, SUPPLIERS→Supplier, VENDORS→Vendor, EXPENSE_PAYEES→Payee — require each proposed role status to equal `ACTIVE` if any link from that group to the same Party is `ACTIVE`, otherwise `INACTIVE`. A Party approved across multiple groups can be `ACTIVE` overall even while its Customer role is `INACTIVE` and its Supplier role is `ACTIVE`. Multiple links from the same group use any-active semantics. Preserve original role-account separation, no account offsets or name/phone linking. Finance (Owner/Lender/Borrower) roles are intentionally excluded from status inference because a readback plan does not contain the exact role assignments of each original FINANCE_PERSONS row.

Do not change the existing planner, role types, source ID bytes, SQL/schema, Cash/Bank/Finance posting, M04 authentication or UI. Use existing redacted `PLAN_LINKAGE_INVALID` for tampered plans with `identityRowsMatch:false` and `approvalEvidencePersistent:false`, including where proposed and future-D1-shaped readback data agree. Legitimate plans, including an inactive Payee and a mixed active Supplier/inactive Customer Party, must reconcile successfully.

## Real-D1 constraint
The existing schema cannot persist `approval_ref`, so real local Workerd/D1 readback continues to report `APPROVAL_REF_NOT_PERSISTED` for reviewed links. The test must additionally flag unsupported static role status without D1 modifications. These checks do not authenticate review evidence or authorize production import. `PARALLEL-MODULE-READY=false`.
