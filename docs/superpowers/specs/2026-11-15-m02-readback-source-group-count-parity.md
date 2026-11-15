# M02-safe — Reconcile original source-group counts in offline Party D1 readback

**Authority:** AGENTS.md, ADR-007, `src/party/party-import-plan.js`, and frozen Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Verified defect
The original-source planner constructs `summary.sourceGroups` with exactly five distinct `partyLegacyContracts` groups, each recording the source array's row count, and a total `summary.sourceRows`. The current offline `reconcilePartyImportReadback` checks total rows, quarantined rows, proposed entities and role memberships, but does not check `summary.sourceGroups`. A tampered summary can present unknown or duplicate groups, missing group entries, unsafe/fractional counts, a row count below the number of retained links in the same group, or a total breakdown different from `sourceRows`. A matching future-schema D1 snapshot can report identity parity despite such internally impossible source inventory.

## Bounded contract
A proposed offline Party plan must have one and only one source-group entry for each of the five pinned legacy Party source groups (CUSTOMERS, SUPPLIERS, VENDORS, FINANCE_PERSONS, EXPENSE_PAYEES). Ordering of entries is not material. Each `rows` count is a nonnegative JavaScript safe integer, never less than `plan.links` count for that exact source group. The safe sum of all group `rows` must equal `summary.sourceRows`. Preserve the existing total-row = retained links + quarantined rows check, and continue to permit source groups with zero records and positive quarantines without inventing which group a quarantined row belongs to.

Any violation adds the existing privacy-safe `PLAN_COUNT_MISMATCH` diagnostic with `table:'plan'`, preventing `identityRowsMatch:true` even when the future-schema D1-shaped snapshot mirrors every fabricated plan value. Retain the existing independent `approvalEvidencePersistent` semantics: it only describes reviewer-proof persistence, not overall import authorization. Neither raw source values nor row numbers are returned in issues.

## Safety boundary
Pure M02 plan/readback count verification only; no source import, name/phone coalescing, financial role netting, SQL, schema, Workers public RPC, frontend, D1 staging/production access, M03/M04 authorization or posting changes. The current schema still lacks persisted `approval_ref`, and authenticated reviewer/cutover approvals remain blocked. `PARALLEL-MODULE-READY=false`.
