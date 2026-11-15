# M02-safe — Fail closed on tampered reviewed Party evidence formats

**Authority:** `AGENTS.md`, `docs/MIGRATION_PLAN.md`, ADR-007. Frozen source: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Problem
The M02 `planPartyImport()` validates that reviewer and approval reference identifiers are canonical, nonblank, not whitespace-padded and contain no control or directional-format Unicode. Review timestamps must be real UTC instants, ISO `YYYY-MM-DDTHH:mm:ss[.SSS]Z` with 1–3 fractional digits, and must have real Gregorian calendar dates. Merged PRs #178/#188 make `reconcilePartyImportReadback` reject impossible Party source-link graphs and inconsistent reviewed-group approval tuples, but its `validPlanLinkage` merely checks that the three evidence fields are nonblank. A tampered plan and fabricated matching future-D1-shaped snapshot can therefore report successful identity parity using a padded, control-character, or invalid-time evidence tuple.

## Owner-approved-safe behavior
For every `HUMAN_VERIFIED` proposed link, require canonical reviewer ID and approval reference with the same rules as the source-only import planner, and require an actual UTC calendar timestamp with up to 3 fractional seconds. Do not rewrite input values, canonicalize source IDs, or merge parties by name, phone or similar IDs. The normal source planner, good original records, multi-link reviewed groups and existing future approval-ref readback success remain unchanged. On bad evidence, emit exactly one fixed-code `PLAN_LINKAGE_INVALID` plan issue and set `identityRowsMatch:false` and `approvalEvidencePersistent:false`. Keep diagnostics free of user identifiers, phone numbers, names, approval refs and arbitrary timestamp text. No approval authorization is claimed; authentication is M04-owned.

## Verification
Node contract creates valid original Party import plan, alters only its reviewed evidence fields, and mirrors those altered values in future-schema D1-shaped snapshots: invalid reviewer/reference strings, invalid calendar UTC timestamps, non-UTC offsets and precision over 3 digits all fail despite identical expected/actual data. A valid millisecond UTC review still reconciles to parity when the future-schema `approval_ref` is supplied. Existing actual Workerd/D1 synthetic import test tampers only the in-memory plan and checks redacted `PLAN_LINKAGE_INVALID`, no D1 table mutations, and the current production-schema `APPROVAL_REF_NOT_PERSISTED` blocker.

## Boundaries
Only pure M02 readback reconciler and its tests plus docs. No `src/db`, migrations, M03, M04, money, original GAS/UI, Worker RPC, staging/production D1 writes, or public preview D1 bindings. Production import not approved; `PARALLEL-MODULE-READY=false`.
